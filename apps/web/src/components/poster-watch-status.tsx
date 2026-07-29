import { useQuery } from "@tanstack/react-query"
import { Check, Minus } from "lucide-react"
import type { InstalledAddon, WatchProgress } from "../lib/api"
import { api } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import { loadMeta, type CatalogItem, type MetaItem } from "../lib/core"
import { completionEpisodeIds, posterWatchState } from "../lib/watch-status"

export function PosterWatchStatus({
  profileId,
  item,
  addons,
}: {
  profileId: string
  item: CatalogItem | MetaItem
  addons: InstalledAddon[]
}) {
  const progress = useQuery({
    queryKey: ["progress", profileId, "status"],
    queryFn: () =>
      api<{ items: WatchProgress[] }>(
        `/v1/profiles/${profileId}/progress?view=status&limit=1000`,
      ).then((result) => result.items),
  })
  const mediaProgress = (progress.data ?? []).filter(
    (entry) => entry.mediaType === item.type && entry.mediaId === item.id,
  )
  const suppliedVideos = "videos" in item ? (item.videos ?? []) : []
  const metadata = useQuery({
    queryKey: ["poster-status-meta", item.type, item.id, addons.map((addon) => addon.id)],
    enabled:
      item.type === "series" &&
      mediaProgress.length > 0 &&
      suppliedVideos.length === 0,
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
  const state = posterWatchState(progress.data ?? [], item, episodeIds)

  if (state === "unwatched") return null

  const complete = state === "complete"
  const label = complete
    ? `${item.name} is complete`
    : `${item.name} is partially watched`
  return (
    <span
      className={
        complete
          ? "grid size-9 place-items-center rounded-full bg-emerald-400 text-emerald-950 shadow-lg shadow-black/40"
          : "grid size-9 place-items-center rounded-full bg-amber-400 text-amber-950 shadow-lg shadow-black/40"
      }
      role="img"
      aria-label={label}
      title={label}
    >
      {complete ? <Check size={19} strokeWidth={3.25} /> : <Minus size={19} strokeWidth={3.25} />}
    </span>
  )
}
