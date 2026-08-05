import { isDesktop } from "./desktop"

const DESKTOP_SESSION_KEY = "conduit:desktop-session"

interface StoredDesktopSession {
  serverUrl: string
  token: string
  expiresAt: string
}

export function readDesktopSessionToken(
  serverUrl: string,
  storage?: Pick<Storage, "getItem">,
): string | undefined {
  if (!isDesktopEnvironment()) return
  const availableStorage = storage ?? window.localStorage
  try {
    const value = JSON.parse(
      availableStorage.getItem(DESKTOP_SESSION_KEY) ?? "null",
    ) as StoredDesktopSession | null
    return value?.serverUrl === serverUrl &&
      value.token &&
      new Date(value.expiresAt).getTime() > Date.now()
      ? value.token
      : undefined
  } catch {
    return
  }
}

export function saveDesktopSessionToken(
  serverUrl: string,
  token: string,
  expiresAt: string,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(DESKTOP_SESSION_KEY, JSON.stringify({ serverUrl, token, expiresAt }))
}

export function clearDesktopSessionToken(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  storage.removeItem(DESKTOP_SESSION_KEY)
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBase64Url(64)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return {
    verifier,
    challenge: bytesToBase64Url(new Uint8Array(digest)),
  }
}

export async function beginDesktopAuthCallback(): Promise<{
  callbackUrl: string
  result: Promise<URL>
  cancel: () => void
}> {
  const electron = window.__CONDUIT_ELECTRON__
  if (electron) return beginElectronAuthCallback(electron)

  const [{ listen }, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/core"),
  ])
  let resolveResult!: (url: URL) => void
  let rejectResult!: (error: Error) => void
  const result = new Promise<URL>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  // The flow can fail before the callback is awaited (for example, while
  // requesting the provider URL). Mark the promise handled in that case.
  void result.catch(() => undefined)
  let settled = false
  let timeout = 0
  const unlisten = await listen<string>("desktop-auth-callback", (event) => {
    settled = true
    window.clearTimeout(timeout)
    unlisten()
    try {
      resolveResult(new URL(event.payload))
    } catch {
      rejectResult(new Error("The desktop authentication callback was invalid."))
    }
  })
  timeout = window.setTimeout(() => {
    settled = true
    unlisten()
    rejectResult(new Error("Desktop sign-in expired. Please try again."))
  }, 5 * 60 * 1000)
  const cancel = () => {
    if (settled) return
    settled = true
    window.clearTimeout(timeout)
    unlisten()
  }
  try {
    const listener = await invoke<{ callbackUrl: string }>("desktop_auth_listen")
    return { callbackUrl: listener.callbackUrl, result, cancel }
  } catch (cause) {
    cancel()
    throw cause
  }
}

export async function openInSystemBrowser(url: string): Promise<void> {
  const electron = window.__CONDUIT_ELECTRON__
  if (electron) {
    await electron.openExternal(url)
    return
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener")
  await openUrl(url)
}

async function beginElectronAuthCallback(electron: Window["__CONDUIT_ELECTRON__"] & object): Promise<{
  callbackUrl: string
  result: Promise<URL>
  cancel: () => void
}> {
  let resolveResult!: (url: URL) => void
  let rejectResult!: (error: Error) => void
  const result = new Promise<URL>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  void result.catch(() => undefined)
  let settled = false
  let timeout = 0
  const unlisten = electron.onDesktopAuthCallback((callbackUrl) => {
    settled = true
    window.clearTimeout(timeout)
    unlisten()
    try {
      resolveResult(new URL(callbackUrl))
    } catch {
      rejectResult(new Error("The desktop authentication callback was invalid."))
    }
  })
  timeout = window.setTimeout(() => {
    settled = true
    unlisten()
    rejectResult(new Error("Desktop sign-in expired. Please try again."))
  }, 5 * 60 * 1000)
  const cancel = () => {
    if (settled) return
    settled = true
    window.clearTimeout(timeout)
    unlisten()
  }
  try {
    const listener = await electron.invoke<{ callbackUrl: string }>("desktop_auth_listen")
    return { callbackUrl: listener.callbackUrl, result, cancel }
  } catch (cause) {
    cancel()
    throw cause
  }
}

function isDesktopEnvironment(): boolean {
  return typeof window !== "undefined" && isDesktop()
}

function randomBase64Url(bytes: number): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return bytesToBase64Url(value)
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = ""
  value.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
