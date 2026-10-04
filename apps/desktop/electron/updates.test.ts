import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  cancel: vi.fn(),
  playerOpen: vi.fn(() => false),
}))
vi.mock("electron", () => ({
  app: { getVersion: () => "1.0.0", isPackaged: true, getPath: () => "/tmp/conduit-updater-test" },
}))
vi.mock("node:fs", () => ({
  promises: {
    readFile: vi.fn().mockRejectedValue(new Error("missing")),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}))
vi.mock("@conduit/updates", async (original) => ({
  ...(await original<typeof import("@conduit/updates")>()),
  fetchReleaseInfo: mocks.fetch,
}))
vi.mock("electron-updater", () => {
  class Updater {
    on = vi.fn()
    setFeedURL = vi.fn()
    checkForUpdates = mocks.check
    downloadUpdate = mocks.download
    quitAndInstall = mocks.install
  }
  return { MacUpdater: Updater, NsisUpdater: Updater }
})
import { DesktopUpdates } from "./updates"
const release = {
  schemaVersion: 1,
  component: "desktop",
  track: "stable",
  version: "1.1.0",
  commit: "a".repeat(40),
  publishedAt: "2026-10-04T00:00:00Z",
  notesUrl: "https://github.com/davidvanderklay/conduit/releases/tag/desktop%2Fv1.1.0",
  minimumApiLevel: 1,
  apiLevel: 1,
}
beforeEach(() => {
  vi.stubGlobal("process", { ...process, platform: "win32" })
  vi.clearAllMocks()
  mocks.playerOpen.mockReturnValue(false)
  mocks.fetch.mockResolvedValue(release)
  mocks.check.mockResolvedValue({
    updateInfo: { version: release.version },
    cancellationToken: { cancel: mocks.cancel },
  })
  mocks.download.mockResolvedValue([])
})
afterEach(() => vi.unstubAllGlobals())
it("rejects unknown or incompatible server API and blocks installation during playback", async () => {
  const updates = new DesktopUpdates(mocks.playerOpen)
  await updates.check()
  await expect(updates.download(undefined)).rejects.toThrow("compatibility")
  await updates.download(1)
  expect(updates.getStatus().phase).toBe("ready")
  mocks.playerOpen.mockReturnValue(true)
  expect(() => updates.install(1)).toThrow("playback")
  expect(mocks.install).not.toHaveBeenCalled()
})
it("a switched track invalidates an already staged installer", async () => {
  const updates = new DesktopUpdates(mocks.playerOpen)
  await updates.check()
  await updates.download(1)
  await updates.configure("nightly", true)
  expect(() => updates.install(1)).toThrow("ready")
  expect(mocks.install).not.toHaveBeenCalled()
  expect(updates.getStatus().track).toBe("nightly")
})
it("a feed candidate that changes before downloading cannot be installed", async () => {
  const updates = new DesktopUpdates(mocks.playerOpen)
  await updates.check()
  mocks.check.mockResolvedValue({ updateInfo: { version: "1.2.0" } })
  await updates.download(1)
  expect(updates.getStatus().phase).toBe("error")
  expect(mocks.download).not.toHaveBeenCalled()
})
