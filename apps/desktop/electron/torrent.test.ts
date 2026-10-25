import { describe, expect, it } from "vitest"
import { torrentSource } from "./torrent"

describe("torrent playback URLs", () => {
  const hash = "a".repeat(40)

  it("moves the BEP 53 file selection out of the magnet", () => {
    const source = torrentSource(`magnet:?xt=urn:btih:${hash}&so=2&tr=udp%3A%2F%2Ft.example%3A80`)
    expect(source.fileIndex).toBe(2)
    const magnet = new URL(source.magnet)
    expect(magnet.searchParams.has("so")).toBe(false)
    expect(magnet.searchParams.get("xt")).toBe(`urn:btih:${hash}`)
    expect(magnet.searchParams.get("tr")).toBe("udp://t.example:80")
    expect(torrentSource(`magnet:?xt=urn:btih:${hash}`).fileIndex).toBeUndefined()
  })

  it("rejects file ranges and non-magnet URLs", () => {
    expect(() => torrentSource(`magnet:?xt=urn:btih:${hash}&so=0-3`)).toThrow()
    expect(() => torrentSource("https://example.com/video.mkv")).toThrow()
  })
})
