import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  ChevronDown,
  EyeOff,
  Film,
  History,
  Info,
  Play,
  Trash2,
} from "lucide-react"
import { api, type InstalledAddon, type WatchProgress } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import {
  continueWatchingBadge,
  continueWatchingState,
  groupContinueWatching,
  type ContinueWatchingState,
} from "../lib/continue-watching"
import { loadMeta, type CatalogItem, type MetaItem } from "../lib/core"
import { useLibrary, useLibraryToggle } from "../lib/library"
import { normalizeMetaItem } from "../lib/metadata"
import { posterCoverClass, posterTitleSlotClass } from "../lib/poster-layout"
import { Card } from "./ui/card"
import { PaginationControls } from "./pagination-controls"
import { PosterActionMenu, type PosterAction } from "./poster-action-menu"
import { PosterResumeButton } from "./poster-resume-button"
import { VirtualPosterGrid } from "./virtual-poster-grid"

type Filter = "all" | "movie" | "series"
type Sort = "recent" | "oldest" | "title-asc" | "title-desc"
const PAGE_SIZE = 48

export function useProgressList(profileId: string, view: "continue" | "history" | "status", limit = 50) {
  return useQuery({
    queryKey: ["progress", profileId, view],
    queryFn: () =>
      api<{ items: WatchProgress[] }>(
        `/v1/profiles/${profileId}/progress?view=${view}&limit=${limit}`,
      ).then((result) => result.items),
  })
}

export function ContinueWatching({
  items,
  addons,
  profileId,
  watchedProgress = [],
  onSelect,
  onSeeMore,
}: {
  items: WatchProgress[]
  addons: InstalledAddon[]
  profileId: string
  watchedProgress?: WatchProgress[]
  onSelect: (item: CatalogItem, videoId?: string, progress?: WatchProgress) => void
  onSeeMore: () => void
}) {
  const grouped = useMemo(() => groupContinueWatching(items).slice(0, 14), [items])
  const watchedIdsByMedia = useMemo(() => {
    const result = new Map<string, Set<string>>()
    for (const progress of watchedProgress) {
      if (!progress.watched) continue
      const key = `${progress.mediaType}:${progress.mediaId}`
      const ids = result.get(key) ?? new Set<string>()
      ids.add(progress.videoId)
      result.set(key, ids)
    }
    return result
  }, [watchedProgress])
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-display text-xl font-semibold">Continue Watching</h2>
        {grouped.length > 4 && (
          <button
            className="text-xs font-semibold text-zinc-500 transition hover:text-amber-300"
            onClick={onSeeMore}
          >
            See all
          </button>
        )}
      </div>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {grouped.map((item) => (
          <ContinueWatchingCard
            item={item}
            addons={addons}
            profileId={profileId}
            watchedVideoIds={watchedIdsByMedia.get(`${item.mediaType}:${item.mediaId}`)}
            onSelect={onSelect}
            key={item.mediaType === "series" ? `${item.mediaType}:${item.mediaId}` : item.videoId}
          />
        ))}
      </div>
    </section>
  )
}

