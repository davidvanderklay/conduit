import type { WatchProgress } from "./api"
import type { CatalogItem, Video } from "./core"

export type PosterWatchState = "unwatched" | "partial" | "complete"

const LEGACY_COMPLETION_MARKER_PREFIX = "conduit:completion:"

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
  const regularEpisodes = videos.filter((video) => {
    if (video.season === 0 || video.available === false) return false
    if (!video.released) return true
    const releasedAt = Date.parse(video.released)
    return Number.isNaN(releasedAt) || releasedAt <= now
  })
  const candidates = regularEpisodes.length > 0 ? regularEpisodes : videos
  return candidates.map((video) => video.id)
}
