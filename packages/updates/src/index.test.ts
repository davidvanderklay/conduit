import { describe, expect, it } from "vitest"
import { isNewerRelease, parseReleaseInfo } from "./index"

const info = {
  schemaVersion: 1,
  component: "server",
  track: "stable",
  version: "1.1.0",
  commit: "a".repeat(40),
  publishedAt: "2026-10-04T00:00:00Z",
  notesUrl: "https://github.com/davidvanderklay/conduit/releases/tag/server%2Fv1.1.0",
  minimumApiLevel: 1,
  apiLevel: 1,
}
describe("release selection", () => {
  it("compares numeric prerelease identifiers and never downgrades", () => {
    expect(isNewerRelease("1.1.0-nightly.20261004.9", "1.1.0-nightly.20261004.10")).toBe(true)
    expect(isNewerRelease("1.1.0-nightly.20261004.10", "1.0.9")).toBe(false)
    expect(isNewerRelease("1.1.0-nightly.20261004.10", "1.1.0")).toBe(true)
    expect(isNewerRelease("development", "1.0.0")).toBe(false)
  })
  it("rejects mismatched components, unsafe notes links and prereleases in Stable", () => {
    expect(parseReleaseInfo(info, "server", "stable").version).toBe("1.1.0")
    for (const invalid of [
      { ...info, component: "web" },
      { ...info, version: "1.2.0-nightly.1" },
      { ...info, notesUrl: "https://example.com" },
      { ...info, minimumApiLevel: -1 },
    ]) {
      expect(() => parseReleaseInfo(invalid, "server", "stable")).toThrow()
    }
    expect(parseReleaseInfo({ ...info, track: "nightly" }, "server", "nightly").version).toBe(
      "1.1.0",
    )
  })
})