function ContinueWatchingCard({
  item,
  addons,
  profileId,
  watchedVideoIds,
  onSelect,
}: {
  item: WatchProgress
  addons: InstalledAddon[]
  profileId: string
  watchedVideoIds?: ReadonlySet<string>
  onSelect: (item: CatalogItem, videoId?: string, progress?: WatchProgress) => void
}) {
  const fallback = toCatalogItem(item)
  const metadata = useQuery({
    queryKey: ["meta", item.mediaType, item.mediaId, addons.map((addon) => addon.id)],
    queryFn: () => resolveContinueMetadata(addons, fallback),
    staleTime: 5 * 60 * 1000,
  })
  const meta = metadata.data ?? fallback
  const state = continueWatchingState(item, metadata.data?.videos ?? [], new Date(), watchedVideoIds)
  const targetVideoId =
    state.kind === "in-progress"
      ? item.videoId
      : state.kind === "new-episode" || state.kind === "next-up"
        ? state.video.id
        : undefined
  const selectedProgress = state.kind === "in-progress" ? item : undefined
  const catalogItem: CatalogItem = {
    id: item.mediaId,
    type: item.mediaType,
    name: item.name,
    poster: meta.poster ?? item.poster,
    background: meta.background,
  }
  const open = () => onSelect(catalogItem, targetVideoId, selectedProgress)
  const badge = continueWatchingBadge(item, state, metadata.isSuccess)
  const season = state.video?.season ?? item.season
  const episode = state.video?.episode ?? item.episode
  const episodeTitle =
    state.video?.title ?? item.videoTitle ?? (item.mediaType === "series" ? undefined : "Movie")
  const percent =
    state.kind === "in-progress" && item.durationMs > 0
      ? Math.min(100, (item.positionMs / item.durationMs) * 100)
      : 0

  return (
    <article className="group relative w-[300px] shrink-0 snap-start">
      <button
        type="button"
        className="relative block aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 text-left shadow-lg shadow-black/20 outline-none transition duration-200 hover:border-white/25 focus-visible:ring-2 focus-visible:ring-amber-300"
        aria-label={continueWatchingAriaLabel(item, state)}
        onClick={open}
      >
        <PreviewImage
          sources={[
            { src: state.video?.thumbnail, fit: "cover" },
            { src: catalogItem.background, fit: "cover" },
            { src: catalogItem.poster, fit: "contain" },
          ]}
          alt=""
        />
        <span className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent" />
        {badge && (
          <span
            className={`absolute right-2.5 top-2.5 rounded-md px-2.5 py-1.5 text-[11px] font-bold tracking-wide text-white shadow-lg backdrop-blur-md ${
              state.kind === "new-episode" ? "bg-blue-600" : "bg-zinc-950/80"
            }`}
          >
            {badge}
          </span>
        )}
        <span className="absolute bottom-3 left-3 right-11">
          {item.mediaType === "series" && season != null && episode != null && (
            <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-100">
              S{season} E{episode}
            </span>
          )}
          <span className="block truncate font-display text-base font-semibold text-white">
            {item.name}
          </span>
          {episodeTitle && (
            <span className="mt-0.5 block truncate text-xs font-medium text-zinc-300">
              {episodeTitle}
            </span>
          )}
        </span>
        {percent > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <span className="block h-full bg-amber-400" style={{ width: `${percent}%` }} />
          </span>
        )}
      </button>
      <div className="absolute bottom-2 right-2 z-10 rounded-lg bg-black/55 opacity-70 backdrop-blur-sm transition group-hover:opacity-100 group-focus-within:opacity-100">
        <ProgressMenu
          item={item}
          profileId={profileId}
          onOpen={open}
          history={false}
          playable={state.kind === "in-progress" || state.kind === "new-episode" || state.kind === "next-up"}
          showWatchAction={state.kind !== "new-episode" && state.kind !== "next-up" && state.kind !== "scheduled"}
        />
      </div>
    </article>
  )
}

