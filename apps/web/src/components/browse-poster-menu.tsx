import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bookmark, Check, Info } from "lucide-react"
import type { InstalledAddon } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import { useLibraryToggle } from "../lib/library"
import { loadMeta, type CatalogItem, type MetaItem } from "../lib/core"
import { completionEpisodeIds, posterWatchState, seriesWatchVideos } from "../lib/watch-status"
import { mediaForWatchActions, setEpisodeWatched, setVideosWatched } from "../lib/watch-actions"
import { PosterActionMenu } from "./poster-action-menu"
import { usePosterProgress } from "./poster-watch-status"

export function BrowsePosterMenu({
  profileId,
  item,
  addons,
  onSelect,
}: {
  profileId: string
  item: CatalogItem
  addons: InstalledAddon[]
  onSelect: () => void
}) {
  const queryClient = useQueryClient()
  const progress = usePosterProgress(item)
  const library = useLibraryToggle(profileId, item)
  const metadata = useQuery({
    queryKey: ["poster-status-meta", item.type, item.id, addons.map((addon) => addon.id)],
    enabled: item.type === "series" && progress.length > 0,
    queryFn: () => firstMetadata(addons, item),
  })
  const suppliedEpisodeIds = completionEpisodeIds(metadata.data?.videos ?? [])
  const complete = posterWatchState(progress, item, suppliedEpisodeIds) === "complete"
  const watched = useMutation({
    mutationFn: async () => {
      if (item.type !== "series") {
        const existing = progress.find((entry) => entry.videoId === item.id)
        if (!existing && complete) return
        await setEpisodeWatched(
          profileId,
          mediaForWatchActions(item),
          { id: item.id, title: item.name },
          existing,
          !complete,
        )
        return
      }

      const meta = metadata.data ?? await firstMetadata(addons, item)
      const released = seriesWatchVideos(meta.videos ?? [])
      if (released.length === 0) throw new Error("No released episodes are available")
      await setVideosWatched(profileId, mediaForWatchActions(item), released, progress, !complete)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
  })

  return (
    <PosterActionMenu
      title={item.name}
      actions={[
        {
          label: item.type === "series"
            ? complete ? "Mark series unwatched" : "Mark series watched"
            : complete ? "Mark unwatched" : "Mark watched",
          icon: <Check size={16} />,
          onSelect: () => watched.mutate(),
          disabled: watched.isPending,
        },
        {
          label: library.saved ? "Remove from library" : "Add to library",
          icon: <Bookmark size={16} />,
          onSelect: () => library.toggle(),
          disabled: library.loading,
        },
        { label: "Details", icon: <Info size={16} />, onSelect },
      ]}
    />
  )
}

async function firstMetadata(addons: InstalledAddon[], item: CatalogItem): Promise<MetaItem> {
  const candidates = addonsForResource(addons, "meta", item.type, item.id)
  const results = await Promise.allSettled(
    candidates.map((addon) => loadMeta(addon.manifestUrl, item.type, item.id)),
  )
  const result = results.find(
    (candidate): candidate is PromiseFulfilledResult<MetaItem> => candidate.status === "fulfilled",
  )
  if (!result) throw new Error("No installed add-on returned episode metadata")
  return result.value
}
