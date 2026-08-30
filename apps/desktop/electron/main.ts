import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  powerSaveBlocker,
  screen,
  shell,
  session,
} from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type Server } from "node:http"
import { promises as fs } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { createPlaybackInhibitor } from "./playback-inhibition"

protocol.registerSchemesAsPrivileged([
  {
    scheme: "conduit",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

type ElectronOzonePlatform = "x11" | "wayland"

function electronOzonePlatform(): ElectronOzonePlatform {
  const configured = process.env.CONDUIT_ELECTRON_OZONE
  if (configured === "x11" || configured === "wayland") return configured
  if (configured) {
    throw new Error("CONDUIT_ELECTRON_OZONE must be either x11 or wayland.")
  }
  // Linux libmpv embedding requires an X11-compatible window. Users can still
  // opt into native Wayland for UI-only diagnostics with the environment variable.
  return "x11"
}

if (process.platform === "linux") {
  // The player chrome is rendered in a transparent overlay BrowserWindow.
  // Without this Chromium paints transparent pixels as opaque black on X11.
  if (electronOzonePlatform() === "x11") {
    app.commandLine.appendSwitch("enable-transparent-visuals")
  }
  if (process.env.CONDUIT_ELECTRON_IN_PROCESS_GPU === "1") {
    app.commandLine.appendSwitch("in-process-gpu")
  } else if (process.env.CONDUIT_ELECTRON_DISABLE_GPU === "1") {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch("disable-gpu")
  }
  app.commandLine.appendSwitch("ozone-platform", electronOzonePlatform())
}

// On Linux we use an out-of-process helper (separate X11 connection) to avoid
// Chromium's in-process GPU / sandbox aborting libmpv initialization. On macOS
// the NSView pointer cannot cross a process boundary, so we must use the in-
// process NAPI addon there (and on Windows for consistency).
type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

type NativeAddon = {
  invoke(request: string): string
}

const nativeRequire = createRequire(__filename)
let loadedNativeAddon: NativeAddon | undefined

function nativeAddon(): NativeAddon {
  if (loadedNativeAddon) return loadedNativeAddon
  loadedNativeAddon = nativeRequire(nativePlayerPath()) as NativeAddon
  return loadedNativeAddon
}

class NativePlayerAddonClient {
  private nextId = 1
  private intentionallyClosed = false

  constructor(private readonly windowId: string) {}

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.intentionallyClosed && method !== "player_stop") {
      throw new Error("Electron native player is not available.")
    }
    const id = this.nextId++
    const request = JSON.stringify({
      id,
      method,
      params: method === "player_open" ? { ...params, windowId: this.windowId } : params,
    })
    const response = JSON.parse(nativeAddon().invoke(request)) as {
      id: number
      result?: T
      error?: string
    }
    if (response.id !== id) throw new Error("Native player returned a mismatched response.")
    if (response.error) throw new Error(response.error)
    return response.result as T
  }

  close() {
    if (this.intentionallyClosed) return
    this.intentionallyClosed = true
    const id = this.nextId++
    try {
      nativeAddon().invoke(JSON.stringify({ id, method: "player_stop", params: {} }))
    } catch {}
  }
}

class NativePlayerHelperClient {
  private readonly child: ChildProcess
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private output = ""
  private intentionallyClosed = false

  constructor(windowId: string) {
    const binary = process.env.CONDUIT_ELECTRON_NATIVE_PLAYER ?? nativePlayerPath()
    this.child = spawn(binary, [], {
      env: process.env,
      stdio: ["pipe", "pipe", "inherit"],
    })
    this.child.on("error", (error) => {
      if (!this.intentionallyClosed) this.rejectAll(error)
    })
    this.child.on("exit", (code, signal) => {
      if (this.intentionallyClosed) return
      this.rejectAll(
        new Error(`Electron native player exited (${signal ?? `code ${code ?? "unknown"}`}).`),
      )
    })
    this.child.stdout?.setEncoding("utf8")
    this.child.stdout?.on("data", (chunk: string) => this.readOutput(chunk))
    this.windowId = windowId
  }

  private readonly windowId: string

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.child.stdin?.writable) {
      return Promise.reject(new Error("Electron native player is not available."))
    }
    const id = this.nextId++
    const request = JSON.stringify({
      id,
      method,
      params: method === "player_open" ? { ...params, windowId: this.windowId } : params,
    })
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.child.stdin!.write(`${request}\n`, (error) => {
        if (!error) return
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  close() {
    if (this.intentionallyClosed) return
    this.intentionallyClosed = true
    if (!this.child.killed) this.child.kill()
    for (const pending of this.pending.values()) pending.resolve(undefined)
    this.pending.clear()
  }

  private readOutput(chunk: string) {
    this.output += chunk
    while (true) {
      const newline = this.output.indexOf("\n")
      if (newline < 0) return
      const line = this.output.slice(0, newline)
      this.output = this.output.slice(newline + 1)
      if (!line.trim()) continue
      try {
        const response = JSON.parse(line) as {
          id: number
          result?: unknown
          error?: string
        }
        const pending = this.pending.get(response.id)
        if (!pending) continue
        this.pending.delete(response.id)
        if (response.error) pending.reject(new Error(response.error))
        else pending.resolve(response.result)
      } catch (error) {
        this.rejectAll(
          error instanceof Error ? error : new Error("Invalid response from native player."),
        )
      }
    }
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

type NativePlayerClient = NativePlayerAddonClient | NativePlayerHelperClient

function createNativePlayerClient(windowId: string): NativePlayerClient {
  if (process.platform === "linux") {
    return new NativePlayerHelperClient(windowId)
  }
  return new NativePlayerAddonClient(windowId)
}

let mainWindow: BrowserWindow | undefined
let playerOverlayWindow: BrowserWindow | undefined
let playerOverlayMedia: PlayerOverlayMedia | undefined
let nativePlayer: NativePlayerClient | undefined
let authServer: Server | undefined
let devWebServer: ChildProcess | undefined
let playerOverlayVisibilityTimer: NodeJS.Timeout | undefined
let playerOverlayMousePollTimer: NodeJS.Timeout | undefined
let playerOverlayMouseEventsIgnored: boolean | undefined
let playerOverlayInteractiveRegions: OverlayInteractiveRegion[] = []
let playerOverlayLastPointer: { x: number; y: number } | undefined
let playerOverlaySequence = 0
let mainWindowFullscreen = false
const approvedSavePaths = new Set<string>()
const playbackInhibitor = createPlaybackInhibitor(powerSaveBlocker)
const playerOverlayFocusSettleMs = 10
const singleInstanceLock = app.requestSingleInstanceLock()

if (!singleInstanceLock) {
  app.exit(0)
}

app.on("second-instance", () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

type OverlayInteractiveRegion = {
  left: number
  top: number
  right: number
  bottom: number
}

type PlayerOverlayMedia = {
  title: string
  background?: string
  logo?: string
  poster?: string
  series?: {
    name: string
    mediaId?: string
    show?: {
      name: string
      logo?: string
      poster?: string
      description?: string
      releaseInfo?: string
    }
    videos: unknown[]
    progress: unknown[]
    currentVideoId: string
  }
}

function refreshNativeSurface() {
  void nativePlayer?.request("player_refresh_surface").catch(() => undefined)
}

function positionPlayerOverlay() {
  if (!mainWindow || !playerOverlayWindow || playerOverlayWindow.isDestroyed()) return
  const bounds = mainWindow.getContentBounds()
  // Transparent Chromium windows can leave the final device-pixel row and
  // column unpainted on Linux fullscreen surfaces. Extend the overlay by one
  // DIP so the player chrome reaches the physical right and bottom edges.
  const overlayBounds =
    process.platform === "linux" && mainWindow.isFullScreen()
      ? { ...bounds, width: bounds.width + 1, height: bounds.height + 1 }
      : bounds
  try {
    playerOverlayWindow.setBounds(overlayBounds)
  } catch {}
}

function setPlayerOverlayMouseEvents(ignore: boolean) {
  if (!playerOverlayWindow || playerOverlayWindow.isDestroyed()) return
  if (playerOverlayMouseEventsIgnored === ignore) return
  playerOverlayMouseEventsIgnored = ignore
  playerOverlayWindow.setIgnoreMouseEvents(ignore, { forward: true })
}

function updatePlayerOverlayMouseEvents() {
  if (
    !playerOverlayWindow ||
    playerOverlayWindow.isDestroyed() ||
    !playerOverlayWindow.isVisible()
  ) {
    return
  }
  const bounds = playerOverlayWindow.getContentBounds()
  if (bounds.width <= 0 || bounds.height <= 0) return

  const pointer = screen.getCursorScreenPoint()
  const x = (pointer.x - bounds.x) / bounds.width
  const y = (pointer.y - bounds.y) / bounds.height
  const overControl = playerOverlayInteractiveRegions.some(
    (region) => x >= region.left && x <= region.right && y >= region.top && y <= region.bottom,
  )
  const insideWindow = x >= 0 && x <= 1 && y >= 0 && y <= 1
  // Keep the entire overlay interactive while the cursor is inside the
  // window so empty video clicks still reach the React handler (toggle
  // playback) and all controls remain hit-testable. Only forward outside.
  // Keep region tracking for future use, but do not gate on overControl.
  setPlayerOverlayMouseEvents(!insideWindow)
  void overControl
  const moved =
    !playerOverlayLastPointer ||
    Math.abs(playerOverlayLastPointer.x - x) > 0.001 ||
    Math.abs(playerOverlayLastPointer.y - y) > 0.001
  if (insideWindow && moved) {
    playerOverlayLastPointer = { x, y }
    try {
      playerOverlayWindow.webContents.send("conduit:player-overlay-wake")
    } catch {}
  } else if (!insideWindow) {
    playerOverlayLastPointer = undefined
  } else if (insideWindow) {
    playerOverlayLastPointer = { x, y }
  }
}

function startPlayerOverlayMousePolling() {
  if (playerOverlayMousePollTimer) return
  updatePlayerOverlayMouseEvents()
  playerOverlayMousePollTimer = setInterval(updatePlayerOverlayMouseEvents, 40)
}

function stopPlayerOverlayMousePolling() {
  if (playerOverlayMousePollTimer) {
    clearInterval(playerOverlayMousePollTimer)
    playerOverlayMousePollTimer = undefined
  }
  playerOverlayInteractiveRegions = []
  playerOverlayLastPointer = undefined
  setPlayerOverlayMouseEvents(true)
}

function showPlayerOverlay() {
  if (!mainWindow || !playerOverlayWindow || playerOverlayWindow.isDestroyed()) return
  if (!mainWindow.isVisible() || mainWindow.isMinimized()) return

  positionPlayerOverlay()
  // The native mpv host is a separate X11 surface, so the chrome needs to be
  // above it while Conduit is active. Pair this with hidePlayerOverlay so an
  // always-on-top surface cannot remain above another application.
  playerOverlayMouseEventsIgnored = undefined
  setPlayerOverlayMouseEvents(true)
  if (process.platform !== "darwin") {
    playerOverlayWindow.setAlwaysOnTop(true, "floating")
  }
  playerOverlayWindow.showInactive()
  playerOverlayWindow.moveTop()
  startPlayerOverlayMousePolling()
}

function hidePlayerOverlay() {
  if (!playerOverlayWindow || playerOverlayWindow.isDestroyed()) return
  stopPlayerOverlayMousePolling()
  if (process.platform !== "darwin") playerOverlayWindow.setAlwaysOnTop(false)
  playerOverlayWindow.hide()
}

let wasVisibleForOverlay = false
function syncPlayerOverlayVisibility() {
  if (playerOverlayVisibilityTimer) clearTimeout(playerOverlayVisibilityTimer)
  const isVisible = Boolean(mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized())
  const isFocused = Boolean(mainWindow && mainWindow.isFocused())
  if (!isVisible) {
    wasVisibleForOverlay = false
    playerOverlayVisibilityTimer = undefined
    hidePlayerOverlay()
    return
  }
  // Visible but not focused: distinguish workspace switch (was hidden) vs app focus loss (was visible)
  if (wasVisibleForOverlay && !isFocused) {
    // Stayed visible on same workspace but lost focus to another app -> hide so we don't cover it
    playerOverlayVisibilityTimer = undefined
    hidePlayerOverlay()
    return
  }
  const wasHidden = !wasVisibleForOverlay
  wasVisibleForOverlay = true
  // When coming back from another workspace the window animates (~250ms).
  // Delay showing until the animation lands so both appear together.
  const delay = wasHidden ? 260 : playerOverlayFocusSettleMs
  playerOverlayVisibilityTimer = setTimeout(() => {
    playerOverlayVisibilityTimer = undefined
    if (!mainWindow || !playerOverlayWindow || playerOverlayWindow.isDestroyed()) return
    const stillVisible = mainWindow.isVisible() && !mainWindow.isMinimized()
    if (stillVisible) {
      showPlayerOverlay()
    } else {
      wasVisibleForOverlay = false
      hidePlayerOverlay()
    }
  }, delay)
}

function closePlayerOverlay() {
  playerOverlaySequence += 1
  playerOverlayMedia = undefined
  if (playerOverlayVisibilityTimer) {
    clearTimeout(playerOverlayVisibilityTimer)
    playerOverlayVisibilityTimer = undefined
  }
  if (!playerOverlayWindow || playerOverlayWindow.isDestroyed()) {
    stopPlayerOverlayMousePolling()
    playerOverlayWindow = undefined
    return
  }
  const overlay = playerOverlayWindow
  playerOverlayWindow = undefined
  stopPlayerOverlayMousePolling()
  if (!overlay.isDestroyed()) overlay.close()
}

async function ensurePlayerOverlay(media: PlayerOverlayMedia) {
  if (!mainWindow) throw new Error("Main window is unavailable.")
  playerOverlayMedia = media
  if (playerOverlayWindow && !playerOverlayWindow.isDestroyed()) {
    try {
      playerOverlayWindow.webContents.send("conduit:player-overlay-media", media)
      positionPlayerOverlay()
      return
    } catch {
      closePlayerOverlay()
    }
  }

  const sequence = ++playerOverlaySequence
  const { width, height } = mainWindow.getContentBounds()
  const overlay = new BrowserWindow({
    ...mainWindow.getContentBounds(),
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    type: "normal",
    // On macOS this must be a Cocoa child window. Unlike X11, there is no
    // cross-process transient hint to attach an independent overlay later.
    parent: process.platform === "darwin" ? mainWindow : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  })
  playerOverlayWindow = overlay
  installWindowGuards(overlay)
  playerOverlayMouseEventsIgnored = undefined
  try {
    if (nativePlayer && process.platform === "linux") {
      await nativePlayer.request("player_set_overlay_window", {
        windowId: nativeWindowId(overlay),
      })
    }
    if (sequence !== playerOverlaySequence || overlay.isDestroyed()) return

    overlay.setVisibleOnAllWorkspaces(false)
    setPlayerOverlayMouseEvents(true)
    overlay.setMenuBarVisibility(false)
    overlay.on("hide", () => {
      if (!overlay.isDestroyed() && process.platform !== "darwin") {
        overlay.setAlwaysOnTop(false)
      }
    })
    overlay.on("closed", () => {
      if (playerOverlayWindow === overlay) {
        playerOverlayWindow = undefined
        playerOverlayMedia = undefined
        stopPlayerOverlayMousePolling()
      }
    })

    const query = new URLSearchParams({
      electronOverlay: "1",
      title: media.title,
      ...(media.background ? { background: media.background } : {}),
      ...(media.logo ? { logo: media.logo } : {}),
      ...(media.poster ? { poster: media.poster } : {}),
    })
    const url = rendererIsDevelopment()
      ? "http://localhost:5173/?" + query.toString()
      : "conduit://localhost/?" + query.toString()
    await overlay.loadURL(url)
    if (sequence === playerOverlaySequence && !overlay.isDestroyed()) syncPlayerOverlayVisibility()
  } catch (error) {
    if (playerOverlayWindow === overlay) {
      playerOverlayWindow = undefined
      stopPlayerOverlayMousePolling()
    }
    if (!overlay.isDestroyed()) overlay.close()
    if (overlay.isDestroyed() || sequence !== playerOverlaySequence) return
    throw error
  }
}

function nativePlayerPath(): string {
  if (process.platform === "linux") {
    if (process.env.CONDUIT_ELECTRON_NATIVE_PLAYER) {
      return process.env.CONDUIT_ELECTRON_NATIVE_PLAYER
    }
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "native", "conduit-electron-native")
    }
    const build = process.env.NODE_ENV === "production" ? "release" : "debug"
    // Cargo resolves the workspace target directory from the repository root,
    // even when it is given the helper's manifest path.
    return path.resolve(__dirname, `../../../../target/${build}/conduit-electron-native`)
  }
  if (process.env.CONDUIT_ELECTRON_NATIVE_PLAYER) {
    return process.env.CONDUIT_ELECTRON_NATIVE_PLAYER
  }
  return app.isPackaged
    ? path.join(process.resourcesPath, "native", "conduit-electron-native.node")
    : path.resolve(__dirname, "../../electron-native/dist/conduit-electron-native.node")
}

function nativeWindowId(window: BrowserWindow): string {
  const handle = window.getNativeWindowHandle()
  if (process.platform === "darwin") {
    if (handle.length < 8) throw new Error("Electron did not provide a macOS NSView handle.")
    const pointer = handle.readBigUInt64LE(0)
    if (pointer === 0n) throw new Error("Electron returned an empty macOS NSView handle.")
    if (process.env.CONDUIT_ELECTRON_LOG_WINDOW === "1") {
      console.log(`Conduit Electron: native macOS NSView ${handle.toString("hex")} (${pointer})`)
    }
    return pointer.toString()
  }
  if (process.platform === "win32") {
    if (handle.length < 4) throw new Error("Electron did not provide a Windows HWND.")
    const pointer = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))
    if (pointer === 0n) throw new Error("Electron returned an empty Windows HWND.")
    return pointer.toString()
  }
  if (process.platform !== "linux") {
    throw new Error("The Electron libmpv player does not support this platform.")
  }
  if (electronOzonePlatform() !== "x11") {
    throw new Error(
      "Embedded libmpv playback requires X11/Ozone. Restart with CONDUIT_ELECTRON_OZONE=x11. If Electron's GPU process crashes on Nvidia, also set CONDUIT_ELECTRON_IN_PROCESS_GPU=1.",
    )
  }
  // Ozone can return a placeholder from getNativeWindowHandle() even on X11.
  // Electron's media source ID contains the actual X11 Window identifier.
  const mediaSourceId = window.getMediaSourceId()
  const windowId = /^window:(\d+):/.exec(mediaSourceId)?.[1]
  if (!windowId || windowId === "0") {
    throw new Error(`Electron returned an invalid X11 media source ID: ${mediaSourceId}`)
  }
  if (process.env.CONDUIT_ELECTRON_LOG_WINDOW === "1") {
    console.log(
      `Conduit Electron: native X11 handle ${handle.toString("hex")}, media source ${mediaSourceId} (XID ${windowId})`,
    )
  }
  return windowId
}

function rendererIsDevelopment(): boolean {
  return !app.isPackaged
}

function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return rendererIsDevelopment()
      ? url.origin === "http://localhost:5173"
      : url.protocol === "conduit:" && url.hostname === "localhost"
  } catch {
    return false
  }
}

