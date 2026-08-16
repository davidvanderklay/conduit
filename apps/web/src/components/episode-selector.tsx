import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  Check,
  ChevronDown,
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
  profileId,
  media,
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
  profileId?: string
  media?: WatchActionMedia
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
  const positionedKey = useRef<string | undefined>(undefined)
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

  const openContextMenu = (event: MouseEvent, video: Video) => {
    event.preventDefault()
    if (!profileId || !media || !onWatchAction) return
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
    if (!profileId || !media || !onWatchAction) return
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

  return (
    <>
      <aside
        ref={railRef}
        className={`min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/40 backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
        aria-label="Episodes"
        onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
      >
        <div data-episode-selector-header className="sticky top-0 z-10 border-b border-white/8 bg-zinc-950/95 p-3 backdrop-blur">
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
                className="episode-season-select h-9 min-w-28 appearance-none rounded-lg border border-white/10 bg-zinc-900/90 pl-3 pr-8 text-xs font-medium text-zinc-100 shadow-lg shadow-black/20 outline-none transition-colors hover:border-white/20 hover:bg-zinc-800/90 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
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
                aria-haspopup={profileId && media ? "menu" : undefined}
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
              {profileId && media && onWatchAction && (
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
    if (!contextMenu || !media || !profileId || !onWatchAction) return null
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
