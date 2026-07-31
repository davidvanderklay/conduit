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
import { api, type WatchProgress } from "../lib/api"
import type { CatalogItem } from "../lib/core"
import { useLibrary, useLibraryToggle } from "../lib/library"
import { posterCoverClass, posterGridClass } from "../lib/poster-layout"
import { Card } from "./ui/card"
import { PaginationControls } from "./pagination-controls"
import { PosterActionMenu, type PosterAction } from "./poster-action-menu"
import { VirtualPosterGrid } from "./virtual-poster-grid"

type Filter = "all" | "movie" | "series"
type Sort = "recent" | "oldest" | "title-asc" | "title-desc"
const PAGE_SIZE = 48

export function useProgressList(profileId: string, view: "continue" | "history", limit = 50) {
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
  profileId,
  onSelect,
  onSeeMore,
}: {
  items: WatchProgress[]
  profileId: string
  onSelect: (item: CatalogItem, videoId: string) => void
  onSeeMore: () => void
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-display text-xl font-semibold">Continue Watching</h2>
        <button
          className="text-xs font-semibold text-zinc-500 transition hover:text-amber-300"
          onClick={onSeeMore}
        >
          See all
        </button>
      </div>
      <div className={posterGridClass}>
        {items.map((item) => (
          <ProgressCard item={item} profileId={profileId} onSelect={onSelect} key={item.videoId} />
        ))}
      </div>
    </section>
  )
}

export function HistoryView({
  profileId,
  onSelect,
}: {
  profileId: string
  onSelect: (item: CatalogItem, videoId: string) => void
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
    <main className="mx-auto max-w-[2200px] px-4 py-9 sm:px-6 lg:px-8 xl:px-10">
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
  onSelect: (item: CatalogItem, videoId: string) => void
  history?: boolean
}) {
  const catalogItem = toCatalogItem(item)
  const percent = item.durationMs ? Math.min(100, (item.positionMs / item.durationMs) * 100) : 0
  const open = () =>
    onSelect(catalogItem, item.mediaType === "series" && !history ? item.mediaId : item.videoId)
  return (
    <div>
      <button className="w-full text-left" onClick={open}>
        <div className={`relative ${posterCoverClass}`}>
          {item.poster ? (
            <img className="h-full w-full object-cover" src={item.poster} alt="" loading="lazy" />
          ) : (
            <div className="grid h-full place-items-center text-zinc-700"><Film /></div>
          )}
          {percent > 0 && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
              <span className="block h-full bg-amber-400" style={{ width: `${percent}%` }} />
            </span>
          )}
        </div>
      </button>
      <div className="mt-2 flex items-start gap-1">
        <button className="min-w-0 flex-1 text-left" onClick={open}>
          <p className="line-clamp-1 text-sm font-medium">{item.name}</p>
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
}: {
  item: WatchProgress
  profileId: string
  onOpen: () => void
  history: boolean
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
    { label: item.positionMs > 0 && !item.watched ? "Resume" : "Play", icon: <Play size={16} />, onSelect: onOpen },
    { label: "Details", icon: <Info size={16} />, onSelect: onOpen },
    {
      label: item.watched
        ? "Mark unwatched"
        : item.mediaType === "series" ? "Mark episode watched" : "Mark watched",
      icon: <Check size={16} />,
      onSelect: () => patch.mutate({ watched: !item.watched }),
      disabled: patch.isPending,
    },
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

function episodeLabel(item: WatchProgress) {
  if (item.season != null && item.episode != null)
    return `S${item.season} E${item.episode}${item.videoTitle ? ` · ${item.videoTitle}` : ""}`
  return item.videoTitle ?? (item.watched ? "Watched" : "Resume")
}