function isTrustedIpcSender(
  event: { sender: Electron.WebContents; senderFrame: Electron.WebFrameMain | null },
  allowOverlay = false,
): boolean {
  if (!isTrustedRendererUrl(event.senderFrame?.url ?? "")) return false
  if (event.sender.id === mainWindow?.webContents.id) return true
  return allowOverlay && event.sender.id === playerOverlayWindow?.webContents.id
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

function installWindowGuards(window: BrowserWindow): void {
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  window.webContents.on("will-redirect", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
}

async function startDevelopmentWebServer() {
  if (!rendererIsDevelopment() || process.env.CONDUIT_ELECTRON_SKIP_WEB === "1") return
  const workspaceRoot = path.resolve(__dirname, "../../../..")
  const windows = process.platform === "win32"
  const command = windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm"
  const args = windows
    ? ["/d", "/s", "/c", "pnpm --filter @conduit/web dev"]
    : ["--dir", workspaceRoot, "--filter", "@conduit/web", "dev"]
  devWebServer = spawn(command, args, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: "inherit",
  })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await fetch("http://localhost:5173")
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error("The web development server did not start on port 5173.")
}

async function registerApplicationProtocol() {
  const webRoot = app.isPackaged
    ? path.join(process.resourcesPath, "web")
    : path.resolve(__dirname, "../../../web/dist")
  protocol.handle("conduit", async (request) => {
    const requestUrl = new URL(request.url)
    const requestedPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "")
    const candidate = path.resolve(webRoot, requestedPath || "index.html")
    const insideWebRoot = candidate === webRoot || candidate.startsWith(`${webRoot}${path.sep}`)
    const filePath =
      insideWebRoot && (await isFile(candidate)) ? candidate : path.join(webRoot, "index.html")
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function createMainWindow(): Promise<BrowserWindow> {
  if (process.platform === "linux") {
    const ozonePlatform = electronOzonePlatform()
    if (ozonePlatform === "x11") {
      const gpuMode =
        process.env.CONDUIT_ELECTRON_IN_PROCESS_GPU === "1"
          ? " with in-process GPU"
          : process.env.CONDUIT_ELECTRON_DISABLE_GPU === "1"
            ? " with Chromium GPU disabled"
            : ""
      console.log(`Conduit Electron: using X11/Ozone for native libmpv embedding${gpuMode}`)
    } else {
      console.log(
        "Conduit Electron: using native Wayland/Ozone for the UI; embedded libmpv playback requires X11/Ozone",
      )
    }
  }

  const window = new BrowserWindow({
    title: "conduit",
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    // macOS renders an in-process NSView and Windows stacks mpv's child HWND
    // below Chromium. Both need transparent player pixels in this window.
    // Linux uses an opaque main window plus a separate X11 controls overlay.
    transparent: process.platform === "darwin" || process.platform === "win32",
    backgroundColor:
      process.platform === "darwin" || process.platform === "win32" ? "#00000000" : "#000000",
    titleBarStyle:
      process.platform === "darwin"
        ? "hiddenInset"
        : process.platform === "win32"
          ? "hidden"
          : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 16, y: 20 } : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  })
  // Remove the default File/Edit/View/Window menu bar on Linux/Windows
  window.removeMenu()
  Menu.setApplicationMenu(null)
  window.setMenuBarVisibility(false)
  installWindowGuards(window)
  window.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase()
    if (
      rendererIsDevelopment() &&
      input.type === "keyDown" &&
      (input.key === "F12" || (input.control && input.shift && key === "i"))
    ) {
      event.preventDefault()
      if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools()
      else window.webContents.openDevTools({ mode: "detach" })
      return
    }
    if (input.type !== "keyDown" || input.key !== "Escape" || !mainWindowFullscreen) return
    event.preventDefault()
    window.setFullScreen(false)
  })

  if (
    process.platform === "linux" &&
    electronOzonePlatform() === "x11" &&
    process.env.CONDUIT_ELECTRON_LOG_WINDOW === "1"
  ) {
    const handle = window.getNativeWindowHandle()
    console.log(
      `Conduit Electron: window handle ${handle.toString("hex")}, media source ${window.getMediaSourceId()}`,
    )
  }

  const resyncFullscreenOverlay = () => {
    positionPlayerOverlay()
    void refreshNativeSurface()
  }
  window.on("enter-full-screen", () => {
    mainWindowFullscreen = true
    window.webContents.send("conduit:fullscreen-changed", true)
    playerOverlayWindow?.webContents.send("conduit:fullscreen-changed", true)
    positionPlayerOverlay()
    setTimeout(resyncFullscreenOverlay, 0)
    setTimeout(resyncFullscreenOverlay, 50)
    setTimeout(resyncFullscreenOverlay, 150)
    setTimeout(resyncFullscreenOverlay, 300)
    setTimeout(resyncFullscreenOverlay, 500)
    setTimeout(resyncFullscreenOverlay, 800)
    setTimeout(resyncFullscreenOverlay, 1000)
  })
  window.on("leave-full-screen", () => {
    mainWindowFullscreen = false
    window.webContents.send("conduit:fullscreen-changed", false)
    playerOverlayWindow?.webContents.send("conduit:fullscreen-changed", false)
    positionPlayerOverlay()
    setTimeout(resyncFullscreenOverlay, 0)
    setTimeout(resyncFullscreenOverlay, 50)
    setTimeout(resyncFullscreenOverlay, 150)
    setTimeout(resyncFullscreenOverlay, 300)
    setTimeout(resyncFullscreenOverlay, 500)
    setTimeout(resyncFullscreenOverlay, 800)
    setTimeout(resyncFullscreenOverlay, 1000)
  })

  if (rendererIsDevelopment()) await window.loadURL("http://localhost:5173")
  else await window.loadURL("conduit://localhost/")
  return window
}

