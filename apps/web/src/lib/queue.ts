import type { QueueItem } from "./api"
import type { CatalogItem, Video } from "./core"
import { episodeLabel } from "./metadata"

/** The whole queue plus its only write: replacing the list. */
export interface QueueControls {
  items: QueueItem[]
  set: (items: QueueItem[]) => void
}

/** The title fields a queue item is built from. */
export type QueueMedia = Pick<CatalogItem, "id" | "type" | "name" | "poster" | "background">

/** What the player advances to next, already resolved from the queue or the series. */
export interface PlayerUpNext {
  key: string
  queued: boolean
  heading: string
  title: string
  detail?: string
  artwork?: string
}

export type QueueActionKind = "add" | "next" | "remove"

export function queueItemKey(item: Pick<QueueItem, "mediaType" | "mediaId" | "videoId">): string {
  return `${item.mediaType}\u0000${item.mediaId}\u0000${item.videoId}`
}

/** Series can only be queued one episode at a time, so a bare series has no queue item. */
export function queueItemFor(item: QueueMedia, video?: Video): QueueItem | undefined {
  if (item.type !== "movie" && item.type !== "series") return undefined
  if (item.type === "series" && !video) return undefined
  const artwork = video?.thumbnail ?? item.background
  return {
    mediaType: item.type,
    mediaId: item.id,
    videoId: video?.id ?? item.id,
    name: item.name,
    ...(item.poster ? { poster: item.poster } : {}),
    ...(artwork ? { artwork } : {}),
    ...(video?.title ? { videoTitle: video.title } : {}),
    ...(video?.season !== undefined ? { season: video.season } : {}),
    ...(video?.episode !== undefined ? { episode: video.episode } : {}),
  }
}

export function addToQueue(queue: QueueItem[], item: QueueItem): QueueItem[] {
  const key = queueItemKey(item)
  return queue.some((queued) => queueItemKey(queued) === key) ? queue : [...queue, item]
}

export function moveToQueueFront(queue: QueueItem[], item: QueueItem): QueueItem[] {
  return [item, ...removeFromQueue(queue, queueItemKey(item))]
}

export function removeFromQueue(queue: QueueItem[], key: string): QueueItem[] {
  return queue.filter((queued) => queueItemKey(queued) !== key)
}

export function moveQueueItem(queue: QueueItem[], fromIndex: number, toIndex: number): QueueItem[] {
  const moved = queue[fromIndex]
  if (!moved || !queue[toIndex] || fromIndex === toIndex) return queue
  const next = queue.filter((_, index) => index !== fromIndex)
  next.splice(toIndex, 0, moved)
  return next
}

/** Playback consumes a queued item when it starts, however it was opened. */
export function queueAfterPlaybackStarted(
  queue: QueueItem[],
  mediaId: string,
  videoId: string,
): QueueItem[] {
  return queue.filter((item) => item.mediaId !== mediaId || item.videoId !== videoId)
}

/** The next queued item, never the one that is already playing. */
export function nextQueuedItem(
  queue: QueueItem[],
  mediaId: string,
  videoId: string,
): QueueItem | undefined {
  return queue.find((item) => item.mediaId !== mediaId || item.videoId !== videoId)
}

export function queueEpisodeLabel(item: QueueItem): string | undefined {
  return item.season !== undefined ? `S${item.season} E${item.episode ?? 0}` : undefined
}

/** Secondary line for a queue row: the episode for series, nothing for movies. */
export function queueItemDetail(item: QueueItem): string {
  if (item.mediaType === "movie") return "Movie"
  return [queueEpisodeLabel(item), item.videoTitle].filter(Boolean).join(" · ") || "Episode"
}

export function episodeUpNext(seriesName: string, video: Video): PlayerUpNext {
  return {
    key: video.id,
    queued: false,
    heading: `Next on ${seriesName}`,
    title: video.title ?? episodeLabel(video),
    detail: episodeLabel(video),
    artwork: video.thumbnail,
  }
}

export function queuedUpNext(item: QueueItem): PlayerUpNext {
  return {
    key: queueItemKey(item),
    queued: true,
    heading: "Up next",
    title: item.mediaType === "movie" ? item.name : (item.videoTitle ?? item.name),
    detail:
      item.mediaType === "movie"
        ? undefined
        : [item.name, queueEpisodeLabel(item)].filter(Boolean).join(" · "),
    artwork: item.artwork ?? item.poster,
  }
}

/**
 * Menu actions offered for a queueable item, mirroring mobile: a queued item
 * can be removed (or bumped to the front), anything else can be added.
 */
export function queueActionKinds(
  queue: QueueItem[],
  item: QueueItem,
  canQueue = true,
): QueueActionKind[] {
  const key = queueItemKey(item)
  const index = queue.findIndex((queued) => queueItemKey(queued) === key)
  if (index === 0) return ["remove"]
  if (index > 0) return canQueue ? ["next", "remove"] : ["remove"]
  if (!canQueue) return []
  return queue.length > 0 ? ["next", "add"] : ["add"]
}

/** Applies a menu action and returns the notice to show for it. */
export function applyQueueAction(
  queue: QueueItem[],
  item: QueueItem,
  kind: QueueActionKind,
): { items: QueueItem[]; notice: string } {
  if (kind === "remove") {
    return { items: removeFromQueue(queue, queueItemKey(item)), notice: "Removed from queue" }
  }
  if (kind === "next") return { items: moveToQueueFront(queue, item), notice: "Playing next" }
  const items = addToQueue(queue, item)
  const rank = items.findIndex((queued) => queueItemKey(queued) === queueItemKey(item)) + 1
  return { items, notice: rank <= 1 ? "Up next" : `Added to queue · #${rank}` }
}

const noticeListeners = new Set<(notice: string) => void>()

/** Transient queue feedback, shown by whichever QueueNotice is mounted. */
export function emitQueueNotice(notice: string) {
  for (const listener of noticeListeners) listener(notice)
}

export function onQueueNotice(listener: (notice: string) => void): () => void {
  noticeListeners.add(listener)
  return () => {
    noticeListeners.delete(listener)
  }
}
