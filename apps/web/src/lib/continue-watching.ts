import type { WatchProgress } from "./api"
import type { Video } from "./core"
import { coreValue } from "./core"

export type ContinueWatchingState =
  | { kind: "in-progress"; video?: Video }
  | { kind: "new-episode"; video: Video }
  | { kind: "next-up"; video: Video }
  | { kind: "scheduled"; video: Video; label: string }
  | { kind: "caught-up"; video?: Video }

export function groupContinueWatching(items: WatchProgress[]): WatchProgress[] {
  return coreValue<number[]>({ type: "groupContinueWatching", progress: items })
    .map((index) => items[index]!)
}

export function continueWatchingState(
  progress: WatchProgress,
  videos: Video[],
  now = new Date(),
  watchedVideoIds: ReadonlySet<string> = new Set(),
): ContinueWatchingState {
  const decision = coreValue<{
    kind: "in-progress" | "new-episode" | "next-up" | "scheduled" | "caught-up"
    videoIndex?: number
  }>({
    type: "continueWatching",
    progress,
    videos,
    today: localDay(now),
    nowMs: now.getTime(),
    watchedVideoIds: [...watchedVideoIds],
  })
  const video = decision.videoIndex == null ? undefined : videos[decision.videoIndex]
  if (decision.kind === "scheduled" && video?.released) {
    return { kind: "scheduled", video, label: releaseDateLabel(video.released, now) }
  }
  if (decision.kind === "new-episode" && video) return { kind: "new-episode", video }
  if (decision.kind === "next-up" && video) return { kind: "next-up", video }
  if (decision.kind === "in-progress") return { kind: "in-progress", video }
  return { kind: "caught-up", video }
}

export function continueWatchingBadge(
  item: WatchProgress,
  state: ContinueWatchingState,
  metadataReady = true,
): string {
  if (!metadataReady && item.mediaType === "series" && item.watched) return "Next Up"
  if (state.kind === "new-episode") return "New Episode"
  if (state.kind === "next-up") return "Next Up"
  if (state.kind === "scheduled") return state.label
  if (state.kind === "caught-up") return "Caught up"
  return remainingTimeLabel(item) ?? progressPercentLabel(item) ??
    (item.mediaType === "series" ? "Next Up" : item.watched ? "Watched" : "Resume")
}

export function remainingTimeLabel(
  progress: Pick<WatchProgress, "positionMs" | "durationMs" | "watched">,
): string | undefined {
  if (progress.watched || progress.durationMs <= progress.positionMs || progress.durationMs <= 0) {
    return undefined
  }
  const minutes = Math.max(1, Math.ceil((progress.durationMs - progress.positionMs) / 60_000))
  if (minutes < 60) return `${minutes} min left`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m left` : `${hours}h left`
}

export function releaseDateLabel(released: string, now = new Date()): string {
  const releaseDay = calendarDay(released)
  if (!releaseDay) return released
  const today = localDay(now)
  if (releaseDay === today) return "Today"
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (releaseDay === localDay(tomorrow)) return "Tomorrow"
  const [year, month, day] = releaseDay.split("-").map(Number)
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(year!, month! - 1, day!),
  )
}

function calendarDay(value: string | undefined): string | undefined {
  if (!value) return undefined
  const isoDay = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0]
  if (isoDay) return isoDay
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : localDay(date)
}

function localDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function progressPercentLabel(
  progress: Pick<WatchProgress, "positionMs" | "durationMs" | "watched">,
): string | undefined {
  if (progress.watched || progress.positionMs <= 0 || progress.durationMs <= 0) return undefined
  const percent = Math.min(99, Math.max(1, Math.floor((progress.positionMs / progress.durationMs) * 100)))
  return `${percent}% watched`
}
