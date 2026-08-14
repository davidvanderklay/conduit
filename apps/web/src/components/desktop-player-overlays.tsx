import { useEffect, useState } from "react"
import {
  Captions,
  Languages,
  LoaderCircle,
  Maximize,
  Pause,
  Play,
  Scaling,
  SkipForward,
  Volume2,
} from "lucide-react"
import type { PlayerArtwork } from "../lib/api"

export function DesktopPlayerOpeningOverlay({
  artwork,
  title,
}: {
  artwork?: PlayerArtwork
  title: string
}) {
  const backgroundSources = [artwork?.background, artwork?.poster].filter(
    (source): source is string => Boolean(source),
  )
  const indicatorSources = [artwork?.logo, artwork?.poster, artwork?.background].filter(
    (source): source is string => Boolean(source),
  )
  const backgroundSignature = backgroundSources.join("|")
  const indicatorSignature = indicatorSources.join("|")
  const [backgroundIndex, setBackgroundIndex] = useState(0)
  const [indicatorIndex, setIndicatorIndex] = useState(0)

  useEffect(() => setBackgroundIndex(0), [backgroundSignature])
  useEffect(() => setIndicatorIndex(0), [indicatorSignature])

  const background = backgroundSources[backgroundIndex]
  const indicator = indicatorSources[indicatorIndex]

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black"
      role="status"
      aria-label="Video loading"
    >
      {background && (
        <img
          className="absolute inset-0 size-full object-cover"
          src={background}
          alt=""
          onError={() => setBackgroundIndex((current) => current + 1)}
        />
      )}
      <div className="absolute inset-0 bg-black/65" aria-hidden="true" />
      {indicator ? (
        <div className="absolute inset-0 grid place-items-center">
          <img
            className="desktop-player-opening-indicator max-h-[100px] w-[28%] max-w-[240px] object-contain"
            src={indicator}
            alt={title}
            onError={() => setIndicatorIndex((current) => current + 1)}
          />
        </div>
      ) : (
        <p className="absolute left-1/2 top-1/2 w-[min(80%,32rem)] -translate-x-1/2 -translate-y-1/2 text-center text-xl font-semibold text-white">
          {title}
        </p>
      )}
    </div>
  )
}

export function DesktopPlayerBufferingOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 grid place-items-center bg-black/55"
      role="status"
      aria-label="Video buffering"
    >
      <LoaderCircle
        className="desktop-player-buffering-indicator animate-spin text-white"
        aria-hidden="true"
      />
    </div>
  )
}

export function DesktopPlayerLoadingControls({
  title,
  hasNextEpisode,
  onBack,
}: {
  title: string
  hasNextEpisode: boolean
  onBack: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      <div
        data-player-chrome="top"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 bg-gradient-to-b from-black/85 via-black/45 to-transparent px-5 pb-6 pt-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            className="pointer-events-auto grid size-10 shrink-0 place-items-center rounded-full bg-black/60 text-zinc-200"
            type="button"
            aria-label="Back to details"
            data-native-overlay
            onClick={onBack}
          >
            <Play className="rotate-180 fill-current" size={21} />
          </button>
          <div className="min-w-0" data-native-overlay>
            <h2 className="truncate font-display text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 truncate text-xs text-zinc-400">Loading saved stream…</p>
          </div>
        </div>
        <button
          className="pointer-events-auto grid size-10 shrink-0 place-items-center rounded-full bg-black/60 text-zinc-200"
          type="button"
          aria-label="Fullscreen"
          data-native-overlay
          disabled
        >
          <Maximize size={20} />
        </button>
      </div>

      <div
        data-player-chrome="bottom"
        className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-4 pb-3 pt-8 sm:px-6"
      >
        <div className="native-controls-surface relative mx-auto max-w-7xl">
          <div className="flex items-center gap-3" data-native-overlay>
            <span className="player-time player-time-elapsed tabular-nums text-sm text-zinc-300">
              --:--
            </span>
            <div className="h-1.5 min-w-0 flex-1 rounded-full bg-white/25" aria-hidden="true" />
            <span className="player-time player-time-duration tabular-nums text-sm text-zinc-300">
              --:--
            </span>
          </div>

          <div
            className="pointer-events-auto mt-3 flex items-center gap-1 sm:gap-2"
            data-native-overlay
          >
            <LoadingControl label="Pause">
              <Pause size={22} />
            </LoadingControl>
            {hasNextEpisode && (
              <LoadingControl label="Next episode">
                <SkipForward size={21} />
              </LoadingControl>
            )}
            <LoadingControl label="Mute">
              <Volume2 size={21} />
            </LoadingControl>
            <div className="hidden h-1 w-20 rounded-full bg-white/30 sm:block" aria-hidden="true" />
            <div className="flex-1" />
            <LoadingControl label="Audio">
              <Languages size={21} />
            </LoadingControl>
            <LoadingControl label="Subtitles">
              <Captions size={22} />
            </LoadingControl>
            <LoadingControl label="Video scale">
              <Scaling size={21} />
            </LoadingControl>
          </div>
        </div>
      </div>
    </div>
  )
}

function LoadingControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      className="grid size-10 place-items-center rounded-lg bg-zinc-950 text-zinc-200"
      type="button"
      aria-label={label}
      data-native-overlay
      disabled
    >
      {children}
    </button>
  )
}
