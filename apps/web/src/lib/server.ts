export const SERVER_STORAGE_KEY = "conduit:server-url"

function runtimeDefaultServerUrl(): string {
  const configured = import.meta.env.VITE_API_URL?.replace(/\/$/, "")
  if (configured) return configured

  if (
    typeof window !== "undefined" &&
    (window.location.protocol === "http:" || window.location.protocol === "https:")
  ) {
    return window.location.origin
  }

  return "http://localhost:3000"
}

export const DEFAULT_SERVER_URL = runtimeDefaultServerUrl()

export function normalizeServerUrl(value: string): string {
  const input = value.trim()
  if (!input) throw new Error("Enter your conduit server address.")

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error("Enter a complete URL, such as https://conduit.example.com.")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The server address must start with http:// or https://.")
  }
  if (url.username || url.password) {
    throw new Error("The server address cannot contain a username or password.")
  }
  if (url.search || url.hash) {
    throw new Error("The server address cannot contain a query or fragment.")
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

export function readServerUrl(storage?: Pick<Storage, "getItem">): string {
  const availableStorage =
    storage ?? (typeof window === "undefined" ? undefined : window.localStorage)
  if (!availableStorage) return DEFAULT_SERVER_URL
  const saved = availableStorage.getItem(SERVER_STORAGE_KEY)
  if (!saved) return DEFAULT_SERVER_URL

  try {
    return normalizeServerUrl(saved)
  } catch {
    return DEFAULT_SERVER_URL
  }
}

export function isDefaultServer(serverUrl: string): boolean {
  return normalizeServerUrl(serverUrl) === normalizeServerUrl(DEFAULT_SERVER_URL)
}

export function serverDisplayName(serverUrl: string): string {
  const url = new URL(normalizeServerUrl(serverUrl))
  return url.pathname === "/" ? url.host : `${url.host}${url.pathname}`
}

export function saveServerUrl(
  serverUrl: string,
  storage: Pick<Storage, "setItem" | "removeItem"> = window.localStorage,
): string {
  const normalized = normalizeServerUrl(serverUrl)
  if (isDefaultServer(normalized)) {
    storage.removeItem(SERVER_STORAGE_KEY)
  } else {
    storage.setItem(SERVER_STORAGE_KEY, normalized)
  }
  return normalized
}

export async function testConduitServer(
  serverUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const normalized = normalizeServerUrl(serverUrl)
  const response = await fetcher(`${normalized}/health`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  })

  if (!response.ok) {
    throw new Error(`The server responded with status ${response.status}.`)
  }

  const body = (await response.json().catch(() => null)) as { status?: unknown } | null
  if (body?.status !== "ok") {
    throw new Error("This does not appear to be a conduit server.")
  }
  return normalized
}