export function HistoryView({
  profileId,
  onSelect,
}: {
  profileId: string
  onSelect: (item: CatalogItem, videoId: string, progress: WatchProgress) => void
}) {
  const progress = useProgressList(profileId, "history", 1000)
  const [filter, setFilter] = useState<Filter>("all")
  const [sort, setSort] = useState<Sort>("recent")
  const [page, setPage] = useState(0)
  const grouped = useMemo(() => {
    const latest = new Map<string, WatchProgress>()
    for (const item of progress.data ?? []) {
      const key = `${item.mediaType}:${item.mediaId}`
      const current = latest.get(key)
      if (!current || Date.parse(item.updatedAt) > Date.parse(current.updatedAt)) latest.set(key, item)
    }
    return [...latest.values()]
      .filter((item) => filter === "all" || item.mediaType === filter)
      .sort((a, b) => {
        if (sort === "title-asc") return a.name.localeCompare(b.name)
        if (sort === "title-desc") return b.name.localeCompare(a.name)
        const delta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
        return sort === "oldest" ? -delta : delta
      })
  }, [filter, progress.data, sort])
  const pageItems = grouped.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  useEffect(() => setPage(0), [filter, sort])

  return (
    <main className="mx-auto max-w-[2200px] 2xl:max-w-none px-4 py-9 sm:px-6 lg:px-6 xl:px-6 2xl:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
        Your activity
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Watch history</h1>
      <p className="mt-2 text-zinc-500">Titles you have watched, whether or not they are saved.</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <HistorySelect
          label="Media type"
          value={filter}
          options={[["all", "Movies & series"], ["movie", "Movies"], ["series", "Series"]]}
          onChange={(value) => setFilter(value as Filter)}
        />
        <HistorySelect
          label="Sort history"
          value={sort}
          options={[
            ["recent", "Recently watched"],
            ["oldest", "Oldest watched"],
            ["title-asc", "Title A–Z"],
            ["title-desc", "Title Z–A"],
          ]}
          onChange={(value) => setSort(value as Sort)}
        />
      </div>
      {pageItems.length > 0 ? (
        <div className="mt-9">
          <VirtualPosterGrid
            items={pageItems}
            itemKey={(item) => `${item.mediaType}:${item.mediaId}`}
            renderItem={(item) => (
              <ProgressCard item={item} profileId={profileId} onSelect={onSelect} history />
            )}
          />
        </div>
      ) : (
        <Card className="mt-8 grid min-h-64 place-items-center border-dashed text-zinc-500">
          <div className="text-center">
            <History className="mx-auto mb-3 text-zinc-700" />
            {progress.isLoading ? "Loading watch history…" : "No watch history yet."}
          </div>
        </Card>
      )}
      <PaginationControls page={page} pageSize={PAGE_SIZE} total={grouped.length} onChange={setPage} />
    </main>
  )
}

function ProgressCard({
  item,
  profileId,
  onSelect,
  history = false,
}: {
  item: WatchProgress
  profileId: string
  onSelect: (item: CatalogItem, videoId: string, progress: WatchProgress) => void
  history?: boolean
}) {
  const catalogItem = toCatalogItem(item)
  const percent = item.durationMs ? Math.min(100, (item.positionMs / item.durationMs) * 100) : 0
  const open = () =>
    onSelect(catalogItem, item.videoId, item)
  return (
    <div>
      <div className={`relative ${posterCoverClass}`}>
        <button
          className="absolute inset-0 w-full text-left"
          aria-label={`View ${item.name}`}
          onClick={open}
        >
          {item.poster ? (
            <img className="h-full w-full object-cover" src={item.poster} alt="" loading="lazy" />
          ) : (
            <div className="grid h-full place-items-center text-zinc-700"><Film /></div>
          )}
        </button>
        {percent > 0 && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
            <span className="block h-full bg-amber-400" style={{ width: `${percent}%` }} />
          </span>
        )}
        <PosterResumeButton title={item.name} progress={item} onResume={open} />
      </div>
      <div className="mt-2 flex items-start gap-1">
        <button className="min-w-0 flex-1 text-left" onClick={open}>
          <p className={posterTitleSlotClass}>{item.name}</p>
          <p className="line-clamp-1 text-xs text-zinc-500">{episodeLabel(item)}</p>
        </button>
        <ProgressMenu item={item} profileId={profileId} onOpen={open} history={history} />
      </div>
    </div>
  )
}

