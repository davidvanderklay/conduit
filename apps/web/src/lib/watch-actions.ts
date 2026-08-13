import type { WatchProgress } from "./api"
import { api } from "./api"
import type { CatalogItem, Video } from "./core"

export interface WatchActionMedia {
  type: string
  id: string
  name: string
  poster?: string
}

export async function setEpisodeWatched(
  profileId: string,
  media: WatchActionMedia,
  video: Video,
  progress: WatchProgress | undefined,
  watched: boolean,
): Promise<void> {
  if (!progress && !watched) return
  const videoId = progress?.videoId ?? video.id
  const path = `/v1/profiles/${profileId}/progress/${encodeURIComponent(videoId)}`
  if (progress) {
    await api(path, {
      method: "PATCH",
      body: JSON.stringify({ watched }),
    })
    return
  }
  await api(path, {
    method: "PUT",
    body: JSON.stringify({
      mediaType: media.type,
      mediaId: media.id,
      name: media.name,
      poster: media.poster,
      videoTitle: video.title,
      season: video.season,
      episode: video.episode,
      positionMs: 0,
      durationMs: 0,
      watched: true,
    }),
  })
}

export async function setVideosWatched(
  profileId: string,
  media: WatchActionMedia,
  videos: Video[],
  progress: WatchProgress[],
  watched: boolean,
): Promise<void> {
  const progressByVideoId = new Map(progress.map((entry) => [entry.videoId, entry]))
  const targets = watched
    ? videos
    : videos.filter((video) => progressByVideoId.has(video.id))
  const results = await Promise.allSettled(
    targets.map((video) =>
      setEpisodeWatched(profileId, media, video, progressByVideoId.get(video.id), watched),
    ),
  )
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
  if (failure) throw failure.reason
}

export function mediaForWatchActions(item: CatalogItem): WatchActionMedia {
  return {
    type: item.type,
    id: item.id,
    name: item.name,
    poster: item.poster,
  }
}
