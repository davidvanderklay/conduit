import { app } from "electron"
import { promises as fs } from "node:fs"
import path from "node:path"
import { MacUpdater, NsisUpdater, type AppUpdater } from "electron-updater"
import {
  fetchReleaseInfo,
  feedUrl,
  isNewerRelease,
  isUpdateTrack,
  versionTrack,
  type DesktopUpdateStatus,
} from "@conduit/updates"

/** Own the updater in the main process. A renderer may choose a track, never a feed URL. */
export class DesktopUpdates {
  private status: DesktopUpdateStatus = {
    version: app.getVersion(),
    track: isUpdateTrack(process.env.CONDUIT_FLATPAK_TRACK)
      ? process.env.CONDUIT_FLATPAK_TRACK
      : versionTrack(app.getVersion()),
    enabled: true,
    platform: process.platform,
    installation: !app.isPackaged
      ? "development"
      : process.env.FLATPAK_ID
        ? "flatpak"
        : process.platform === "linux"
          ? process.env.APPIMAGE
            ? "appimage"
            : "unknown"
          : "native",
    phase: "idle",
  }
  private updater?: AppUpdater
  private cancellation?: { cancel(): void }
  private operation?: Promise<void>
  private generation = 0
  private timer?: ReturnType<typeof setTimeout>
  private readonly preferencesPath = path.join(app.getPath("userData"), "updates.json")

  constructor(private readonly playerOpen: () => boolean) {}

  async start() {
    try {
      const preferences: unknown = JSON.parse(await fs.readFile(this.preferencesPath, "utf8"))
      if (preferences && typeof preferences === "object") {
        const value = preferences as Record<string, unknown>
        if (this.status.installation !== "flatpak" && isUpdateTrack(value.track))
          this.status.track = value.track
        if (typeof value.enabled === "boolean") this.status.enabled = value.enabled
      }
    } catch {
      /* A missing or invalid preferences file uses the build's default track. */
    }
    if (app.isPackaged && this.status.enabled) void this.check()
    this.schedule()
  }

  getStatus(): DesktopUpdateStatus {
    return { ...this.status }
  }

  private schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(
      () => {
        if (this.status.enabled) void this.check()
        this.schedule()
      },
      12 * 60 * 60_000 + Math.random() * 60_000,
    )
    this.timer.unref()
  }

  async configure(track: unknown, enabled: unknown) {
    if (!isUpdateTrack(track) || typeof enabled !== "boolean")
      throw new Error("Invalid update preferences")
    if (this.status.phase === "installing") throw new Error("Installation is in progress")
    if (this.status.installation === "flatpak" && track !== this.status.track)
      throw new Error("Flatpak manages update tracks")
    if (track !== this.status.track) {
      this.generation++
      this.cancellation?.cancel()
      await this.operation
      this.cancellation = undefined
      this.status = {
        ...this.status,
        track,
        phase: "idle",
        release: undefined,
        error: undefined,
        checkedAt: undefined,
        progress: undefined,
      }
    }
    this.status.enabled = enabled
    await fs.mkdir(path.dirname(this.preferencesPath), { recursive: true })
    await fs.writeFile(this.preferencesPath, JSON.stringify({ track, enabled }), "utf8")
    if (enabled) await this.check()
    return this.getStatus()
  }

  async check() {
    if (
      this.status.installation === "development" ||
      ["ready", "installing"].includes(this.status.phase)
    )
      return this.getStatus()
    if (this.operation) {
      await this.operation
      return this.getStatus()
    }
    const generation = this.generation
    const track = this.status.track
    this.operation = (async () => {
      this.status = { ...this.status, phase: "checking", error: undefined }
      try {
        const release = await fetchReleaseInfo("desktop", track)
        if (generation !== this.generation) return
        this.status = {
          ...this.status,
          checkedAt: new Date().toISOString(),
          release: undefined,
          phase: "idle",
        }
        if (isNewerRelease(this.status.version, release.version)) {
          this.status = { ...this.status, release, phase: "available" }
        }
      } catch {
        if (generation === this.generation)
          this.status = {
            ...this.status,
            phase: "error",
            error: "Couldn't check for updates. Try again later.",
          }
      }
    })()
    await this.operation
    this.operation = undefined
    return this.getStatus()
  }

  async download(serverApiLevel: unknown) {
    if (this.operation || this.status.phase !== "available" || !this.status.release)
      throw new Error("No update is available")
    if (this.status.installation !== "native")
      throw new Error("Use your installation method to update this app")
    // Validate the API level reported by the app before starting the download.
    if (
      typeof serverApiLevel !== "number" ||
      !Number.isSafeInteger(serverApiLevel) ||
      serverApiLevel < this.status.release.minimumApiLevel
    ) {
      throw new Error("Check server compatibility before downloading this update")
    }
    if (this.playerOpen()) throw new Error("Close playback before downloading an update")
    const generation = this.generation
    const release = this.status.release
    const track = this.status.track
    const updater = this.getUpdater()
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = track === "nightly"
    updater.setFeedURL({
      provider: "generic",
      url: feedUrl("desktop", track),
      channel: track === "stable" ? "latest" : "nightly",
    })
    updater.channel = track === "stable" ? "latest" : "nightly"
    updater.allowDowngrade = false
    this.status = { ...this.status, phase: "downloading", progress: 0, error: undefined }
    this.operation = (async () => {
      try {
        const result = await updater.checkForUpdates()
        if (generation !== this.generation) return
        if (!result || result.updateInfo.version !== release.version)
          throw new Error("The release changed. Check again before downloading.")
        this.cancellation = result.cancellationToken
        await updater.downloadUpdate(result.cancellationToken)
        if (generation === this.generation)
          this.status = { ...this.status, phase: "ready", progress: 100 }
      } catch (error) {
        if (generation === this.generation)
          this.status = {
            ...this.status,
            phase: "error",
            progress: undefined,
            error: error instanceof Error ? error.message : "Update download failed",
          }
      }
    })()
    await this.operation
    this.operation = undefined
    this.cancellation = undefined
    return this.getStatus()
  }

  async cancel() {
    this.generation++
    this.cancellation?.cancel()
    await this.operation
    this.operation = undefined
    this.status = {
      ...this.status,
      phase: this.status.release ? "available" : "idle",
      progress: undefined,
      error: undefined,
    }
    return this.getStatus()
  }

  private getUpdater() {
    if (this.updater) return this.updater
    const updater = process.platform === "darwin" ? new MacUpdater() : new NsisUpdater()
    // MacUpdater owns native Electron listeners. Reuse it across checks and track switches.
    updater.on("error", (error) => {
      if (this.status.phase === "installing")
        this.status = { ...this.status, phase: "error", error: error.message }
    })
    updater.on("download-progress", (progress) => {
      if (this.status.phase === "downloading")
        this.status = { ...this.status, progress: progress.percent }
    })
    this.updater = updater
    return updater
  }

  install(serverApiLevel: unknown) {
    if (this.status.phase !== "ready" || !this.updater) throw new Error("The update isn't ready")
    if (this.playerOpen()) throw new Error("Close playback before restarting")
    if (
      typeof serverApiLevel !== "number" ||
      !Number.isSafeInteger(serverApiLevel) ||
      serverApiLevel < (this.status.release?.minimumApiLevel ?? Infinity)
    )
      throw new Error("Check server compatibility before installing")
    this.status = { ...this.status, phase: "installing" }
    this.updater.quitAndInstall(false, true)
  }

  close() {
    clearTimeout(this.timer)
    this.cancellation?.cancel()
  }
}