function startAuthServer(): Promise<{ callbackUrl: string }> {
  authServer?.close()
  return new Promise((resolve, reject) => {
    let port = 0
    const server = createServer((request, response) => {
      const target = new URL(request.url ?? "/", `http://127.0.0.1:${port}`)
      if (target.pathname !== "/oauth/callback") {
        response.writeHead(404).end()
        return
      }
      const callbackUrl = target.toString()
      mainWindow?.webContents.send("conduit:desktop-auth-callback", callbackUrl)
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "Cache-Control": "no-store",
      })
      response.end(
        "<!doctype html><title>Signed in to Conduit</title>" +
          "<style>body{color-scheme:dark;background:#09090b;color:#e4e4e7;font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center;max-width:32rem;padding:2rem}</style>" +
          "<main><h1>Return to Conduit</h1><p>Authentication is complete. You can close this tab and continue in the app.</p></main>",
      )
      server.close()
      authServer = undefined
    })
    authServer = server
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Could not bind the desktop authentication listener."))
        return
      }
      port = address.port
      resolve({ callbackUrl: `http://127.0.0.1:${address.port}/oauth/callback` })
    })
  })
}

async function invoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (command === "desktop_auth_listen") return startAuthServer()
  if (command === "window_minimize") {
    mainWindow?.minimize()
    return null
  }
  if (command === "window_toggle_maximize") {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  }
  if (command === "window_close") {
    mainWindow?.close()
    return null
  }
  if (command === "player_overlay_close") {
    mainWindow?.webContents.send("conduit:player-overlay-close")
    return null
  }
  if (command === "player_overlay_next") {
    mainWindow?.webContents.send("conduit:player-overlay-next")
    return null
  }
  if (command === "player_overlay_episode") {
    if (typeof args.videoId === "string") {
      mainWindow?.webContents.send("conduit:player-overlay-episode", args.videoId)
    }
    return null
  }
  if (command === "player_overlay_watch_action") {
    const videoIds = Array.isArray(args.videoIds)
      ? args.videoIds.filter((videoId): videoId is string => typeof videoId === "string")
      : []
    if (videoIds.length > 0 && typeof args.watched === "boolean") {
      mainWindow?.webContents.send("conduit:player-overlay-watch-action", {
        videoIds,
        watched: args.watched,
      })
    }
    return null
  }
  if (command === "player_toggle_fullscreen") {
    if (!mainWindow) throw new Error("Main window is unavailable.")
    const fullscreen = !mainWindowFullscreen
    mainWindowFullscreen = fullscreen
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1500)
      const complete = () => {
        clearTimeout(timeout)
        resolve()
      }
      if (fullscreen) mainWindow?.once("enter-full-screen", complete)
      else mainWindow?.once("leave-full-screen", complete)
      mainWindow?.setFullScreen(fullscreen)
    })
    refreshNativeSurface()
    return mainWindowFullscreen
  }
  if (command === "player_is_fullscreen") return mainWindowFullscreen
  if (command === "player_set_playing") {
    playbackInhibitor.setPlaying(args.playing === true && nativePlayer !== undefined)
    return null
  }
  if (command === "player_set_cursor_hidden") {
    if (process.platform !== "linux" || !nativePlayer) return null
    return nativePlayer.request(command, { hidden: args.hidden === true })
  }
  if (command === "player_stop") {
    const client = nativePlayer
    playbackInhibitor.setPlaying(false)
    if (!client) return null
    // Detach first so snapshot polls racing with teardown cannot enqueue behind
    // player_stop and then observe the helper's expected stopped state.
    nativePlayer = undefined
    closePlayerOverlay()
    return client.request("player_stop", args)
  }
  if (command === "player_refresh_surface" || command === "player_redraw_surface") {
    if (!nativePlayer) return null
    return nativePlayer.request(command)
  }
  if (command === "player_reset_overlay_surface") return null

  if (command === "player_open") {
    if (!mainWindow) throw new Error("Main window is unavailable.")
    playbackInhibitor.setPlaying(false)
    nativePlayer?.close()
    const client = createNativePlayerClient(nativeWindowId(mainWindow))
    nativePlayer = client
    const nativePlayerArgs = { ...args }
    delete nativePlayerArgs.artwork
    try {
      const result = await client.request("player_open", nativePlayerArgs)
      if (nativePlayer !== client) return result
      // Linux's separate X11 surface needs a transparent controls window.
      // macOS and Windows keep their native video below the main Chromium
      // surface, so the existing player portal is the controls layer.
      if (process.platform === "linux") {
        const artwork =
          args.artwork && typeof args.artwork === "object"
            ? (args.artwork as Record<string, unknown>)
            : {}
        await ensurePlayerOverlay({
          title: typeof args.title === "string" ? args.title : "",
          background: typeof artwork.background === "string" ? artwork.background : undefined,
          logo: typeof artwork.logo === "string" ? artwork.logo : undefined,
          poster: typeof artwork.poster === "string" ? artwork.poster : undefined,
          series: artwork.series as PlayerOverlayMedia["series"],
        })
      }
      return result
    } catch (error) {
      playbackInhibitor.setPlaying(false)
      if (nativePlayer === client) nativePlayer = undefined
      client.close()
      closePlayerOverlay()
      throw error
    }
  }
  if (command.startsWith("player_")) {
    if (!nativePlayer) throw new Error("The native player has not been started.")
    return nativePlayer.request(command, args)
  }
  throw new Error(`Unknown Electron command: ${command}`)
}

