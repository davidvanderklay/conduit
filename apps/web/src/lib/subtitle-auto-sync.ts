import { coreValue } from "./core"
import { stepSubtitleDelay } from "./title-playback"

/** Reads bytes of the playing video. `data` is base64; `size` is the video's length when known. */
export type VideoRangeReader = (
  offset: number,
  length: number,
) => Promise<{ data: string; size?: number }>

export type SubtitleAutoSyncResult =
  | { synced: true; delayMs: number }
  | { synced: false; reason: string }

type TimelineStep =
  | { kind: "need"; offset: number; length: number }
  | { kind: "timeline"; starts: number[] }

const MAX_READS = 16

const failureReasons: Record<string, string> = {
  unsupported_container: "Auto sync works with MKV and MP4 videos.",
  no_subtitle_timing: "This video has no embedded subtitles to sync against.",
}

/**
 * Finds the subtitle delay that lines the add-on subtitle at `subtitleUrl` up
 * with the subtitle timing embedded in the video. The Rust core asks for the
 * byte ranges it needs and `readRange` fetches them, so each player supplies
 * its own reader. Failures come back as a short reason for the subtitle panel.
 */
export async function autoSyncSubtitle(
  readRange: VideoRangeReader,
  subtitleUrl: string | undefined,
): Promise<SubtitleAutoSyncResult> {
  if (!subtitleUrl) return { synced: false, reason: "Choose an add-on subtitle to sync." }
  const ranges: { offset: number; data: string }[] = []
  let size: number | undefined
  try {
    const subtitleText = await (await fetch(subtitleUrl)).text()
    for (let read = 0; read < MAX_READS; read++) {
      const step = coreValue<TimelineStep>({ type: "subtitleTimeline", ranges, size })
      if (step.kind === "timeline") {
        const alignment = coreValue<{ delayMs: number } | null>({
          type: "alignSubtitle",
          reference: step.starts,
          subtitle: subtitleText,
        })
        return alignment
          ? { synced: true, delayMs: stepSubtitleDelay(alignment.delayMs, 0) }
          : { synced: false, reason: "These subtitles do not match the embedded ones." }
      }
      const range = await readRange(step.offset, step.length)
      size ??= range.size
      ranges.push({ offset: step.offset, data: range.data })
    }
  } catch (error) {
    const code = error instanceof Error ? error.message.split(":")[0]! : ""
    const reason = failureReasons[code]
    if (reason) return { synced: false, reason }
  }
  return { synced: false, reason: "Could not read this video's subtitle timing." }
}

/** Reads the video with HTTP range requests, as browsers and the web engine do. */
export function fetchVideoRange(url: string): VideoRangeReader {
  return async (offset, length) => {
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
    })
    if (response.status !== 206) {
      await response.body?.cancel()
      throw new Error("The video server does not support range requests.")
    }
    const total = Number(response.headers.get("Content-Range")?.split("/")[1])
    return {
      data: toBase64(new Uint8Array(await response.arrayBuffer())),
      size: Number.isFinite(total) ? total : undefined,
    }
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}
