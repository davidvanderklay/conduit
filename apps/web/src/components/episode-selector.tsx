import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Film,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RotateCcw,
  Search,
} from "lucide-react"
import type { WatchProgress } from "../lib/api"
import type { Video } from "../lib/core"
import {
  displayDate,
  episodeLabel,
  progressForVideo,
  seasonLabel,
  sortSeasons,
} from "../lib/metadata"
import {
  episodeProgressPercent,
  episodeWatchState,
  seasonWatchVideos,
} from "../lib/watch-status"
import type { WatchActionMedia } from "../lib/watch-actions"

export interface EpisodeSelectorShow {
  name: string
  logo?: string
  poster?: string
  description?: string
  releaseInfo?: string
}

export function EpisodeSelector({
  videos,
  loading = false,
  progress,
  season,
  currentVideoId,
  restoreScrollTop,
  focusVideoId,
  autoPositionVideoId,
  disableAutoPositioning = false,
  className = "",
  media,
  show,
  onWatchAction,
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
  autoPositionVideoId?: string
  disableAutoPositioning?: boolean
  className?: string
  media?: WatchActionMedia
  show?: EpisodeSelectorShow
  onWatchAction?: (targets: Video[], watched: boolean) => Promise<void>
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState>()
  const [watchPending, setWatchPending] = useState(false)
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false)
  const positionedKey = useRef<string | undefined>(undefined)
  const activeSeason = season ?? seasons[0] ?? 1
  const seasonIndex = seasons.indexOf(activeSeason)
  const previousSeason = seasonIndex > 0 ? seasons[seasonIndex - 1] : undefined
  const nextSeason = seasonIndex >= 0 ? seasons[seasonIndex + 1] : undefined
  const episodes = videos
    .filter((video) => (video.season ?? 1) === activeSeason)
    .filter((video) => {
      const search = query.trim().toLocaleLowerCase()
      return !search ||
        `${video.episode ?? ""} ${video.title ?? ""}`.toLocaleLowerCase().includes(search)
    })
    .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
  const seasonProgress = episodes.length > 0
    ? Math.round(
        episodes.reduce((total, video) => {
          const itemProgress = progressForVideo(progress, video, media?.id)
          const state = episodeWatchState(itemProgress)
          return total + (state === "watched" ? 100 : episodeProgressPercent(itemProgress))
        }, 0) / episodes.length,
      )
    : 0

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    if (restoreScrollTop != null) {
      rail.scrollTop = restoreScrollTop
      return
    }
    const targetId = focusVideoId ?? autoPositionVideoId ?? (
      disableAutoPositioning ? undefined : currentVideoId
    )
    if (!targetId) return
    const targetKind = focusVideoId ? "focus" : autoPositionVideoId ? "auto" : "current"
    const key = `${targetKind}:${activeSeason}:${targetId}`
    if (positionedKey.current === key) return
    const targetVideo = videos.find((video) => video.id === targetId)
    if (targetVideo?.season == null || targetVideo.episode == null) return
    const episode = [...rail.querySelectorAll<HTMLElement>("[data-video-id]")].find(
      (candidate) => candidate.dataset.videoId === targetId,
    )
    if (!episode) return
    const railBounds = rail.getBoundingClientRect()
    const headerBounds = rail.querySelector<HTMLElement>("[data-episode-selector-header]")?.getBoundingClientRect()
    const top = Math.max(railBounds.top, headerBounds?.bottom ?? railBounds.top)
    rail.scrollTop = Math.max(0, rail.scrollTop + episode.getBoundingClientRect().top - top)
    positionedKey.current = key
  }, [activeSeason, autoPositionVideoId, currentVideoId, disableAutoPositioning, focusVideoId, restoreScrollTop, videos])

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest("[data-episode-context-menu]")) return
      setContextMenu(undefined)
    }
    const dismissKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(undefined)
    }
    document.addEventListener("pointerdown", dismiss, true)
    window.addEventListener("keydown", dismissKeyboard)
    return () => {
      document.removeEventListener("pointerdown", dismiss, true)
      window.removeEventListener("keydown", dismissKeyboard)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!seasonMenuOpen) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest("[data-episode-season-menu]")) return
      setSeasonMenuOpen(false)
    }
    const dismissKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSeasonMenuOpen(false)
    }
    document.addEventListener("pointerdown", dismiss, true)
    window.addEventListener("keydown", dismissKeyboard)
    return () => {
      document.removeEventListener("pointerdown", dismiss, true)
      window.removeEventListener("keydown", dismissKeyboard)
    }
  }, [seasonMenuOpen])

  const openContextMenu = (event: MouseEvent, video: Video) => {
    event.preventDefault()
    if (!onWatchAction) return
    openContextMenuAt(video, event.clientX, event.clientY)
  }

  const openContextMenuAt = (video: Video, clientX: number, clientY: number) => {
    const menuWidth = 250
    const menuHeight = 190
    setContextMenu({
      video,
      x: Math.max(8, Math.min(clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(clientY, window.innerHeight - menuHeight - 8)),
    })
  }

  const openKeyboardContextMenu = (event: ReactKeyboardEvent, video: Video) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
    event.preventDefault()
    if (!onWatchAction) return
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    const bounds = target.getBoundingClientRect()
    openContextMenuAt(video, bounds.right - 8, bounds.bottom - 8)
  }

  const runWatchAction = (targets: Video[], watched: boolean) => {
    if (!onWatchAction) return
    setContextMenu(undefined)
    setWatchPending(true)
    void onWatchAction(targets, watched)
      .catch(() => undefined)
      .finally(() => setWatchPending(false))
  }

  const chooseSeason = (nextSeason: number) => {
    setSeasonMenuOpen(false)
    onSeasonChange(nextSeason)
    setQuery("")
  }

  const handleSeasonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      setSeasonMenuOpen(false)
      return
    }
    if (event.key === "Tab") {
      setSeasonMenuOpen(false)
      return
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return
    if (!seasonMenuOpen && !["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return
    event.preventDefault()
    if (!seasonMenuOpen) {
      setSeasonMenuOpen(true)
      return
    }
    const currentIndex = seasons.indexOf(activeSeason)
    if (event.key === "ArrowDown") {
      chooseSeason(seasons[Math.min(seasons.length - 1, currentIndex + 1)] ?? activeSeason)
    } else if (event.key === "ArrowUp") {
      chooseSeason(seasons[Math.max(0, currentIndex - 1)] ?? activeSeason)
    } else if (event.key === "Home") {
      chooseSeason(seasons[0] ?? activeSeason)
    } else if (event.key === "End") {
      chooseSeason(seasons[seasons.length - 1] ?? activeSeason)
    } else if (event.key === "Enter" || event.key === " ") {
      setSeasonMenuOpen(false)
    }
  }

  return (
    <>
      <aside
        ref={railRef}
        className={`min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/40 backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
        aria-label="Episodes"
        onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
      >
        <div data-episode-selector-header className="sticky top-0 z-10 border-b border-white/8 bg-zinc-950/95 p-5 backdrop-blur sm:p-6">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
            Browse episodes
          </p>
          {show?.logo ? (
            <img
              className="mt-3 max-h-14 max-w-full object-contain object-left"
              src={show.logo}
              alt={show.name}
              referrerPolicy="no-referrer"
            />
          ) : (
            <h2 className="mt-2 line-clamp-2 font-display text-2xl font-semibold leading-tight">
              {show?.name ?? media?.name ?? "Episodes"}
            </h2>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            {[show?.releaseInfo, seasons.length + " " + (seasons.length === 1 ? "season" : "seasons"), videos.length + " episodes"]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {show?.description && (
            <p className="mt-3 line-clamp-3 max-w-2xl text-sm leading-6 text-zinc-300">{show.description}</p>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
          <span className="font-medium text-amber-300">{seasonProgress}% watched</span>
          <span className="text-zinc-500">{episodes.length} episodes in {seasonLabel(activeSeason)}</span>
        </div>
        <div className="mt-2 h-0.5 overflow-hidden bg-white/10">
          <span className="block h-full bg-amber-400" style={{ width: seasonProgress + "%" }} />
        </div>
        {seasons.length > 0 && (
          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1.5 justify-self-start text-xs font-medium text-zinc-300 outline-none transition-colors hover:text-white focus-visible:text-white focus-visible:ring-2 focus-visible:ring-amber-400 disabled:pointer-events-none disabled:opacity-35"
              aria-label="Previous season"
              disabled={!previousSeason}
              onClick={() => previousSeason !== undefined && chooseSeason(previousSeason)}
            >
              <ChevronLeft size={15} />
              <span>Prev</span>
            </button>
            <div className="relative justify-self-center" data-episode-season-menu>
              <span className="sr-only" id="episode-season-label">Season</span>
              <button
                type="button"
                className="flex h-9 min-w-32 items-center justify-between gap-3 rounded-lg border border-white/10 bg-zinc-900/90 px-3 text-xs font-medium text-zinc-100 shadow-lg shadow-black/20 outline-none transition-colors hover:border-white/20 hover:bg-zinc-800/90 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
                aria-labelledby="episode-season-label"
                aria-haspopup="listbox"
                aria-expanded={seasonMenuOpen}
                onClick={() => setSeasonMenuOpen((open) => !open)}
                onKeyDown={handleSeasonKeyDown}
              >
                {seasonLabel(activeSeason)}
                <ChevronDown
                  className={seasonMenuOpen ? "rotate-180 text-zinc-500 transition-transform" : "text-zinc-500 transition-transform"}
                  size={14}
                />
              </button>
              {seasonMenuOpen && (
                <div
                  className="absolute left-1/2 top-[calc(100%+0.4rem)] z-40 max-h-56 w-40 -translate-x-1/2 overflow-y-auto rounded-lg border border-white/10 bg-zinc-900 p-1 shadow-2xl shadow-black/60"
                  role="listbox"
                  aria-labelledby="episode-season-label"
                >
                  {seasons.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="option"
                      aria-selected={value === activeSeason}
                      className={value === activeSeason
                        ? "flex w-full items-center justify-between rounded-md bg-amber-400 px-3 py-2 text-left text-xs font-semibold text-zinc-950"
                        : "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"}
                      onClick={() => chooseSeason(value)}
                    >
                      {seasonLabel(value)}
                      {value === activeSeason && <Check size={13} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1.5 justify-self-end text-xs font-medium text-zinc-300 outline-none transition-colors hover:text-white focus-visible:text-white focus-visible:ring-2 focus-visible:ring-amber-400 disabled:pointer-events-none disabled:opacity-35"
              aria-label="Next season"
              disabled={!nextSeason}
              onClick={() => nextSeason !== undefined && chooseSeason(nextSeason)}
            >
              <span>Next</span>
              <ChevronRight size={15} />
            </button>
          </div>
        )}
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
          const itemProgress = progressForVideo(progress, video, media?.id)
          const state = episodeWatchState(itemProgress)
          const percent = episodeProgressPercent(itemProgress)
          const current = video.id === currentVideoId
          const status = state === "watched"
            ? "Watched"
            : state === "in-progress"
              ? `${percent}% watched`
              : "Not watched"
          return (
            <div className="group/episode relative" key={video.id}>
              <button
                type="button"
                data-video-id={video.id}
                className={`group relative flex w-full gap-3 rounded-xl p-2.5 pr-10 text-left transition hover:bg-white/7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  current ? "bg-amber-400/10 ring-1 ring-inset ring-amber-400/35" : ""
                }`}
                aria-current={current ? "true" : undefined}
                aria-haspopup={onWatchAction ? "menu" : undefined}
                aria-label={`${current ? "Currently playing " : "Play "}${episodeLabel(video)}: ${video.title ?? "Untitled episode"}. ${status}`}
                onClick={() => onSelect(video)}
                onContextMenu={(event) => openContextMenu(event, video)}
                onKeyDown={(event) => openKeyboardContextMenu(event, video)}
              >
                <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                  <EpisodeArtwork src={video.thumbnail} />
                  {!video.thumbnail && (
                    <div className="absolute inset-0 grid place-items-center text-zinc-700">
                      <Film size={18} />
                    </div>
                  )}
                  {state === "watched" && (
                    <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-amber-400 text-zinc-950">
                      <Check size={11} />
                    </span>
                  )}
                  {(state === "watched" || percent > 0) && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
                      <span
                        className="block h-full bg-amber-400"
                        style={{ width: `${state === "watched" ? 100 : percent}%` }}
                      />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <p className="line-clamp-2 text-sm font-medium leading-5">
                    <span className="mr-1.5 text-zinc-500">{video.episode ?? "–"}.</span>
                    {video.title ?? episodeLabel(video)}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-zinc-500">
                    {state === "in-progress" && <span>{percent}%</span>}
                    {video.released && <span>{displayDate(video.released)}</span>}
                    {video.runtime && <span>{video.runtime}</span>}
                  </p>
                </div>
              </button>
              {onWatchAction && (
                <button
                  type="button"
                  aria-label={`Actions for ${episodeLabel(video)}`}
                  aria-haspopup="menu"
                  className="absolute right-2 top-1/2 z-10 grid size-7 -translate-y-1/2 place-items-center rounded-md text-zinc-500 opacity-0 transition hover:bg-white/10 hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 group-hover/episode:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation()
                    const bounds = event.currentTarget.getBoundingClientRect()
                    openContextMenuAt(video, bounds.right, bounds.bottom)
                  }}
                  onContextMenu={(event) => openContextMenu(event, video)}
                >
                  <MoreHorizontal size={17} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      </aside>
      {renderContextMenu()}
    </>
  )

  function renderContextMenu() {
    if (!contextMenu || !onWatchAction) return null
    const season = seasonWatchVideos(
      videos,
      contextMenu.video.season ?? 1,
    )
    return createPortal(
      <EpisodeContextMenu
        video={contextMenu.video}
        progress={progress}
        season={season}
        pending={watchPending}
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onPlay={() => {
          setContextMenu(undefined)
          onSelect(contextMenu.video)
        }}
        onMark={(watched) => runWatchAction([contextMenu.video], watched)}
        onMarkSeason={(watched) => runWatchAction(season, watched)}
      />,
      document.body,
    )
  }
}

interface ContextMenuState {
  video: Video
  x: number
  y: number
}

function EpisodeContextMenu({
  video,
  progress,
  season,
  pending,
  style,
  onPlay,
  onMark,
  onMarkSeason,
}: {
  video: Video
  progress: WatchProgress[]
  season: Video[]
  pending: boolean
  style: CSSProperties
  onPlay: () => void
  onMark: (watched: boolean) => void
  onMarkSeason: (watched: boolean) => void
}) {
  const selectedProgress = progress.find((item) => item.videoId === video.id)
  const watched = episodeWatchState(selectedProgress) === "watched"
  const allSeasonWatched = season.length > 0 && season.every((entry) =>
    progress.some((item) => item.videoId === entry.id && item.watched),
  )
  return (
    <div
      data-episode-context-menu
      role="menu"
      className="fixed z-[80] w-60 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl shadow-black/70"
      style={style}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ContextMenuAction label="Play" icon={<Play size={15} />} disabled={pending} onClick={onPlay} />
      <ContextMenuAction
        label={watched ? "Mark as unwatched" : "Mark as watched"}
        icon={watched ? <RotateCcw size={15} /> : <Check size={15} />}
        disabled={pending}
        onClick={() => onMark(!watched)}
      />
      <ContextMenuAction
        label={allSeasonWatched ? "Mark season as unwatched" : "Mark season as watched"}
        icon={allSeasonWatched ? <RotateCcw size={15} /> : <Check size={15} />}
        disabled={pending || season.length === 0}
        onClick={() => onMarkSeason(!allSeasonWatched)}
      />
    </div>
  )
}

function ContextMenuAction({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon: ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
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
