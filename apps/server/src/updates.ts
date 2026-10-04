import {
  fetchReleaseInfo,
  isNewerRelease,
  isUpdateTrack,
  versionTrack,
  API_LEVEL,
  type ReleaseStatus,
} from "@conduit/updates"

/** One cached upstream check per server, shared by every connected client. */
export class ServerUpdates {
  private status: ReleaseStatus
  private pending?: Promise<void>
  private nextCheck = 0
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    private readonly fetchRelease = fetchReleaseInfo,
  ) {
    const version = env.CONDUIT_RELEASE_VERSION ?? "development"
    const track = env.CONDUIT_UPDATE_TRACK ?? versionTrack(version)
    if (!isUpdateTrack(track)) throw new Error("CONDUIT_UPDATE_TRACK must be stable or nightly")
    if (env.CONDUIT_UPDATE_CHECKS && !["true", "false"].includes(env.CONDUIT_UPDATE_CHECKS))
      throw new Error("CONDUIT_UPDATE_CHECKS must be true or false")
    this.status = {
      version,
      track,
      enabled: env.CONDUIT_UPDATE_CHECKS !== "false" && version !== "development",
    }
  }

  getStatus() {
    return { ...this.status, apiLevel: API_LEVEL }
  }

  start() {
    const schedule = (delay: number) => {
      this.timer = setTimeout(async () => {
        if (this.status.enabled) await this.check()
        schedule(12 * 60 * 60_000 + Math.random() * 60_000)
      }, delay)
      this.timer.unref()
    }
    schedule(10_000 + Math.random() * 20_000)
  }

  async check() {
    if (!this.status.enabled || Date.now() < this.nextCheck) return this.getStatus()
    if (this.pending) {
      await this.pending
      return this.getStatus()
    }
    // Manual checks share this cooldown. Failed requests cannot hammer the public feed.
    this.nextCheck = Date.now() + 60_000
    this.pending = (async () => {
      try {
        const candidate = await this.fetchRelease("server", this.status.track)
        this.status = {
          ...this.status,
          checkedAt: new Date().toISOString(),
          error: undefined,
          release: isNewerRelease(this.status.version, candidate.version) ? candidate : undefined,
        }
      } catch {
        this.status = {
          ...this.status,
          error: "Couldn't check for server updates. The last result may be out of date.",
        }
      }
    })()
    await this.pending
    this.pending = undefined
    return this.getStatus()
  }

  close() {
    clearTimeout(this.timer)
  }
}
