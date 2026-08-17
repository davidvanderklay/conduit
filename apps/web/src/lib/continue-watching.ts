import type { WatchProgress } from "./api"
import type { Video } from "./core"

export type ContinueWatchingState =
  | { kind: "in-progress"; video?: Video }
  | { kind: "new-episode"; video: Video }
  | { kind: "next-up"; video: Video }
  | { kind: "scheduled"; video: Video; label: string }
  | { kind: "caught-up"; video?: Video }

export function groupContinueWatching(items: WatchProgress[]): WatchProgress[] {
  const grouped = new Map<string, WatchProgress>()
  for (const item of items) {
    const key =
      item.mediaType === "series"
        ? `${item.mediaType}:${item.mediaId}`
        : `${item.mediaType}:${item.mediaId}:${item.videoId}`
    const current = grouped.get(key)
    if (!current || Date.parse(item.updatedAt) > Date.parse(current.updatedAt)) {
      grouped.set(key, item)
    }
  }
  return [...grouped.values()]
}

export function continueWatchingState(
  progress: WatchProgress,
  videos: Video[],
  now = new Date(),
  watchedVideoIds: ReadonlySet<string> = new Set(),
): ContinueWatchingState {
  const regular = videos
    .filter(
      (video) =>
        video.season != null &&
        video.season > 0 &&
        video.episode != null &&
        (video.available !== false || isUpcomingRelease(video, now)),
    )
    .sort(compareEpisodes)
  const anchor =
    regular.find((video) => video.id === progress.videoId) ??
    regular.find((video) => video.season === progress.season && video.episode === progress.episode)

  if (progress.mediaType !== "series" || !progress.watched) {
    return { kind: "in-progress", video: anchor }
  }

  if (!anchor) return { kind: "caught-up" }
  const next = regular.find(
    (video) =>
      compareEpisodeCoordinates(video, anchor) > 0 &&
      !watchedVideoIds.has(video.id),
  )
  if (next) {
    if (episodeHasReleased(next, now) && isReleaseAlert(progress, next, now)) {
      return { kind: "new-episode", video: next }
    }
    if (episodeHasReleased(next, now)) return { kind: "next-up", video: next }
    if (isUpcomingRelease(next, now)) {
      return {
        kind: "scheduled",
        video: next,
        label: releaseDateLabel(next.released!, now),
      }
    }
  }
  return { kind: "caught-up", video: anchor }
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

function compareEpisodes(a: Video, b: Video): number {
  return compareEpisodeCoordinates(a, b) || a.id.localeCompare(b.id)
}

function compareEpisodeCoordinates(a: Video, b: Video): number {
  return a.season! - b.season! || a.episode! - b.episode!
}

function episodeHasReleased(video: Video, now: Date): boolean {
  if (video.available === false) return false
  const instant = parseReleaseInstant(video.released)
  if (instant != null) return instant <= now.getTime()
  return true
}

function isUpcomingRelease(video: Video, now: Date): boolean {
  const day = calendarDay(video.released)
  if (!day) return false
  if (!video.released?.includes("T")) {
    const today = localDay(now)
    return day > today || (video.available === false && day === today)
  }
  const instant = parseReleaseInstant(video.released)
  return instant != null && instant > now.getTime()
}

function isReleaseAlert(progress: WatchProgress, video: Video, now: Date): boolean {
  const releaseTimestamp = parseReleaseInstant(video.released)
  const watchedTimestamp = Date.parse(progress.updatedAt)
  if (releaseTimestamp == null || Number.isNaN(watchedTimestamp)) return false
  return releaseTimestamp > watchedTimestamp &&
    now.getTime() - releaseTimestamp < 60 * 24 * 60 * 60 * 1000
}

function parseReleaseInstant(value: string | undefined): number | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
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
