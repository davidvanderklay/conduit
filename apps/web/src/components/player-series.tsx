import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Play, X } from "lucide-react"
import type { QueueItem, WatchProgress } from "../lib/api"
import type { Video } from "../lib/core"
import type { PlayerUpNext, QueueControls, QueueMedia } from "../lib/queue"
import type { WatchActionMedia } from "../lib/watch-actions"
import { EpisodeSelector, type EpisodeSelectorShow } from "./episode-selector"
import { QueueHeader, QueueList } from "./queue"

export interface PlayerSeriesContext {
  name: string
  show?: EpisodeSelectorShow
  media?: WatchActionMedia
  onWatchAction?: (targets: Video[], watched: boolean) => Promise<void>
  videos: Video[]
  progress: WatchProgress[]
  currentVideoId: string
}

/** Drawer state: closed, open, or opened from the queue button. */
export type PlayerDrawerOpen = boolean | "queue"

/** The queue as the player sees it, wherever the data and writes actually live. */
export interface PlayerQueue {
  controls: QueueControls
  /** The playing series, so its episodes can be queued from the drawer. */
  media?: QueueMedia
  onPlay: (item: QueueItem) => void
}

export const NEXT_EPISODE_PROMPT_WINDOW = 45
export const NEXT_EPISODE_COUNTDOWN = 15

/** Tooltip for the player's skip-forward control. */
export function nextControlLabel(upNext?: PlayerUpNext): string {
  if (upNext?.queued) return `Up next: ${upNext.title}`
  return `Next episode${upNext?.detail ? `: ${upNext.detail}` : ""}`
}

export function shouldShowNextEpisodePrompt(
  position: number,
  duration: number,
  hasNextEpisode: boolean,
): boolean {
  return (
    hasNextEpisode &&
    duration > 0 &&
    position >= 0 &&
    duration - position > 0 &&
    duration - position <= NEXT_EPISODE_PROMPT_WINDOW
  )
}

/**
 * Right-edge drawer with the episode list and, beside it, the queue. The queue
 * column appears once something is queued, so adding episodes shows up live,
 * and always when opened as "queue" from the player's queue button. Movies get
 * the queue column alone. The edge handle only exists for series.
 */
