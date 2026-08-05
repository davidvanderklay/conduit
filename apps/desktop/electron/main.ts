import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type Server } from "node:http"
import { promises as fs } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

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
  return process.env.WAYLAND_DISPLAY ? "wayland" : "x11"
}

if (process.platform === "linux") {
  if (process.env.CONDUIT_ELECTRON_IN_PROCESS_GPU === "1") {
    app.commandLine.appendSwitch("in-process-gpu")
  } else if (process.env.CONDUIT_ELECTRON_DISABLE_GPU === "1") {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch("disable-gpu")
  }
  app.commandLine.appendSwitch("ozone-platform", electronOzonePlatform())
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

class NativePlayerClient {
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
    // Closing during a route/video transition is expected. Resolve requests
    // belonging to the old session so Electron does not report them as IPC
    // handler failures while React is cancelling their effects.
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

let mainWindow: BrowserWindow | undefined
let nativePlayer: NativePlayerClient | undefined
let authServer: Server | undefined
let devWebServer: ChildProcess | undefined

function refreshNativeSurface() {
  void nativePlayer?.request("player_refresh_surface").catch(() => undefined)
}

function nativePlayerPath(): string {
  const binaryName = process.platform === "win32"
    ? "conduit-electron-native.exe"
    : "conduit-electron-native"
  const build = process.env.NODE_ENV === "production" ? "release" : "debug"
  // Cargo resolves the workspace target directory from the repository root,
  // even when it is given the helper's manifest path.
  return path.resolve(__dirname, `../../../../target/${build}/${binaryName}`)
}

function nativeWindowId(window: BrowserWindow): string {
  if (process.platform !== "linux") {
    throw new Error("The Electron libmpv prototype currently supports Linux only.")
  }
  if (electronOzonePlatform() !== "x11") {
    throw new Error(
      "Embedded libmpv playback requires X11/Ozone. Restart with CONDUIT_ELECTRON_OZONE=x11. If Electron's GPU process crashes on Nvidia, also set CONDUIT_ELECTRON_IN_PROCESS_GPU=1.",
    )
  }
  const handle = window.getNativeWindowHandle()
  if (handle.length < 4) throw new Error("Electron did not provide an X11 window handle.")
  const windowId = handle.readUInt32LE(0)
  if (windowId === 0) throw new Error("Electron returned an empty X11 window handle.")
  if (process.env.CONDUIT_ELECTRON_LOG_WINDOW === "1") {
    console.log(`Conduit Electron: native X11 handle ${handle.toString("hex")} (XID ${windowId})`)
  }
  return String(windowId)
}

function rendererIsDevelopment(): boolean {
  return !app.isPackaged
}

async function startDevelopmentWebServer() {
  if (!rendererIsDevelopment() || process.env.CONDUIT_ELECTRON_SKIP_WEB === "1") return
  const workspaceRoot = path.resolve(__dirname, "../../../..")
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  devWebServer = spawn(command, ["--dir", workspaceRoot, "--filter", "@conduit/web", "dev"], {
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
    const filePath = insideWebRoot && (await isFile(candidate)) ? candidate : path.join(webRoot, "index.html")
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
      const gpuMode = process.env.CONDUIT_ELECTRON_IN_PROCESS_GPU === "1"
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
    // The native mpv host is stacked above this window and shaped around the
    // controls. Keep the Chromium backing surface opaque so other windows do
    // not show through the player chrome.
    backgroundColor: "#000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  })

  if (process.platform === "linux" && electronOzonePlatform() === "x11" &&
    process.env.CONDUIT_ELECTRON_LOG_WINDOW === "1") {
    const handle = window.getNativeWindowHandle()
    console.log(
      `Conduit Electron: window handle ${handle.toString("hex")} (XID ${handle.length >= 4 ? handle.readUInt32LE(0) : "invalid"})`,
    )
  }

  window.on("enter-full-screen", () => window.webContents.send("conduit:fullscreen-changed", true))
  window.on("leave-full-screen", () => window.webContents.send("conduit:fullscreen-changed", false))

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
  if (command === "player_toggle_fullscreen") {
    if (!mainWindow) throw new Error("Main window is unavailable.")
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
    refreshNativeSurface()
    return mainWindow.isFullScreen()
  }
  if (command === "player_is_fullscreen") return mainWindow?.isFullScreen() ?? false
  if (command === "player_refresh_surface" || command === "player_redraw_surface") {
    if (!nativePlayer) return null
    return nativePlayer.request(command)
  }
  if (command === "player_reset_overlay_surface") return null

  if (command === "player_open") {
    if (!mainWindow) throw new Error("Main window is unavailable.")
    nativePlayer?.close()
    nativePlayer = new NativePlayerClient(nativeWindowId(mainWindow))
  }
  if (command.startsWith("player_")) {
    if (!nativePlayer) throw new Error("The native player has not been started.")
    return nativePlayer.request(command, args)
  }
  throw new Error(`Unknown Electron command: ${command}`)
}

function registerIpcHandlers() {
  ipcMain.handle("conduit:invoke", (_event, command: string, args?: Record<string, unknown>) =>
    invoke(command, args),
  )
  ipcMain.handle("conduit:choose-save-path", async (_event, suggestedName: string) => {
    if (!mainWindow) throw new Error("Main window is unavailable.")
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName,
      filters: [{ name: "conduit profile export", extensions: ["json"] }],
    })
    return result.canceled ? null : result.filePath
  })
  ipcMain.handle("conduit:write-text-file", async (_event, filePath: string, contents: string) => {
    await fs.writeFile(filePath, contents, "utf8")
  })
  ipcMain.handle("conduit:open-external", async (_event, url: string) => {
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs can be opened externally.")
    }
    await shell.openExternal(parsed.toString())
  })
}

async function closeResources() {
  authServer?.close()
  authServer = undefined
  nativePlayer?.close()
  nativePlayer = undefined
  devWebServer?.kill()
  devWebServer = undefined
}

app.whenReady().then(async () => {
  await startDevelopmentWebServer()
  await registerApplicationProtocol()
  registerIpcHandlers()
  mainWindow = await createMainWindow()
  mainWindow.on("move", refreshNativeSurface)
  mainWindow.on("resize", refreshNativeSurface)
  mainWindow.on("closed", () => {
    mainWindow = undefined
  })
})

app.on("before-quit", () => void closeResources())
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
