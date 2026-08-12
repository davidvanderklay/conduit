import type { WatchProgress } from "./api"
import type { Video } from "./core"

export type ContinueWatchingState =
  | { kind: "in-progress"; video?: Video }
  | { kind: "new-episode"; video: Video }
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
): ContinueWatchingState {
  const regular = videos
    .filter(
      (video) =>
        video.season != null &&
        video.season > 0 &&
        video.episode != null,
    )
    .sort(compareEpisodes)
  const anchor =
    regular.find((video) => video.id === progress.videoId) ??
    regular.find((video) => video.season === progress.season && video.episode === progress.episode)

  if (progress.mediaType !== "series" || !progress.watched) {
    return { kind: "in-progress", video: anchor }
  }

  if (!anchor) return { kind: "caught-up" }
  const later = regular.filter((video) => compareEpisodes(video, anchor) > 0)
  const released = later.find((video) => episodeHasReleased(video, now))
  if (released) return { kind: "new-episode", video: released }

  const scheduled = later.find((video) => calendarDay(video.released) != null)
  if (scheduled) {
    return {
      kind: "scheduled",
      video: scheduled,
      label: releaseDateLabel(scheduled.released!, now),
    }
  }
  return { kind: "caught-up", video: anchor }
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
  return a.season! - b.season! || a.episode! - b.episode! || a.id.localeCompare(b.id)
}

function episodeHasReleased(video: Video, now: Date): boolean {
  if (video.available === true) return true
  const day = calendarDay(video.released)
  if (!day) return video.available !== false
  const today = localDay(now)
  if (day !== today) return day < today
  if (!video.released?.includes("T")) return false
  const instant = Date.parse(video.released)
  return !Number.isNaN(instant) && instant <= now.getTime()
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