function registerIpcHandlers() {
  ipcMain.on("conduit:player-overlay-ready", (event) => {
    if (!playerOverlayWindow || playerOverlayWindow.isDestroyed()) return
    if (
      !isTrustedIpcSender(event, true) ||
      event.sender.id !== playerOverlayWindow.webContents.id
    ) {
      return
    }
    if (playerOverlayMedia) {
      event.sender.send("conduit:player-overlay-media", playerOverlayMedia)
    }
  })
  ipcMain.on("conduit:player-overlay-interactive-regions", (event, regions: unknown) => {
    if (!playerOverlayWindow || playerOverlayWindow.isDestroyed()) return
    if (!isTrustedIpcSender(event, true) || event.sender.id !== playerOverlayWindow.webContents.id)
      return
    if (!Array.isArray(regions)) return
    playerOverlayInteractiveRegions = regions.flatMap((region) => {
      if (!region || typeof region !== "object") return []
      const value = region as Record<string, unknown>
      const left = Number(value.left)
      const top = Number(value.top)
      const right = Number(value.right)
      const bottom = Number(value.bottom)
      if (![left, top, right, bottom].every(Number.isFinite)) return []
      if (left < 0 || top < 0 || right > 1 || bottom > 1 || left > right || top > bottom) {
        return []
      }
      return [{ left, top, right, bottom }]
    })
    updatePlayerOverlayMouseEvents()
  })
  ipcMain.handle("conduit:invoke", (event, command: string, args?: Record<string, unknown>) => {
    if (!isTrustedIpcSender(event, true)) throw new Error("Untrusted renderer")
    return invoke(command, args)
  })
  ipcMain.handle("conduit:choose-save-path", async (event, suggestedName: string) => {
    if (!isTrustedIpcSender(event)) throw new Error("Untrusted renderer")
    if (!mainWindow) throw new Error("Main window is unavailable.")
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.basename(suggestedName),
      filters: [{ name: "conduit profile export", extensions: ["json"] }],
    })
    if (result.canceled || !result.filePath) return null
    approvedSavePaths.add(result.filePath)
    return result.filePath
  })
  ipcMain.handle("conduit:write-text-file", async (event, filePath: string, contents: string) => {
    if (!isTrustedIpcSender(event) || !approvedSavePaths.has(filePath)) {
      throw new Error("A user-approved save path is required.")
    }
    approvedSavePaths.delete(filePath)
    await fs.writeFile(filePath, contents, "utf8")
  })
  ipcMain.handle("conduit:open-external", async (event, url: string) => {
    if (!isTrustedIpcSender(event) || !isSafeExternalUrl(url)) {
      throw new Error("Only HTTP and HTTPS URLs can be opened externally.")
    }
    await shell.openExternal(new URL(url).toString())
  })
}

