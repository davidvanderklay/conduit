import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Check, ChevronDown, Film, Info, LoaderCircle, Play, Trash2 } from "lucide-react"
import { api, type InstalledAddon, type LibraryItem, type WatchProgress } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import { loadMeta, type CatalogItem, type MetaItem } from "../lib/core"
import { posterCoverClass, posterTitleSlotClass } from "../lib/poster-layout"
import { orderLibraryItems, type LibrarySort } from "../lib/library-order"
import { useLibrary, useLibraryToggle } from "../lib/library"
import { completionEpisodeIds, seriesWatchVideos } from "../lib/watch-status"
import { mediaForWatchActions, setEpisodeWatched, setVideosWatched } from "../lib/watch-actions"
import { PosterWatchStatus } from "./poster-watch-status"
import { PosterActionMenu } from "./poster-action-menu"
import { PaginationControls } from "./pagination-controls"
import { PosterResumeButton } from "./poster-resume-button"
import { VirtualPosterGrid } from "./virtual-poster-grid"
import { Card } from "./ui/card"

type Filter = "all" | "movie" | "series"

interface DisplayItem {
  item: LibraryItem
  catalogItem: CatalogItem | MetaItem
  metadataAvailable: boolean
}

const PAGE_SIZE = 48

export function LibraryView({
  profileId,
  addons,
  onSelect,
}: {
  profileId: string
  addons: InstalledAddon[]
  onSelect: (item: CatalogItem, progress?: WatchProgress) => void
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const [sort, setSort] = useState<LibrarySort>("last-watched")
  const [page, setPage] = useState(0)
  const library = useLibrary(profileId)
  const progress = useQuery({
    queryKey: ["progress", profileId, "status"],
    queryFn: () =>
      api<{ items: WatchProgress[] }>(
        `/v1/profiles/${profileId}/progress?view=status&limit=1000`,
      ).then((result) => result.items),
  })
  const latestProgress = useMemo(() => {
    const latest = new Map<string, WatchProgress>()
    for (const entry of progress.data ?? []) {
      if (entry.videoId.startsWith("conduit:completion:")) continue
      const key = `${entry.mediaType}:${entry.mediaId}`
      const current = latest.get(key)
      if (!current || Date.parse(entry.updatedAt) > Date.parse(current.updatedAt)) {
        latest.set(key, entry)
      }
    }
    return latest
  }, [progress.data])
  const resumeProgress = useMemo(() => {
    const latest = new Map<string, WatchProgress>()
    for (const entry of progress.data ?? []) {
      if (
        entry.videoId.startsWith("conduit:completion:") ||
        entry.watched ||
        entry.positionMs < 1_000
      ) continue
      const key = `${entry.mediaType}:${entry.mediaId}`
      const current = latest.get(key)
      if (!current || Date.parse(entry.updatedAt) > Date.parse(current.updatedAt)) {
        latest.set(key, entry)
      }
    }
    return latest
  }, [progress.data])
  const filteredItems = useMemo(
    () => (library.data?.items ?? []).filter(
      (item) => filter === "all" || item.type === filter,
    ),
    [filter, library.data?.items],
  )
  const statusSort = sort === "watched" || sort === "not-watched"
  const statusMetadata = useQuery({
    queryKey: [
      "library-status-metadata",
      profileId,
      filteredItems
        .filter((item) => item.type === "series")
        .map((item) => `${item.type}:${item.id}:${item.updatedAt}`),
      addons.map((addon) => [addon.id, addon.enabled]),
    ],
    enabled: statusSort && Boolean(library.data),
    queryFn: () => resolveLibraryItems(
      filteredItems.filter((item) => item.type === "series"),
      addons,
    ),
  })
  const statusMetadataByMedia = useMemo(
    () => new Map((statusMetadata.data ?? []).map((entry) => [
      `${entry.item.type}:${entry.item.id}`,
      entry,
    ])),
    [statusMetadata.data],
  )
  const episodeIdsByMedia = useMemo(
    () => new Map((statusMetadata.data ?? []).map(({ item, catalogItem }) => [
      `${item.type}:${item.id}`,
      completionEpisodeIds("videos" in catalogItem ? (catalogItem.videos ?? []) : []),
    ])),
    [statusMetadata.data],
  )
  const orderingReady = !statusSort || statusMetadata.isSuccess
  const orderedItems = useMemo(() => {
    if (!orderingReady) return []
    return orderLibraryItems(filteredItems, progress.data ?? [], sort, episodeIdsByMedia)
  }, [episodeIdsByMedia, filteredItems, orderingReady, progress.data, sort])
  const pageItems = orderedItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  useEffect(() => setPage(0), [filter, sort])

  const resolved = useQuery({
    queryKey: [
      "library-metadata",
      profileId,
      pageItems.map((item) => `${item.type}:${item.id}:${item.updatedAt}`),
      addons.map((addon) => [addon.id, addon.enabled]),
      statusMetadata.dataUpdatedAt,
    ],
    enabled: Boolean(library.data) && orderingReady,
    queryFn: (): Promise<DisplayItem[]> =>
      resolveLibraryItems(pageItems, addons, statusMetadataByMedia),
  })
  const items = resolved.data ?? []

  return (
    <main className="mx-auto max-w-[2200px] 2xl:max-w-none px-4 py-9 sm:px-6 lg:px-6 xl:px-6 2xl:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
        Your collection
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Library</h1>
      <p className="mt-2 text-zinc-500">Movies and series saved to this profile.</p>

      <div className="mt-7 flex flex-wrap gap-3">
        <LibrarySelect
          label="Media type"
          value={filter}
          options={[
            ["all", "All types"],
            ["movie", "Movies"],
            ["series", "Series"],
          ]}
          onChange={(value) => setFilter(value as Filter)}
        />
        <LibrarySelect
          label="Sort library"
          value={sort}
          options={[
            ["last-watched", "By last watched"],
            ["name", "By name"],
            ["name-desc", "By name descending"],
            ["watched", "By watched"],
            ["not-watched", "By not watched"],
          ]}
          onChange={(value) => setSort(value as LibrarySort)}
        />
      </div>

      {(library.isLoading || resolved.isLoading || progress.isLoading || statusMetadata.isLoading) && (
        <div className="flex items-center justify-center gap-3 py-24 text-zinc-500">
          <LoaderCircle className="animate-spin text-amber-400" /> Loading your library…
        </div>
      )}
      {(library.isError || resolved.isError || progress.isError || statusMetadata.isError) && (
        <Card className="mt-8 border-red-900/70 bg-red-950/30 p-5 text-red-200">
          <AlertCircle className="mr-2 inline" size={18} />
          {library.error?.message ?? resolved.error?.message ?? statusMetadata.error?.message}
        </Card>
      )}
      {orderingReady && resolved.data && items.length === 0 && (
        <Card className="mt-8 grid min-h-64 place-items-center border-dashed text-center">
          <div>
            <Film className="mx-auto text-zinc-700" size={34} />
            <p className="mt-4 text-sm text-zinc-500">
              {library.data?.items.length ? "No titles match this filter." : "Nothing saved yet."}
            </p>
          </div>
        </Card>
      )}
      {items.length > 0 && (
        <div className="mt-9">
          <VirtualPosterGrid
            items={items}
            itemKey={({ item }) => `${item.type}:${item.id}`}
            renderItem={({ item, catalogItem, metadataAvailable }) => {
            const latest = latestProgress.get(`${item.type}:${item.id}`)
            const resume = resumeProgress.get(`${item.type}:${item.id}`)
            const percent =
              latest && latest.durationMs > 0
                ? Math.min(100, (latest.positionMs / latest.durationMs) * 100)
                : 0
            return (
              <div>
                <div className={`relative ${posterCoverClass}`}>
                  <button
                    className="absolute inset-0 w-full text-left"
                    aria-label={`View ${catalogItem.name}`}
                    onClick={() => onSelect(catalogItem, resume)}
                  >
                    {catalogItem.poster ? (
                      <img
                        className="h-full w-full object-cover"
                        src={catalogItem.poster}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={300}
                        height={450}
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-zinc-700">
                        <Film />
                      </div>
                    )}
                  </button>
                  {percent > 0 && (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-zinc-700/90">
                      <span
                        className="block h-full bg-amber-400"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                  )}
                  <PosterResumeButton
                    title={catalogItem.name}
                    progress={latest}
                    onResume={() => onSelect(catalogItem, resume)}
                  />
                </div>
                <div className="mt-2 flex items-start gap-1">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelect(catalogItem, resume)}
                  >
                    <p className={posterTitleSlotClass}>{catalogItem.name}</p>
                    {!metadataAvailable && (
                      <p className="mt-1 text-xs text-amber-400">
                        Using saved details · source unavailable
                      </p>
                    )}
                  </button>
                  <LibraryPosterMenu
                    profileId={profileId}
                    item={catalogItem}
                    progress={progress.data ?? []}
                    onSelect={() => onSelect(catalogItem, resume)}
                  />
                </div>
                <div className="pointer-events-none absolute right-2 top-2">
                  <PosterWatchStatus item={catalogItem} addons={addons} />
                </div>
              </div>
            )
          }}
          />
        </div>
      )}
      <PaginationControls
        page={page}
        pageSize={PAGE_SIZE}
        total={orderedItems.length}
        onChange={setPage}
      />
    </main>
  )
}

