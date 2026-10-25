import { describe, expect, it } from "vitest"
import { noteAutoplayedEpisode, noteViewerInput, shouldAskStillWatching } from "./still-watching"

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size
    },
  }
}

describe("still watching", () => {
  it("asks during the third episode in a row and resets on input", () => {
    const storage = memoryStorage()
    noteAutoplayedEpisode(storage)
    expect(shouldAskStillWatching(true, storage)).toBe(false)
    noteAutoplayedEpisode(storage)
    expect(shouldAskStillWatching(true, storage)).toBe(true)
    expect(shouldAskStillWatching(false, storage)).toBe(false)
    noteViewerInput(storage)
    expect(shouldAskStillWatching(true, storage)).toBe(false)
  })
})
