import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Minus } from "lucide-react"
import type { InstalledAddon, WatchProgress } from "../lib/api"
import { api } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import { loadMeta, type CatalogItem, type MetaItem } from "../lib/core"
import { completionEpisodeIds, posterWatchState } from "../lib/watch-status"

const ProgressByMediaContext = createContext<ReadonlyMap<string, WatchProgress[]>>(new Map())

export function PosterWatchStatusProvider({
  profileId,
  children,
}: {
  profileId: string
  children: ReactNode
}) {
  const progress = useQuery({
    queryKey: ["progress", profileId, "status"],
    queryFn: () =>
      api<{ items: WatchProgress[] }>(
        `/v1/profiles/${profileId}/progress?view=status&limit=1000`,
      ).then((result) => result.items),
  })
  const progressByMedia = useMemo(() => {
    const grouped = new Map<string, WatchProgress[]>()
    for (const entry of progress.data ?? []) {
      const key = mediaKey(entry.mediaType, entry.mediaId)
      const entries = grouped.get(key)
      if (entries) entries.push(entry)
      else grouped.set(key, [entry])
    }
    return grouped
  }, [progress.data])

  return (
    <ProgressByMediaContext.Provider value={progressByMedia}>
      {children}
    </ProgressByMediaContext.Provider>
  )
}

export function PosterWatchStatus({
  item,
  addons,
}: {
  item: CatalogItem | MetaItem
  addons: InstalledAddon[]
}) {
  const progressByMedia = useContext(ProgressByMediaContext)
  const mediaProgress = progressByMedia.get(mediaKey(item.type, item.id)) ?? []
  const suppliedVideos = "videos" in item ? (item.videos ?? []) : []
  const metadata = useQuery({
    queryKey: ["poster-status-meta", item.type, item.id, addons.map((addon) => addon.id)],
    enabled: item.type === "series" && mediaProgress.length > 0 && suppliedVideos.length === 0,
    queryFn: async () => {
      const candidates = addonsForResource(addons, "meta", item.type, item.id)
      const results = await Promise.allSettled(
        candidates.map((addon) => loadMeta(addon.manifestUrl, item.type, item.id)),
      )
      return results.find(
        (result): result is PromiseFulfilledResult<MetaItem> => result.status === "fulfilled",
      )?.value
    },
  })
  const episodeIds = completionEpisodeIds(
    suppliedVideos.length > 0 ? suppliedVideos : (metadata.data?.videos ?? []),
  )
  const state = posterWatchState(mediaProgress, item, episodeIds)

  if (state === "unwatched") return null

  const complete = state === "complete"
  const label = complete ? `${item.name} is complete` : `${item.name} is partially watched`
  return (
    <span
      className={
        complete
          ? "grid size-6 place-items-center rounded-full bg-emerald-400 text-emerald-950 shadow-md shadow-black/40"
          : "grid size-6 place-items-center rounded-full bg-amber-400 text-amber-950 shadow-md shadow-black/40"
      }
      role="img"
      aria-label={label}
      title={label}
    >
      {complete ? <Check size={14} strokeWidth={3.25} /> : <Minus size={14} strokeWidth={3.25} />}
    </span>
  )
}

function mediaKey(type: string, id: string): string {
  return `${type}:${id}`
}
