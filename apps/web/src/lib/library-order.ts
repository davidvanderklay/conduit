import type { LibraryItem, WatchProgress } from "./api"
import { posterWatchState } from "./watch-status"

export type LibrarySort =
  | "last-watched"
  | "name"
  | "name-desc"
  | "watched"
  | "not-watched"

const LEGACY_COMPLETION_MARKER_PREFIX = "conduit:completion:"

export function orderLibraryItems(
  items: LibraryItem[],
  progress: WatchProgress[],
  sort: LibrarySort,
  episodeIdsByMedia: ReadonlyMap<string, string[]> = new Map(),
): LibraryItem[] {
  const progressByMedia = new Map<string, WatchProgress[]>()
  const latestProgress = new Map<string, WatchProgress>()

  for (const entry of progress) {
    if (entry.videoId.startsWith(LEGACY_COMPLETION_MARKER_PREFIX)) continue
    const key = mediaKey(entry.mediaType, entry.mediaId)
    const entries = progressByMedia.get(key)
    if (entries) entries.push(entry)
    else progressByMedia.set(key, [entry])

    const latest = latestProgress.get(key)
    if (!latest || Date.parse(entry.updatedAt) > Date.parse(latest.updatedAt)) {
      latestProgress.set(key, entry)
    }
  }

  const compareLastWatched = (left: LibraryItem, right: LibraryItem) => {
    const leftProgress = latestProgress.get(mediaKey(left.type, left.id))
    const rightProgress = latestProgress.get(mediaKey(right.type, right.id))
    if (leftProgress && rightProgress) {
      const delta = Date.parse(rightProgress.updatedAt) - Date.parse(leftProgress.updatedAt)
      if (delta) return delta
    }
    if (leftProgress) return -1
    if (rightProgress) return 1
    const savedDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return savedDelta || compareName(left, right)
  }

  return [...items].sort((left, right) => {
    if (sort === "name") return compareName(left, right)
    if (sort === "name-desc") return compareName(right, left)
    if (sort === "last-watched") return compareLastWatched(left, right)

    const leftComplete = isComplete(left)
    const rightComplete = isComplete(right)
    if (leftComplete !== rightComplete) {
      if (sort === "watched") return leftComplete ? -1 : 1
      return leftComplete ? 1 : -1
    }
    return compareLastWatched(left, right)
  })

  function isComplete(item: LibraryItem): boolean {
    const key = mediaKey(item.type, item.id)
    return posterWatchState(
      progressByMedia.get(key) ?? [],
      item,
      episodeIdsByMedia.get(key) ?? [],
    ) === "complete"
  }
}

function compareName(left: LibraryItem, right: LibraryItem): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
    left.id.localeCompare(right.id)
}

function mediaKey(type: string, id: string): string {
  return `${type}:${id}`
}