function LibraryPosterMenu({
  profileId,
  item,
  progress,
  onSelect,
}: {
  profileId: string
  item: CatalogItem | MetaItem
  progress: WatchProgress[]
  onSelect: () => void
}) {
  const library = useLibraryToggle(profileId, item)
  const queryClient = useQueryClient()
  const videos = "videos" in item ? item.videos ?? [] : []
  const seriesVideos = item.type === "series" ? seriesWatchVideos(videos) : []
  const mediaProgress = progress.filter(
    (entry) => entry.mediaType === item.type && entry.mediaId === item.id,
  )
  const complete = item.type === "series"
    ? seriesVideos.length > 0 && seriesVideos.every((video) =>
        mediaProgress.some((entry) => entry.videoId === video.id && entry.watched),
      )
    : mediaProgress.some((entry) => entry.videoId === item.id && entry.watched)
  const watched = useMutation({
    mutationFn: () => item.type === "series"
      ? setVideosWatched(profileId, mediaForWatchActions(item), seriesVideos, mediaProgress, !complete)
      : setEpisodeWatched(
          profileId,
          mediaForWatchActions(item),
          { id: item.id, title: item.name },
          mediaProgress.find((entry) => entry.videoId === item.id),
          !complete,
        ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
  })
  return (
    <PosterActionMenu
      title={item.name}
      actions={[
        { label: "Play", icon: <Play size={16} />, onSelect },
        { label: "Details", icon: <Info size={16} />, onSelect },
        {
          label: item.type === "series"
            ? seriesVideos.length === 0
              ? "Series episodes unavailable"
              : complete ? "Mark series unwatched" : "Mark series watched"
            : complete ? "Mark unwatched" : "Mark watched",
          icon: <Check size={16} />,
          onSelect: () => watched.mutate(),
          disabled: watched.isPending || (item.type === "series" && seriesVideos.length === 0),
        },
        {
          label: "Remove from library",
          icon: <Trash2 size={16} />,
          onSelect: () => library.toggle(),
          destructive: true,
          disabled: library.loading,
        },
      ]}
    />
  )
}

function LibrarySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  return (
    <label className="relative min-w-44">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="library-select h-11 w-full appearance-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 pr-10 text-sm font-medium text-zinc-100 shadow-sm outline-none transition hover:border-zinc-600 hover:bg-zinc-800 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([option, name]) => (
          <option className="bg-zinc-900 text-zinc-100" value={option} key={option}>
            {name}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400"
        size={16}
      />
    </label>
  )
}

async function resolveLibraryItem(
  item: LibraryItem,
  addons: InstalledAddon[],
): Promise<DisplayItem> {
  const candidates = addonsForResource(addons, "meta", item.type, item.id)
  const attempts = await Promise.allSettled(
    candidates.map((addon) => loadMeta(addon.manifestUrl, item.type, item.id)),
  )
  const match = attempts.find(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof loadMeta>>> =>
      result.status === "fulfilled",
  )
  return {
    item,
    catalogItem: match?.value ?? item,
    metadataAvailable: Boolean(match),
  }
}

async function resolveLibraryItems(
  items: LibraryItem[],
  addons: InstalledAddon[],
  cached: ReadonlyMap<string, DisplayItem> = new Map(),
): Promise<DisplayItem[]> {
  const resolved: DisplayItem[] = []
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(6, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      const item = items[index]!
      resolved[index] = cached.get(`${item.type}:${item.id}`) ??
        await resolveLibraryItem(item, addons)
    }
  })
  await Promise.all(workers)
  return resolved
}