async function closeResources() {
  authServer?.close()
  authServer = undefined
  closePlayerOverlay()
  nativePlayer?.close()
  nativePlayer = undefined
  playbackInhibitor.setPlaying(false)
  devWebServer?.kill()
  devWebServer = undefined
}

void app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    session.defaultSession.setPermissionCheckHandler(() => false)
    await startDevelopmentWebServer()
    await registerApplicationProtocol()
    registerIpcHandlers()
    mainWindow = await createMainWindow()
    const smokeVideo = process.env.CONDUIT_ELECTRON_SMOKE_VIDEO
    if (smokeVideo) {
      const smokeUrl = smokeVideo.includes(":") ? smokeVideo : pathToFileURL(smokeVideo).toString()
      const result = await invoke("player_open", {
        url: smokeUrl,
        title: "Electron native player smoke test",
        readAheadSeconds: 10,
        hardwareAcceleration: true,
      })
      console.log("Conduit Electron: native player smoke test opened", result)
      setTimeout(() => {
        void invoke("player_snapshot")
          .then((snapshot) =>
            console.log("Conduit Electron: native player smoke snapshot", snapshot),
          )
          .catch((error) =>
            console.error("Conduit Electron: native player smoke snapshot failed", error),
          )
      }, 1500)
    }
    mainWindow.on("move", () => {
      refreshNativeSurface()
      positionPlayerOverlay()
    })
    mainWindow.on("resize", () => {
      refreshNativeSurface()
      positionPlayerOverlay()
    })
    mainWindow.on("focus", showPlayerOverlay)
    mainWindow.on("blur", syncPlayerOverlayVisibility)
    mainWindow.on("show", syncPlayerOverlayVisibility)
    mainWindow.on("hide", hidePlayerOverlay)
    mainWindow.on("minimize", hidePlayerOverlay)
    mainWindow.on("restore", syncPlayerOverlayVisibility)
    mainWindow.on("closed", () => {
      closePlayerOverlay()
      mainWindow = undefined
    })
  })
  .catch((error: unknown) => {
    console.error("Conduit Electron failed to start:", error)
    app.exit(1)
  })

app.on("before-quit", () => void closeResources())
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
