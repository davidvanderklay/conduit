import { describe, expect, it } from "vitest"
import { partyPositionAt } from "./watch-party"

describe("watch party playback timing", () => {
  it("projects playing host state using the server timestamp", () => {
    expect(partyPositionAt({ position: 30, duration: 100, playing: true, rate: 1.5, sequence: 2, serverTime: 10_000 }, 12_000)).toBe(33)
  })

  it("does not advance paused state", () => {
    expect(partyPositionAt({ position: 30, duration: 100, playing: false, rate: 1, sequence: 2, serverTime: 10_000 }, 12_000)).toBe(30)
  })

  it("caps a projected position at duration", () => {
    expect(partyPositionAt({ position: 98, duration: 100, playing: true, rate: 2, sequence: 2, serverTime: 10_000 }, 12_000)).toBe(100)
  })
})
