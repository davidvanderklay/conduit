import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Captions,
  Languages,
  LoaderCircle,
  Maximize,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import type { InstalledAddon } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import {
  nativePlayerCommand,
  nativePlayerSnapshot,
  openNativePlayer,
  stopNativePlayer,
  toggleNativeFullscreen,
  type NativePlayerSnapshot,
  type NativeTrack,
} from "../lib/desktop"
import { loadSubtitles } from "../lib/core"
import { Card } from "./ui/card"

type TrackMenuName = "audio" | "subtitles"

export function DesktopPlayer({
  url,
  title,
  type,
  videoId,
  addons,
  onClose,
}: {
  url: string
  title: string
  type: string
  videoId: string
  addons: InstalledAddon[]
  onClose: () => void
}) {
  const [snapshot, setSnapshot] = useState<NativePlayerSnapshot>()
  const [error, setError] = useState<string>()
  const [controlsVisible, setControlsVisible] = useState(true)
  const [activeMenu, setActiveMenu] = useState<TrackMenuName>()
  const hideTimer = useRef<number | undefined>(undefined)

  const showControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2800)
  }, [])

  useEffect(() => {
    let cancelled = false
    let ready = false
    document.documentElement.classList.add("native-playback")
    void Promise.all([openNativePlayer(url, title), resolveAddonSubtitles(addons, type, videoId)])
      .then(async ([initial, addonSubtitles]) => {
        if (cancelled) return
        await attachAddonSubtitles(addonSubtitles)
        if (cancelled) return
        await nativePlayerCommand(["set_property", "pause", false])
        ready = true
        setSnapshot({ ...initial, paused: false })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    const poll = window.setInterval(() => {
      if (!ready) return
      void nativePlayerSnapshot()
        .then((next) => {
          if (!cancelled) setSnapshot(next)
        })
        .catch(() => undefined)
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      window.clearTimeout(hideTimer.current)
      document.documentElement.classList.remove("native-playback")
      void stopNativePlayer()
    }
  }, [addons, title, type, url, videoId])

  useEffect(() => {
    if (snapshot?.paused || activeMenu || error) {
      window.clearTimeout(hideTimer.current)
      setControlsVisible(true)
    } else {
      showControls()
    }
  }, [activeMenu, error, showControls, snapshot?.paused])

  const close = () => {
    void stopNativePlayer()
    onClose()
  }

  const togglePlayback = () => {
    if (!snapshot) return
    void nativePlayerCommand(["cycle", "pause"])
    setSnapshot((current) => (current ? { ...current, paused: !current.paused } : current))
    showControls()
  }

  const selectTrack = (property: "aid" | "sid", track: NativeTrack) => {
    void nativePlayerCommand(["set_property", property, track.id])
    setSnapshot((current) =>
      current
        ? {
            ...current,
            tracks: current.tracks.map((candidate) =>
              candidate.type === track.type
                ? { ...candidate, selected: candidate.id === track.id }
                : candidate,
            ),
          }
        : current,
    )
    setActiveMenu(undefined)
  }

  const audioTracks = snapshot?.tracks.filter((track) => track.type === "audio") ?? []
  const subtitleTracks = snapshot?.tracks.filter((track) => track.type === "sub") ?? []
  const selectedAudio = audioTracks.find((track) => track.selected)
  const selectedSubtitle = subtitleTracks.find((track) => track.selected)
  const chromeVisible =
    controlsVisible || Boolean(snapshot?.paused) || Boolean(activeMenu) || !snapshot

  return createPortal(
    <div
      className={`native-player fixed inset-0 z-50 overflow-hidden ${
        chromeVisible ? "cursor-default" : "cursor-none"
      }`}
      onMouseMove={showControls}
      onClick={togglePlayback}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-4 bg-gradient-to-b from-black/85 via-black/45 to-transparent px-5 pb-16 pt-5 transition-opacity duration-300 ${
          chromeVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <h2 className="min-w-0 truncate font-display text-lg font-semibold drop-shadow-lg">
          {title}
        </h2>
        <button
          className="pointer-events-auto shrink-0 rounded-full bg-black/40 p-2.5 text-zinc-200 backdrop-blur hover:bg-white/15"
          onClick={(event) => {
            event.stopPropagation()
            close()
          }}
          aria-label="Close playback"
        >
          <X size={21} />
        </button>
      </div>

      {error ? (
        <div className="absolute inset-0 grid place-items-center p-5">
          <Card className="w-full max-w-lg border-red-950 bg-zinc-950/95 p-6">
            <p className="font-medium text-red-400">Could not start mpv</p>
            <p className="mt-2 text-sm text-zinc-400">{error}</p>
            <p className="mt-3 text-xs text-zinc-600">
              Ensure the libmpv development package is available to the desktop application.
            </p>
          </Card>
        </div>
      ) : !snapshot ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-zinc-300 backdrop-blur">
            <LoaderCircle className="animate-spin" size={18} /> Starting native playback…
          </p>
        </div>
      ) : null}

      {snapshot && !error && (
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-4 pb-4 pt-20 transition-opacity duration-300 sm:px-6 ${
            chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative mx-auto max-w-7xl">
            {activeMenu === "audio" && (
              <TrackMenu
                title="Audio"
                tracks={audioTracks}
                empty="No selectable audio tracks."
                onSelect={(track) => selectTrack("aid", track)}
                onClose={() => setActiveMenu(undefined)}
              />
            )}
            {activeMenu === "subtitles" && (
              <TrackMenu
                title="Subtitles"
                tracks={subtitleTracks}
                empty="No embedded or add-on subtitles."
                allowOff
                onSelect={(track) => selectTrack("sid", track)}
                onOff={() => {
                  void nativePlayerCommand(["set_property", "sid", "no"])
                  setSnapshot((current) =>
                    current
                      ? {
                          ...current,
                          tracks: current.tracks.map((track) =>
                            track.type === "sub" ? { ...track, selected: false } : track,
                          ),
                        }
                      : current,
                  )
                  setActiveMenu(undefined)
                }}
                onClose={() => setActiveMenu(undefined)}
              />
            )}

            <input
              className="block h-1.5 w-full cursor-pointer accent-amber-400"
              type="range"
              min={0}
              max={snapshot.duration || 0}
              step={0.1}
              value={Math.min(snapshot.position, snapshot.duration || 0)}
              aria-label="Seek"
              onChange={(event) => {
                const position = Number(event.target.value)
                void nativePlayerCommand(["seek", position, "absolute+exact"])
                setSnapshot((current) => (current ? { ...current, position } : current))
              }}
            />

            <div className="mt-3 flex items-center gap-1 sm:gap-2">
              <PlayerIcon label={snapshot.paused ? "Play" : "Pause"} onClick={togglePlayback}>
                {snapshot.paused ? <Play size={22} /> : <Pause size={22} />}
              </PlayerIcon>
              <PlayerIcon
                label={snapshot.volume === 0 ? "Unmute" : "Mute"}
                onClick={() => {
                  const volume = snapshot.volume === 0 ? 100 : 0
                  void nativePlayerCommand(["set_property", "volume", volume])
                  setSnapshot((current) => (current ? { ...current, volume } : current))
                }}
              >
                {snapshot.volume === 0 ? <VolumeX size={21} /> : <Volume2 size={21} />}
              </PlayerIcon>
              <input
                className="hidden h-1 w-20 accent-amber-400 sm:block"
                type="range"
                min={0}
                max={100}
                value={snapshot.volume}
                aria-label="Volume"
                onChange={(event) => {
                  const volume = Number(event.target.value)
                  void nativePlayerCommand(["set_property", "volume", volume])
                  setSnapshot((current) => (current ? { ...current, volume } : current))
                }}
              />
              <span className="ml-1 text-xs tabular-nums text-zinc-300">
                {formatTime(snapshot.position)}
                <span className="text-zinc-500"> / {formatTime(snapshot.duration)}</span>
              </span>

              <div className="flex-1" />

              <PlayerIcon
                label={`Audio${selectedAudio ? `: ${trackName(selectedAudio, "Audio")}` : ""}`}
                active={activeMenu === "audio"}
                onClick={() =>
                  setActiveMenu((current) => (current === "audio" ? undefined : "audio"))
                }
              >
                <Languages size={21} />
              </PlayerIcon>
              <PlayerIcon
                label={`Subtitles${
                  selectedSubtitle ? `: ${trackName(selectedSubtitle, "Subtitles")}` : ": Off"
                }`}
                active={activeMenu === "subtitles"}
                onClick={() =>
                  setActiveMenu((current) => (current === "subtitles" ? undefined : "subtitles"))
                }
              >
                <Captions size={22} />
              </PlayerIcon>
              <PlayerIcon label="Fullscreen" onClick={() => void toggleNativeFullscreen()}>
                <Maximize size={20} />
              </PlayerIcon>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

function PlayerIcon({
  label,
  active,
  children,
  onClick,
}: {
  label: string
  active?: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={`rounded-lg p-2.5 text-zinc-200 transition hover:bg-white/15 hover:text-white ${
        active ? "bg-white/20 text-amber-300" : ""
      }`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function TrackMenu({
  title,
  tracks,
  empty,
  allowOff,
  onSelect,
  onOff,
  onClose,
}: {
  title: string
  tracks: NativeTrack[]
  empty: string
  allowOff?: boolean
  onSelect: (track: NativeTrack) => void
  onOff?: () => void
  onClose: () => void
}) {
  return (
    <div className="absolute bottom-14 right-0 max-h-[55vh] w-80 overflow-y-auto rounded-xl border border-white/10 bg-zinc-950/95 p-2 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        <button
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()} menu`}
        >
          <X size={15} />
        </button>
      </div>
      {allowOff && (
        <button
          className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm ${
            tracks.some((track) => track.selected)
              ? "text-zinc-400 hover:bg-zinc-800"
              : "bg-amber-400 text-zinc-950"
          }`}
          onClick={onOff}
        >
          Off
        </button>
      )}
      {tracks.map((track) => (
        <button
          key={track.id}
          className={`mb-1 block w-full rounded-lg px-3 py-2 text-left ${
            track.selected ? "bg-amber-400 text-zinc-950" : "text-zinc-300 hover:bg-zinc-800"
          }`}
          onClick={() => onSelect(track)}
        >
          <span className="block text-sm font-medium">{trackName(track, title)}</span>
          <span className={`text-xs ${track.selected ? "text-zinc-800" : "text-zinc-500"}`}>
            {[track.codec?.toUpperCase(), track.lang, track.external ? "External" : "Embedded"]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
      ))}
      {!tracks.length && <p className="px-3 py-2 text-sm text-zinc-500">{empty}</p>}
    </div>
  )
}

function trackName(track: NativeTrack, fallback: string): string {
  return track.title || languageName(track.lang) || `${fallback} ${track.id}`
}

interface ResolvedAddonSubtitle {
  url: string
  language: string
  display: string
}

async function resolveAddonSubtitles(
  addons: InstalledAddon[],
  type: string,
  videoId: string,
): Promise<ResolvedAddonSubtitle[]> {
  const candidates = addonsForResource(addons, "subtitles", type, videoId)
  const results = await Promise.allSettled(
    candidates.map(async (addon) => ({
      addon,
      subtitles: await loadSubtitles(addon.manifestUrl, type, videoId),
    })),
  )
  return results.flatMap((result) => {
    if (result.status === "rejected") return []
    return result.value.subtitles.flatMap((subtitle) => {
      if (!subtitle.url) return []
      const language =
        subtitle.lang ??
        subtitle.language ??
        subtitle.languageCode ??
        subtitle.locale ??
        subtitle.label ??
        "und"
      return [
        {
          url: subtitle.url,
          language,
          display: `${languageName(language) || language} · ${result.value.addon.manifest.name}`,
        },
      ]
    })
  })
}

async function attachAddonSubtitles(subtitles: ResolvedAddonSubtitle[]): Promise<void> {
  for (const subtitle of subtitles) {
    await nativePlayerCommand([
      "sub-add",
      subtitle.url,
      "auto",
      subtitle.display,
      subtitle.language,
    ]).catch(() => undefined)
  }
}

function languageName(code?: string): string | undefined {
  if (!code) return undefined
  try {
    return new Intl.DisplayNames([navigator.language], { type: "language" }).of(
      code.replace("_", "-"),
    )
  } catch {
    return code
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00"
  const rounded = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remaining = rounded % 60
  return hours
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`
    : `${minutes}:${remaining.toString().padStart(2, "0")}`
}
