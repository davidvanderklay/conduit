// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { parsePlayerShortcut, playerShortcut, steppedSpeed, steppedVolume } from "./player-shortcuts"

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { key, ...init })
  Object.defineProperty(event, "target", { value: target })
  return playerShortcut(event)
}

describe("player shortcuts", () => {
  it("follows Stremio's bindings", () => {
    expect(press(" ")).toEqual({ type: "toggle-playback" })
    expect(press("ArrowRight")).toEqual({ type: "seek", seconds: 10 })
    expect(press("ArrowLeft", { shiftKey: true })).toEqual({ type: "seek", seconds: -30 })
    expect(press("ArrowUp")).toEqual({ type: "volume", delta: 5 })
    expect(press("M")).toEqual({ type: "mute" })
    expect(press("f")).toEqual({ type: "fullscreen" })
    expect(press("c")).toEqual({ type: "toggle-subtitles" })
    expect(press("s")).toEqual({ type: "menu", menu: "subtitles" })
    expect(press("a")).toEqual({ type: "menu", menu: "audio" })
    expect(press("]")).toEqual({ type: "speed", delta: 0.25 })
    expect(press("N", { shiftKey: true })).toEqual({ type: "next" })
  })

  it("leaves plain N and browser chords alone", () => {
    expect(press("n")).toBeUndefined()
    expect(press("f", { ctrlKey: true })).toBeUndefined()
    expect(press("ArrowLeft", { altKey: true })).toBeUndefined()
  })

  it("ignores keys typed into fields", () => {
    const search = document.createElement("input")
    const notes = document.createElement("div")
    notes.contentEditable = "true"
    expect(press(" ", {}, search)).toBeUndefined()
    expect(press("m", {}, document.createElement("textarea"))).toBeUndefined()
    // jsdom does not implement isContentEditable.
    Object.defineProperty(notes, "isContentEditable", { value: true })
    expect(press("f", {}, notes)).toBeUndefined()
  })

  it("keeps arrow stepping on a focused slider but still toggles playback", () => {
    const slider = document.createElement("input")
    slider.type = "range"
    expect(press("ArrowRight", {}, slider)).toBeUndefined()
    expect(press(" ", {}, slider)).toEqual({ type: "toggle-playback" })
  })

  it("rejects malformed shortcuts from IPC", () => {
    expect(parsePlayerShortcut({ type: "seek", seconds: 10 })).toEqual({ type: "seek", seconds: 10 })
    expect(parsePlayerShortcut({ type: "seek", seconds: "10" })).toBeUndefined()
    expect(parsePlayerShortcut({ type: "menu", menu: "video" })).toBeUndefined()
    expect(parsePlayerShortcut({ type: "eject" })).toBeUndefined()
    expect(parsePlayerShortcut(null)).toBeUndefined()
  })

  it("clamps speed and volume steps", () => {
    expect(steppedSpeed(1, 0.25)).toBe(1.25)
    expect(steppedSpeed(2, 0.25)).toBe(2)
    expect(steppedSpeed(0.25, -0.25)).toBe(0.25)
    expect(steppedVolume(98, 5)).toBe(100)
    expect(steppedVolume(3, -5)).toBe(0)
  })
})
