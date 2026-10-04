import { afterEach, describe, expect, it, vi } from "vitest"
import { ServerUpdates } from "./updates.js"
import type { ReleaseInfo } from "@conduit/updates"

const candidate: ReleaseInfo = {
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
afterEach(() => vi.useRealTimers())
describe("server update cache", () => {
  it("shares checks and keeps the previous successful result after an upstream failure", async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(candidate)
      .mockRejectedValueOnce(new Error("offline"))
    const updates = new ServerUpdates({ CONDUIT_RELEASE_VERSION: "1.0.0" }, fetch)
    await Promise.all([updates.check(), updates.check()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(updates.getStatus().release?.version).toBe("1.1.0")
    await updates.check()
    expect(fetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_001)
    await updates.check()
    expect(updates.getStatus().error).toBeDefined()
    expect(updates.getStatus().release?.version).toBe("1.1.0")
    expect(updates.getStatus().checkedAt).toBeDefined()
  })
  it("uses the configured server track independently of clients and honors opt-out", async () => {
    const fetch = vi.fn().mockResolvedValue(candidate)
    const updates = new ServerUpdates(
      { CONDUIT_RELEASE_VERSION: "1.0.0", CONDUIT_UPDATE_TRACK: "nightly" },
      fetch,
    )
    await updates.check()
    expect(fetch).toHaveBeenCalledWith("server", "nightly")
    await new ServerUpdates(
      { CONDUIT_RELEASE_VERSION: "1.0.0", CONDUIT_UPDATE_CHECKS: "false" },
      fetch,
    ).check()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(() => new ServerUpdates({ CONDUIT_UPDATE_TRACK: "beta" }, fetch)).toThrow()
  })
})
