import type { WatchProgress } from "./api"
import type { CatalogItem, Video } from "./core"

export type PosterWatchState = "unwatched" | "partial" | "complete"
export type EpisodeWatchState = "not-started" | "in-progress" | "watched"

const LEGACY_COMPLETION_MARKER_PREFIX = "conduit:completion:"

export function episodeWatchState(progress?: WatchProgress): EpisodeWatchState {
  if (progress?.watched) return "watched"
  if (progress && progress.positionMs > 0) return "in-progress"
  return "not-started"
}

export function episodeProgressPercent(progress?: WatchProgress): number {
  if (!progress || progress.watched || progress.durationMs <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((progress.positionMs / progress.durationMs) * 100)))
}

export function resumePositionLabel(
  progress?: Pick<WatchProgress, "positionMs" | "watched">,
): string | undefined {
  if (!progress || progress.watched || progress.positionMs <= 0) return undefined
  const totalSeconds = Math.floor(progress.positionMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return hours
    ? `${hours}:${(minutes % 60).toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`
}

export function isReleasedEpisode(video: Video, now = Date.now()): boolean {
  if (video.available === false) return false
  if (!video.released) return true
  const releasedAt = Date.parse(video.released)
  return Number.isNaN(releasedAt) || releasedAt <= now
}

export function eligibleWatchVideos(
  videos: Video[],
  season?: number,
  now = Date.now(),
): Video[] {
  return videos
    .filter((video) => season == null || (video.season ?? 1) === season)
    .filter((video) => isReleasedEpisode(video, now))
    .sort((a, b) =>
      ((a.season ?? 1) - (b.season ?? 1)) ||
      ((a.episode ?? 0) - (b.episode ?? 0)) ||
      a.id.localeCompare(b.id),
    )
}

export function seasonWatchVideos(videos: Video[], season: number, now = Date.now()): Video[] {
  return eligibleWatchVideos(videos, season, now)
}

export function seriesWatchVideos(videos: Video[], now = Date.now()): Video[] {
  const eligible = eligibleWatchVideos(videos, undefined, now)
  const regular = eligible.filter((video) => video.season !== 0)
  return regular.length > 0 ? regular : eligible
}

export function posterWatchState(
  progress: WatchProgress[],
  item: Pick<CatalogItem, "type" | "id">,
  episodeIds: string[] = [],
): PosterWatchState {
  const mediaProgress = progress.filter(
    (entry) =>
      entry.mediaType === item.type &&
      entry.mediaId === item.id &&
      !entry.videoId.startsWith(LEGACY_COMPLETION_MARKER_PREFIX),
  )
  if (item.type === "movie") {
    return mediaProgress.find((entry) => entry.videoId === item.id)?.watched
      ? "complete"
      : "unwatched"
  }

  const watchedIds = new Set(
    mediaProgress.filter((entry) => entry.watched).map((entry) => entry.videoId),
  )
  if (episodeIds.length > 0 && episodeIds.every((id) => watchedIds.has(id))) {
    return "complete"
  }
  return mediaProgress.some(
    (entry) => entry.watched || entry.positionMs > 0,
  )
    ? "partial"
    : "unwatched"
}

export function completionEpisodeIds(videos: Video[], now = Date.now()): string[] {
  return seriesWatchVideos(videos, now).map((video) => video.id)
}
