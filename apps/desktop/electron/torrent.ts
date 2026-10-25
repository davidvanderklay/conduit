import { spawn, type ChildProcess } from "node:child_process"

/** The subset of `conduit_p2p::Status` the desktop shell reads. */
interface TorrentStatus {
  phase: "resolving" | "ready" | "paused" | "failed" | "closed"
  streamUrl?: string | null
  error?: string | null
}

export interface TorrentStartRequest {
  source: { magnet: string; fileIndex?: number }
  cacheDirectory: string
}

/** Matches the mobile shell: 60s for metadata plus 30s to initialize, with slack. */
const READY_TIMEOUT_MS = 95_000
const STOP_TIMEOUT_MS = 5_000

const failureMessages: Record<string, string> = {
  invalid_p2p_source: "This torrent source is invalid.",
  p2p_file_selection: "This torrent has no playable video file.",
  p2p_storage_limit: "There is not enough free disk space to stream this torrent.",
}

/**
 * Converts a torrent playback URL into the helper's source. The web app encodes
 * the file index as BEP 53 `so`, which the engine refuses inside a magnet.
 */
export function torrentSource(url: string): TorrentStartRequest["source"] {
  const magnet = new URL(url)
  if (magnet.protocol !== "magnet:") throw new Error("Expected a magnet URL.")
  const selected = magnet.searchParams.get("so")
  magnet.searchParams.delete("so")
  if (selected === null) return { magnet: magnet.href }
  const fileIndex = Number(selected)
  if (!Number.isSafeInteger(fileIndex) || fileIndex < 0) {
    throw new Error(failureMessages.invalid_p2p_source)
  }
  return { magnet: magnet.href, fileIndex }
}

/**
 * One `conduit-p2p` helper process streaming one torrent over loopback HTTP.
 * `ready` resolves with the local stream URL; `stop` ends the helper and waits
 * for it to release the shared cache lock.
 */
export class TorrentSession {
  readonly ready: Promise<string>
  private readonly child: ChildProcess
  private readonly exited: Promise<void>

  constructor(binary: string, request: TorrentStartRequest) {
    this.child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] })
    this.exited = new Promise((resolve) => {
      this.child.once("exit", () => resolve())
      this.child.once("error", () => resolve())
    })
    this.ready = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("No peers were found for this torrent. Try another source."))
        void this.stop()
      }, READY_TIMEOUT_MS)
      const settle = (error?: Error, url?: string) => {
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve(url!)
      }
      let output = ""
      this.child.stdout!.setEncoding("utf8")
      this.child.stdout!.on("data", (chunk: string) => {
        output += chunk
        let newline: number
        while ((newline = output.indexOf("\n")) >= 0) {
          const line = output.slice(0, newline)
          output = output.slice(newline + 1)
          let status: TorrentStatus
          try {
            status = JSON.parse(line) as TorrentStatus
          } catch {
            continue
          }
          if (status.phase === "ready" && status.streamUrl) settle(undefined, status.streamUrl)
          if (status.phase === "failed") {
            settle(
              new Error(
                failureMessages[status.error ?? ""] ??
                  "Unable to stream this torrent. Try another source.",
              ),
            )
          }
        }
      })
      this.child.once("error", () =>
        settle(new Error("Torrent playback is unavailable in this build.")),
      )
      this.child.once("exit", () => settle(new Error("The torrent session was closed.")))
    })
    // Callers that stop before readiness do not observe the rejection.
    this.ready.catch(() => undefined)
    this.child.stdin!.on("error", () => undefined)
    // stdin stays open for the session; closing it is the stop signal.
    this.child.stdin!.write(`${JSON.stringify(request)}\n`)
  }

  async stop(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.stdin!.destroy()
      const timeout = setTimeout(() => this.child.kill("SIGKILL"), STOP_TIMEOUT_MS)
      await this.exited
      clearTimeout(timeout)
    }
  }
}
