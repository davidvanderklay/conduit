import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Film, LoaderCircle, Search } from "lucide-react"
import type { WatchProgress } from "../lib/api"
import type { Video } from "../lib/core"
import {
  displayDate,
  episodeLabel,
  seasonLabel,
  sortSeasons,
} from "../lib/metadata"

export function EpisodeSelector({
  videos,
  loading = false,
  progress,
  season,
  currentVideoId,
  restoreScrollTop,
  focusVideoId,
  className = "",
  onSeasonChange,
  onScroll,
  onSelect,
}: {
  videos: Video[]
  loading?: boolean
  progress: WatchProgress[]
  season?: number
  currentVideoId?: string
  restoreScrollTop?: number
  focusVideoId?: string
  className?: string
  onSeasonChange: (season: number) => void
  onScroll?: (scrollTop: number) => void
  onSelect: (video: Video) => void
}) {
  const railRef = useRef<HTMLElement>(null)
  const seasons = useMemo(
    () => sortSeasons(videos.map((video) => video.season ?? 1)),
    [videos],
  )
  const [query, setQuery] = useState("")
  const activeSeason = season ?? seasons[0] ?? 1
  const episodes = videos
    .filter((video) => (video.season ?? 1) === activeSeason)
    .filter((video) => {
      const search = query.trim().toLocaleLowerCase()
      return !search ||
        `${video.episode ?? ""} ${video.title ?? ""}`.toLocaleLowerCase().includes(search)
    })
    .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    if (restoreScrollTop != null) {
      rail.scrollTop = restoreScrollTop
      return
    }
    const targetId = focusVideoId ?? currentVideoId
    if (!targetId) return
    const episode = [...rail.querySelectorAll<HTMLElement>("[data-video-id]")].find(
      (candidate) => candidate.dataset.videoId === targetId,
    )
    episode?.scrollIntoView({ block: "center" })
  }, [activeSeason, currentVideoId, focusVideoId, restoreScrollTop])

  return (
    <aside
      ref={railRef}
      className={`min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/40 backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      aria-label="Episodes"
      onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
    >
      <div className="sticky top-0 z-10 border-b border-white/8 bg-zinc-950/95 p-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Browse episodes
            </p>
            <h2 className="font-display text-lg font-semibold">Episodes</h2>
          </div>
          {seasons.length > 0 && (
            <label className="relative">
              <span className="sr-only">Season</span>
              <select
                className="h-9 appearance-none rounded-lg border border-white/10 bg-white/5 pl-3 pr-8 text-xs font-medium text-zinc-200 outline-none focus:border-amber-400"
                value={activeSeason}
                onChange={(event) => {
                  onSeasonChange(Number(event.target.value))
                  setQuery("")
                }}
              >
                {seasons.map((value) => (
                  <option key={value} value={value}>{seasonLabel(value)}</option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500"
                size={14}
              />
            </label>
          )}
        </div>
        <label className="relative mt-3 block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
            size={14}
          />
          <span className="sr-only">Search episodes</span>
          <input
            type="search"
            className="h-9 w-full rounded-lg border border-white/8 bg-white/5 pl-9 pr-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-amber-400"
            value={query}
            placeholder="Search this season"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {loading && (
        <p className="flex items-center gap-2 p-5 text-sm text-zinc-400">
          <LoaderCircle className="animate-spin" size={16} />
          Loading episodes…
        </p>
      )}
      {!loading && videos.length === 0 && (
        <p className="m-3 rounded-xl border border-dashed border-white/10 p-5 text-sm text-zinc-500">
          This add-on did not supply an episode list.
        </p>
      )}
      {!loading && videos.length > 0 && episodes.length === 0 && (
        <p className="p-6 text-center text-sm text-zinc-500">No matching episodes.</p>
      )}
      <div className="divide-y divide-white/6 px-2 pb-2">
        {episodes.map((video) => {
          const itemProgress = progress.find((item) => item.videoId === video.id)
          const percent =
            itemProgress && itemProgress.durationMs > 0
              ? Math.min(
                  100,
                  Math.round((itemProgress.positionMs / itemProgress.durationMs) * 100),
                )
              : 0
          const current = video.id === currentVideoId
          return (
            <button
              key={video.id}
              type="button"
              data-video-id={video.id}
              className={`group relative flex w-full gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                current ? "bg-amber-400/10 ring-1 ring-inset ring-amber-400/35" : ""
              }`}
              aria-current={current ? "true" : undefined}
              aria-label={`${current ? "Currently playing " : "Play "}${episodeLabel(video)}: ${video.title ?? "Untitled episode"}`}
              onClick={() => onSelect(video)}
            >
              <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                <EpisodeArtwork src={video.thumbnail} />
                {!video.thumbnail && (
                  <div className="absolute inset-0 grid place-items-center text-zinc-700">
                    <Film size={18} />
                  </div>
                )}
                {itemProgress?.watched && (
                  <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-amber-400 text-zinc-950">
                    <Check size={11} />
                  </span>
                )}
                {!itemProgress?.watched && percent > 0 && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
                    <span className="block h-full bg-amber-400" style={{ width: `${percent}%` }} />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 py-0.5">
                <p className="line-clamp-2 text-sm font-medium leading-5">
                  <span className="mr-1.5 text-zinc-500">{video.episode ?? "–"}.</span>
                  {video.title ?? episodeLabel(video)}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-zinc-600">
                  {video.released && <span>{displayDate(video.released)}</span>}
                  {video.runtime && <span>{video.runtime}</span>}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function EpisodeArtwork({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return null
  return (
    <img
      className="h-full w-full object-cover"
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
