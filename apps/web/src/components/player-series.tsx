import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Play, X } from "lucide-react"
import type { WatchProgress } from "../lib/api"
import type { Video } from "../lib/core"
import { episodeLabel } from "../lib/metadata"
import { EpisodeSelector } from "./episode-selector"

export interface PlayerSeriesContext {
  name: string
  videos: Video[]
  progress: WatchProgress[]
  currentVideoId: string
}

export const NEXT_EPISODE_PROMPT_WINDOW = 45
export const NEXT_EPISODE_COUNTDOWN = 15

export function shouldShowNextEpisodePrompt(
  position: number,
  duration: number,
  hasNextEpisode: boolean,
): boolean {
  return hasNextEpisode &&
    duration > 0 &&
    position >= 0 &&
    duration - position > 0 &&
    duration - position <= NEXT_EPISODE_PROMPT_WINDOW
}

export function PlayerEpisodeDrawer({
  open,
  context,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  context?: PlayerSeriesContext
  onOpenChange: (open: boolean) => void
  onSelect: (video: Video) => void
}) {
  const current = context?.videos.find((video) => video.id === context.currentVideoId)
  const [season, setSeason] = useState(current?.season ?? 1)

  useEffect(() => {
    setSeason(current?.season ?? 1)
  }, [current?.id, current?.season])

  if (!context) return null
  if (!open) {
    return (
      <button
        type="button"
        className="absolute right-0 top-1/2 z-30 flex h-28 w-11 -translate-y-1/2 items-center justify-center rounded-l-full border border-r-0 border-white/10 bg-zinc-950/95 text-zinc-300 backdrop-blur hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        aria-label="Open episode list"
        aria-expanded="false"
        onClick={() => onOpenChange(true)}
      >
        <ChevronLeft size={26} />
      </button>
    )
  }

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-[min(92vw,430px)] items-stretch p-2 pl-0">
      <button
        type="button"
        className="my-auto grid h-28 w-11 shrink-0 place-items-center rounded-l-full border border-r-0 border-white/10 bg-zinc-950/95 text-zinc-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        aria-label="Close episode list"
        aria-expanded="true"
        onClick={() => onOpenChange(false)}
      >
        <ChevronRight size={26} />
      </button>
      <EpisodeSelector
        videos={context.videos}
        progress={context.progress}
        season={season}
        currentVideoId={context.currentVideoId}
        className="h-full flex-1 rounded-l-none"
        onSeasonChange={setSeason}
        onSelect={(video) => {
          onOpenChange(false)
          onSelect(video)
        }}
      />
    </div>
  )
}

export function NextEpisodePrompt({
  seriesName,
  episode,
  position,
  duration,
  paused,
  autoplay,
  onDismiss,
  onVisibilityChange,
  onWatchNow,
}: {
  seriesName: string
  episode?: Video
  position: number
  duration: number
  paused: boolean
  autoplay: boolean
  onDismiss: () => void
  onVisibilityChange?: (visible: boolean) => void
  onWatchNow: () => void
}) {
  const [dismissed, setDismissed] = useState(false)
  const [countdown, setCountdown] = useState(NEXT_EPISODE_COUNTDOWN)
  const transitioned = useRef(false)
  const previousVisible = useRef(false)
  const watchNow = useRef(onWatchNow)
  watchNow.current = onWatchNow
  const visible = !dismissed &&
    shouldShowNextEpisodePrompt(position, duration, Boolean(episode))

  useEffect(() => {
    if (previousVisible.current === visible) return
    previousVisible.current = visible
    onVisibilityChange?.(visible)
  }, [onVisibilityChange, visible])

  useEffect(() => {
    if (!visible || !autoplay || paused || transitioned.current) return
    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current > 1) return current - 1
        window.clearInterval(timer)
        transitioned.current = true
        watchNow.current()
        return 0
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [autoplay, paused, visible])

  if (!visible || !episode) return null

  return (
    <section
      className="absolute bottom-24 right-4 z-20 w-[min(calc(100%_-_2rem),380px)] overflow-hidden rounded-2xl border border-white/12 bg-zinc-950/95 shadow-2xl shadow-black/70 backdrop-blur-xl sm:right-6"
      aria-label={`Next on ${seriesName}`}
      aria-live="polite"
    >
      <button
        type="button"
        className="absolute right-2 top-2 z-10 grid size-8 place-items-center rounded-full bg-black/65 text-zinc-300 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        aria-label="Dismiss next episode"
        onClick={() => {
          setDismissed(true)
          onDismiss()
        }}
      >
        <X size={16} />
      </button>
      {episode.thumbnail && (
        <img
          className="aspect-[2.2/1] w-full object-cover"
          src={episode.thumbnail}
          alt=""
          referrerPolicy="no-referrer"
        />
      )}
      <div className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
          Next on {seriesName}
        </p>
        <p className="mt-1 line-clamp-2 font-display text-base font-semibold text-white">
          {episode.title ?? episodeLabel(episode)}
        </p>
        <p className="mt-1 text-xs font-medium text-zinc-400">{episodeLabel(episode)}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            className="text-xs font-medium text-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            onClick={() => {
              setDismissed(true)
              onDismiss()
            }}
          >
            Dismiss
          </button>
          <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-lg bg-amber-400 px-4 text-sm font-semibold text-zinc-950 hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={() => {
              if (transitioned.current) return
              transitioned.current = true
              onWatchNow()
            }}
          >
            <Play className="fill-current" size={16} />
            Watch now{autoplay ? ` · ${countdown}s` : ""}
          </button>
        </div>
      </div>
    </section>
  )
}
