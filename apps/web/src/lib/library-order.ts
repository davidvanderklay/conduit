import type { LibraryItem, WatchProgress } from "./api"
import { coreValue } from "./core"

export type LibrarySort =
  | "last-watched"
  | "name"
  | "name-desc"
  | "watched"
  | "not-watched"

export function orderLibraryItems(
  items: LibraryItem[],
  progress: WatchProgress[],
  sort: LibrarySort,
  episodeIdsByMedia: ReadonlyMap<string, string[]> = new Map(),
): LibraryItem[] {
  const episodeIds = Object.fromEntries(episodeIdsByMedia)
  return coreValue<number[]>({ type: "orderLibrary", items, progress, sort, episodeIds })
    .map((index) => items[index]!)
}
