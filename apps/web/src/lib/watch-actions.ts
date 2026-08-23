import type { WatchProgress } from "./api"
import { applyProgressOperation, progressIdentity } from "./progress"
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
  if (progress) {
    await applyProgressOperation(profileId, {
      type: "upsert",
      identity: { ...progressIdentity(progress), videoId },
      name: progress.name,
      ...(progress.poster ? { poster: progress.poster } : {}),
      ...(progress.videoTitle ? { videoTitle: progress.videoTitle } : {}),
      positionMs: watched ? progress.durationMs || progress.positionMs : progress.positionMs,
      durationMs: progress.durationMs,
      watched,
      ...(progress.playbackSource ? { playbackSource: progress.playbackSource } : {}),
      checkpointSessionId: crypto.randomUUID(),
      checkpointSequence: 1,
    })
    return
  }
  await applyProgressOperation(profileId, {
    type: "upsert",
    identity: {
      mediaType: media.type,
      mediaId: media.id,
      videoId,
      ...(video.season !== undefined ? { season: video.season } : {}),
      ...(video.episode !== undefined ? { episode: video.episode } : {}),
    },
    name: media.name,
    ...(media.poster ? { poster: media.poster } : {}),
    ...(video.title ? { videoTitle: video.title } : {}),
    positionMs: 0,
    durationMs: 0,
    watched: true,
    checkpointSessionId: crypto.randomUUID(),
    checkpointSequence: 1,
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
  const targets = watched ? videos : videos.filter((video) => progressByVideoId.has(video.id))
  const results = await Promise.allSettled(
    targets.map((video) =>
      setEpisodeWatched(profileId, media, video, progressByVideoId.get(video.id), watched),
    ),
  )
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )
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
