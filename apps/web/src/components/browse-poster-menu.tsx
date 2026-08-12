import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bookmark, Check, Info } from "lucide-react"
import type { InstalledAddon, WatchProgress } from "../lib/api"
import { api } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import { useLibraryToggle } from "../lib/library"
import { loadMeta, type CatalogItem, type MetaItem, type Video } from "../lib/core"
import { completionEpisodeIds, posterWatchState } from "../lib/watch-status"
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
        await setWatched(profileId, item, existing, undefined, !complete)
        return
      }

      const meta = metadata.data ?? await firstMetadata(addons, item)
      const releasedIds = new Set(completionEpisodeIds(meta.videos ?? []))
      const released = (meta.videos ?? []).filter((video) => releasedIds.has(video.id))
      if (released.length === 0) throw new Error("No released episodes are available")
      await Promise.all(released.map((video) => {
        const existing = progress.find((entry) => entry.videoId === video.id)
        if (complete && !existing) return Promise.resolve()
        return setWatched(profileId, item, existing, video, !complete)
      }))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
  })

  return (
    <PosterActionMenu
      title={item.name}
      actions={[
        {
          label: item.type === "series"
            ? complete ? "Mark released episodes unwatched" : "Mark released episodes watched"
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

async function setWatched(
  profileId: string,
  item: CatalogItem,
  progress: WatchProgress | undefined,
  video: Video | undefined,
  watched: boolean,
) {
  const videoId = progress?.videoId ?? video?.id ?? item.id
  const path = `/v1/profiles/${profileId}/progress/${encodeURIComponent(videoId)}`
  if (progress) {
    await api(path, { method: "PATCH", body: JSON.stringify({ watched }) })
    return
  }
  await api(path, {
    method: "PUT",
    body: JSON.stringify({
      mediaType: item.type,
      mediaId: item.id,
      name: item.name,
      poster: item.poster,
      videoTitle: video?.title,
      season: video?.season,
      episode: video?.episode,
      positionMs: 0,
      durationMs: 0,
      watched,
    }),
  })
}