export function PlayerEpisodeDrawer({
  open,
  handleVisible = true,
  context,
  queue,
  onOpenChange,
  onSelect,
}: {
  open: PlayerDrawerOpen
  handleVisible?: boolean
  context?: PlayerSeriesContext
  queue?: PlayerQueue
  onOpenChange: (open: boolean) => void
  onSelect: (video: Video) => void
}) {
  const current = context?.videos.find((video) => video.id === context.currentVideoId)
  const [season, setSeason] = useState(current?.season ?? 1)
  const [manualPositioningDisabled, setManualPositioningDisabled] = useState(false)

  useEffect(() => {
    if (open) setManualPositioningDisabled(false)
  }, [open])

  useEffect(() => {
    if (manualPositioningDisabled) return
    setSeason(current?.season ?? 1)
  }, [current?.id, current?.season, manualPositioningDisabled])

  useEffect(() => {
    if (!open) return

    const dismissOutside = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          "[data-player-episode-drawer], [data-episode-context-menu], [data-player-drawer-toggle]",
        )
      ) {
        return
      }
      onOpenChange(false)
    }

    document.addEventListener("pointerdown", dismissOutside, true)
    return () => document.removeEventListener("pointerdown", dismissOutside, true)
  }, [onOpenChange, open])

  const queueSize = queue?.controls.items.length ?? 0
  const queueVisible = Boolean(queue) && (queueSize > 0 || !context || open === "queue")
  const drawerName = context ? "episode list" : "queue"
  if (!open) {
    if (!context) return null
    return (
      <button
        type="button"
        className={`absolute right-0 top-1/2 z-30 flex h-28 w-11 -translate-y-1/2 items-center justify-center rounded-l-full border border-r-0 border-white/10 bg-zinc-950/95 text-zinc-300 backdrop-blur hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
          handleVisible ? "visible" : "pointer-events-none invisible"
        }`}
        data-native-overlay
        data-overlay-interactive
        aria-label={`Open ${drawerName}`}
        aria-expanded="false"
        onClick={() => onOpenChange(true)}
      >
        <ChevronLeft size={26} />
      </button>
    )
  }

  return (
    <div
      data-player-episode-drawer
      data-native-overlay
      data-overlay-interactive
      className="absolute inset-y-0 right-0 z-30 flex max-w-[96vw] items-stretch"
    >
      <button
        type="button"
        className="my-auto grid h-28 w-11 shrink-0 place-items-center rounded-l-full border border-r-0 border-white/10 bg-zinc-950/95 text-zinc-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        aria-label={`Close ${drawerName}`}
        aria-expanded="true"
        onClick={() => onOpenChange(false)}
      >
        <ChevronRight size={26} />
      </button>
      {queue && queueVisible && (
        <section
          className={`flex min-h-0 shrink-0 flex-col border-l border-white/10 bg-zinc-950/95 backdrop-blur-xl ${
            context ? "w-48" : "w-[min(80vw,360px)]"
          }`}
          aria-label="Queue"
        >
          <div className="border-b border-white/8 px-3 py-2">
            <QueueHeader queue={queue.controls} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {queueSize > 0 ? (
              <QueueList
                queue={queue.controls}
                compact={Boolean(context)}
                onPlay={(item) => {
                  onOpenChange(false)
                  queue.onPlay(item)
                }}
              />
            ) : (
              <p className="px-2 py-10 text-center text-xs leading-5 text-zinc-500">
                Your queue is empty
              </p>
            )}
          </div>
        </section>
      )}
      {context && (
        <EpisodeSelector
          videos={context.videos}
          progress={context.progress}
          show={context.show}
          media={context.media}
          queue={queue?.controls}
          queueMedia={queue?.media}
          onWatchAction={context.onWatchAction}
          season={season}
          currentVideoId={context.currentVideoId}
          disableAutoPositioning={manualPositioningDisabled}
          className="h-full w-[min(80vw,30vw,576px)] min-w-72 !rounded-none"
          onSeasonChange={(nextSeason) => {
            setManualPositioningDisabled(true)
            setSeason(nextSeason)
          }}
          onScroll={() => setManualPositioningDisabled(true)}
          onSelect={(video) => {
            onOpenChange(false)
            onSelect(video)
          }}
        />
      )}
    </div>
  )
}

export function NextEpisodePrompt({
  upNext,
  position,
  duration,
  paused,
  autoplay,
  onDismiss,
  onVisibilityChange,
  onWatchNow,
  visible: visibleOverride,
  contained = false,
}: {
  upNext?: PlayerUpNext
  position: number
  duration: number
  paused: boolean
  autoplay: boolean
  onDismiss: () => void
  onVisibilityChange?: (visible: boolean) => void
  onWatchNow: () => void
  visible?: boolean
  contained?: boolean
}) {
  const [dismissed, setDismissed] = useState(false)
  const [countdown, setCountdown] = useState(NEXT_EPISODE_COUNTDOWN)
  const transitioned = useRef(false)
  const previousVisible = useRef(false)
  const watchNow = useRef(onWatchNow)
  watchNow.current = onWatchNow
  const visible =
    !dismissed &&
    (visibleOverride ?? shouldShowNextEpisodePrompt(position, duration, Boolean(upNext)))

  useEffect(() => {
    setDismissed(false)
    setCountdown(NEXT_EPISODE_COUNTDOWN)
    transitioned.current = false
  }, [upNext?.key])

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

  if (!visible || !upNext) return null

  return (
    <section
      data-native-overlay
      data-overlay-interactive
      className={`${contained ? "relative" : "absolute bottom-24 right-4 sm:right-6"} pointer-events-auto z-20 w-[min(calc(100%_-_2rem),380px)] overflow-hidden rounded-2xl border border-white/12 bg-zinc-950/95 shadow-2xl shadow-black/70 backdrop-blur-xl`}
      aria-label={upNext.heading}
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
      {upNext.artwork && (
        <img
          className="aspect-[2.2/1] w-full object-cover"
          src={upNext.artwork}
          alt=""
          referrerPolicy="no-referrer"
        />
      )}
      <div className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
          {upNext.heading}
        </p>
        <p className="mt-1 line-clamp-2 font-display text-base font-semibold text-white">
          {upNext.title}
        </p>
        {upNext.detail && (
          <p className="mt-1 text-xs font-medium text-zinc-400">{upNext.detail}</p>
        )}
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
