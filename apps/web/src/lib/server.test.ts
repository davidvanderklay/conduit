import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_SERVER_URL,
  SERVER_STORAGE_KEY,
  isDefaultServer,
  normalizeServerUrl,
  readServerUrl,
  saveServerUrl,
  serverDisplayName,
  testConduitServer,
} from "./server"

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial) values.set(SERVER_STORAGE_KEY, initial)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe("server selection", () => {
  it("normalizes custom server addresses", () => {
    expect(normalizeServerUrl(" https://media.example.com/conduit/ ")).toBe(
      "https://media.example.com/conduit",
    )
    expect(serverDisplayName("https://media.example.com/conduit")).toBe(
      "media.example.com/conduit",
    )
  })

  it("rejects unsafe or incomplete server addresses", () => {
    expect(() => normalizeServerUrl("media.example.com")).toThrow("complete URL")
    expect(() => normalizeServerUrl("file:///tmp/conduit")).toThrow("http:// or https://")
    expect(() => normalizeServerUrl("https://user:pass@example.com")).toThrow(
      "username or password",
    )
  })

  it("uses the baked-in server when no valid preference exists", () => {
    expect(readServerUrl(memoryStorage())).toBe(DEFAULT_SERVER_URL)
    expect(readServerUrl(memoryStorage("not a URL"))).toBe(DEFAULT_SERVER_URL)
  })

  it("stores custom servers and removes the override for the default", () => {
    const storage = memoryStorage()
    saveServerUrl("https://self-hosted.example", storage)
    expect(readServerUrl(storage)).toBe("https://self-hosted.example")

    saveServerUrl(DEFAULT_SERVER_URL, storage)
    expect(readServerUrl(storage)).toBe(DEFAULT_SERVER_URL)
    expect(isDefaultServer(readServerUrl(storage))).toBe(true)
  })

  it("verifies the Conduit health response", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "ok" })))
    await expect(testConduitServer("https://media.example.com/", fetcher)).resolves.toBe(
      "https://media.example.com",
    )
    expect(fetcher).toHaveBeenCalledWith(
      "https://media.example.com/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
