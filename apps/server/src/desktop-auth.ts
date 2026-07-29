import { createHash, timingSafeEqual } from "node:crypto"

export const DESKTOP_AUTH_TTL_MS = 5 * 60 * 1000

export function validateLoopbackCallback(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Desktop callback must be a valid URL")
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/oauth/callback" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Desktop callback must use a random 127.0.0.1 loopback port")
  }
  return url.toString()
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

export function validPkceVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
}

export function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

export function hashDesktopCode(code: string, secret: string): string {
  return createHash("sha256").update(`${secret}\0${code}`).digest("base64url")
}
