import type { WatchProgress } from "./api"
import type { CatalogItem, Video } from "./core"
import { coreValue } from "./core"

export type PosterWatchState = "unwatched" | "partial" | "complete"
export type EpisodeWatchState = "not-started" | "in-progress" | "watched"

export function episodeWatchState(progress?: WatchProgress): EpisodeWatchState {
  return coreValue<EpisodeWatchState>({ type: "episodeWatchState", progress: progress ?? null })
}

export function episodeProgressPercent(progress?: WatchProgress): number {
  const fraction = coreValue<number>({ type: "episodeProgress", progress: progress ?? null })
  return Math.round(fraction * 100)
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
  return coreValue<number[]>({
    type: "eligibleWatchVideos",
    videos: [video],
    season: null,
    nowMs: now,
  }).length === 1
}

export function eligibleWatchVideos(
  videos: Video[],
  season?: number,
  now = Date.now(),
): Video[] {
  return coreValue<number[]>({
    type: "eligibleWatchVideos",
    videos,
    season: season ?? null,
    nowMs: now,
  }).map((index) => videos[index]!)
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
  return coreValue<PosterWatchState>({
    type: "posterWatchState",
    progress,
    mediaType: item.type,
    mediaId: item.id,
    episodeIds,
  })
}

export function completionEpisodeIds(videos: Video[], now = Date.now()): string[] {
  return seriesWatchVideos(videos, now).map((video) => video.id)
}
