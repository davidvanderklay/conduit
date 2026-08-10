const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export function parseTrustedHttpUrl(value: string, label: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL`)
  }
  if (url.protocol === "https:") return url
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return url
  throw new Error(`${label} must use HTTP or HTTPS (non-loopback HTTP is disallowed; use HTTPS)`)
}