function ProgressMenu({
  item,
  profileId,
  onOpen,
  history,
  playable = true,
  showWatchAction = true,
}: {
  item: WatchProgress
  profileId: string
  onOpen: () => void
  history: boolean
  playable?: boolean
  showWatchAction?: boolean
}) {
  const queryClient = useQueryClient()
  const library = useLibrary(profileId)
  const libraryToggle = useLibraryToggle(profileId, toCatalogItem(item))
  const saved = library.data?.items.some(
    (entry) => entry.type === item.mediaType && entry.id === item.mediaId,
  )
  const patch = useMutation({
    mutationFn: (body: { watched?: boolean; dismissed?: boolean }) =>
      api(`/v1/profiles/${profileId}/progress/${encodeURIComponent(item.videoId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
  })
  const remove = useMutation({
    mutationFn: () =>
      api(`/v1/profiles/${profileId}/progress/${encodeURIComponent(item.videoId)}`, {
        method: "DELETE",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
  })
  const actions: PosterAction[] = [
    ...(playable
      ? [
          {
            label: item.positionMs > 0 && !item.watched ? "Resume" : "Play",
            icon: <Play size={16} />,
            onSelect: onOpen,
          },
        ]
      : []),
    { label: "Details", icon: <Info size={16} />, onSelect: onOpen },
    ...(showWatchAction
      ? [
          {
            label: item.watched
              ? "Mark unwatched"
              : item.mediaType === "series"
                ? "Mark episode watched"
                : "Mark watched",
            icon: <Check size={16} />,
            onSelect: () => patch.mutate({ watched: !item.watched }),
            disabled: patch.isPending,
          },
        ]
      : []),
  ]
  if (history) {
    if (saved) {
      actions.push({
        label: "Remove from library",
        icon: <Trash2 size={16} />,
        onSelect: () => libraryToggle.toggle(),
        destructive: true,
        disabled: libraryToggle.loading,
      })
    }
    actions.push({
      label: "Remove from history",
      icon: <Trash2 size={16} />,
      onSelect: () => remove.mutate(),
      destructive: true,
      disabled: remove.isPending,
    })
  } else {
    actions.push({
      label: "Dismiss",
      icon: <EyeOff size={16} />,
      onSelect: () => patch.mutate({ dismissed: true }),
      disabled: patch.isPending,
    })
  }
  return <PosterActionMenu title={item.name} actions={actions} />
}

function HistorySelect({
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
        className="library-select h-11 w-full appearance-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 pr-10 text-sm font-medium text-zinc-100 outline-none hover:border-zinc-600 focus:border-amber-400"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([option, name]) => <option value={option} key={option}>{name}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
    </label>
  )
}

function toCatalogItem(item: WatchProgress): CatalogItem {
  return { id: item.mediaId, type: item.mediaType, name: item.name, poster: item.poster }
}

function continueWatchingAriaLabel(item: WatchProgress, state: ContinueWatchingState): string {
  if (state.kind === "new-episode") return `Play the new episode of ${item.name}`
  if (state.kind === "next-up") return `Play the next episode of ${item.name}`
  if (state.kind === "scheduled") return `View ${item.name}, next episode ${state.label}`
  if (state.kind === "caught-up") return `View ${item.name}, caught up`
  return `Resume ${item.name}`
}

function PreviewImage({
  sources,
  alt,
}: {
  sources: Array<{ src?: string; fit: "cover" | "contain" }>
  alt: string
}) {
  const [failed, setFailed] = useState<string[]>([])
  const source = sources.find(
    (candidate): candidate is { src: string; fit: "cover" | "contain" } =>
      Boolean(candidate.src && !failed.includes(candidate.src)),
  )
  if (!source)
    return (
      <span className="grid h-full place-items-center text-zinc-700">
        <Film />
      </span>
    )
  if (source.fit === "contain") {
    return (
      <span className="relative block h-full w-full overflow-hidden bg-black">
        <img
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl"
          src={source.src}
          alt=""
          aria-hidden="true"
        />
        <img
          className="relative h-full w-full object-contain"
          src={source.src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed((current) => [...current, source.src])}
        />
      </span>
    )
  }
  return (
    <img
      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
      src={source.src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed((current) => [...current, source.src])}
    />
  )
}

async function resolveContinueMetadata(
  addons: InstalledAddon[],
  item: CatalogItem,
): Promise<MetaItem> {
  const candidates = addonsForResource(addons, "meta", item.type, item.id)
  const results = await Promise.allSettled(
    candidates.map((addon) => loadMeta(addon.manifestUrl, item.type, item.id)),
  )
  const match = results.find(
    (result): result is PromiseFulfilledResult<MetaItem> => result.status === "fulfilled",
  )
  return normalizeMetaItem(match?.value, item)
}

function episodeLabel(item: WatchProgress) {
  if (item.season != null && item.episode != null)
    return `S${item.season} E${item.episode}${item.videoTitle ? ` · ${item.videoTitle}` : ""}`
  return item.videoTitle ?? (item.watched ? "Watched" : "Resume")
}
