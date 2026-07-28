import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Captions,
  Languages,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import type { InstalledAddon } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import {
  nativePlayerCommand,
  nativeFullscreen,
  nativePlayerSnapshot,
  openNativePlayer,
  redrawNativeSurface,
  refreshNativeSurface,
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
  const [fullscreen, setFullscreen] = useState(false)
  const [addonSubtitles, setAddonSubtitles] = useState<ResolvedAddonSubtitle[]>([])
  const [selectedAddonSubtitle, setSelectedAddonSubtitle] = useState<string>()
  const hideTimer = useRef<number | undefined>(undefined)
  const closing = useRef(false)
  const audioButton = useRef<HTMLDivElement>(null)
  const subtitleButton = useRef<HTMLDivElement>(null)
  const previousMenu = useRef<TrackMenuName | undefined>(undefined)

  const showControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2800)
  }, [])

  const redrawControls = useCallback(() => {
    window.requestAnimationFrame(() => void redrawNativeSurface())
  }, [])

  const resetControlsSurface = useCallback(() => {
    window.requestAnimationFrame(() => void refreshNativeSurface())
  }, [])

  useEffect(() => {
    let cancelled = false
    document.documentElement.classList.add("native-playback")
    void openNativePlayer(url, title)
      .then(async (initial) => {
        if (cancelled) return
        setSnapshot(initial)
        const resolved = await resolveAddonSubtitles(addons, type, videoId)
        if (!cancelled) setAddonSubtitles(resolved)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    const poll = window.setInterval(() => {
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
      if (!closing.current) void stopNativePlayer()
    }
  }, [addons, title, type, url, videoId])

  useEffect(() => {
    const syncFullscreen = () => {
      void nativeFullscreen()
        .then(setFullscreen)
        .catch(() => undefined)
    }
    syncFullscreen()
    window.addEventListener("resize", syncFullscreen)
    return () => window.removeEventListener("resize", syncFullscreen)
  }, [])

  useEffect(() => {
    if (snapshot?.paused || activeMenu || error) {
      window.clearTimeout(hideTimer.current)
      setControlsVisible(true)
    } else {
      showControls()
    }
  }, [activeMenu, error, showControls, snapshot?.paused])

  const close = async () => {
    if (closing.current) return
    closing.current = true
    try {
      await stopNativePlayer()
    } finally {
      document.documentElement.classList.remove("native-playback")
      onClose()
      window.requestAnimationFrame(() => void refreshNativeSurface())
    }
  }

  const togglePlayback = useCallback(() => {
    if (!snapshot) return
    void nativePlayerCommand(["cycle", "pause"])
    setSnapshot((current) => (current ? { ...current, paused: !current.paused } : current))
    showControls()
  }, [showControls, snapshot])

  const closeTrackMenu = useCallback(() => {
    setActiveMenu(undefined)
  }, [])

  const toggleTrackMenu = useCallback((menu: TrackMenuName) => {
    setActiveMenu((current) => (current === menu ? undefined : menu))
  }, [])

  const seekRelative = useCallback((seconds: number) => {
    if (!snapshot) return
    void nativePlayerCommand(["seek", seconds, "relative+exact"])
    setSnapshot((current) =>
      current
        ? {
            ...current,
            position: Math.max(0, Math.min(current.duration || Infinity, current.position + seconds)),
          }
        : current,
    )
    showControls()
  }, [showControls, snapshot])

  useEffect(() => {
    if (!activeMenu) return

    const dismissOutside = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        (target.closest("[data-track-menu]") || target.closest("[data-track-menu-trigger]"))
      ) {
        return
      }

      // Closing on pointerdown makes dismissal immediate. Suppress the click
      // generated by this same gesture so it cannot also toggle playback.
      const suppressClick = (click: MouseEvent) => {
        click.preventDefault()
        click.stopImmediatePropagation()
      }
      document.addEventListener("click", suppressClick, { capture: true, once: true })
      window.setTimeout(() => document.removeEventListener("click", suppressClick, true), 0)
      closeTrackMenu()
    }

    document.addEventListener("pointerdown", dismissOutside, true)
    return () => document.removeEventListener("pointerdown", dismissOutside, true)
  }, [activeMenu, closeTrackMenu])

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return
      }

      if (event.key === "Escape" && activeMenu) {
        event.preventDefault()
        closeTrackMenu()
        return
      }
      if (activeMenu) return

      if (event.key === "ArrowLeft") {
        event.preventDefault()
        seekRelative(-10)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        seekRelative(10)
      } else if (event.key === " " || event.key.toLowerCase() === "k") {
        event.preventDefault()
        togglePlayback()
      }
    }

    window.addEventListener("keydown", handleKeyboard)
    return () => window.removeEventListener("keydown", handleKeyboard)
  }, [activeMenu, closeTrackMenu, seekRelative, togglePlayback])

  const selectTrack = async (property: "aid" | "sid", track: NativeTrack) => {
    try {
      await nativePlayerCommand(["set", property, track.id])
      if (property === "sid") setSelectedAddonSubtitle(undefined)
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
      closeTrackMenu()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const audioTracks = snapshot?.tracks.filter((track) => track.type === "audio") ?? []
  const subtitleTracks = snapshot?.tracks.filter((track) => track.type === "sub") ?? []
  const selectedAudio = audioTracks.find((track) => track.selected)
  const selectedSubtitle = subtitleTracks.find((track) => track.selected)
  const chromeVisible =
    controlsVisible || Boolean(snapshot?.paused) || Boolean(activeMenu) || !snapshot

  useLayoutEffect(() => {
    if (previousMenu.current && !activeMenu) {
      resetControlsSurface()
    } else {
      redrawControls()
    }
    previousMenu.current = activeMenu
  }, [activeMenu, chromeVisible, redrawControls, resetControlsSurface])

  return createPortal(
    <div
      className={`native-player fixed inset-0 z-50 select-none overflow-hidden ${
        chromeVisible ? "cursor-default" : "cursor-none"
      }`}
      onMouseMove={showControls}
    >
      <div
        className={`absolute inset-0 z-0 ${activeMenu ? "pointer-events-none" : ""}`}
        onClick={togglePlayback}
        aria-hidden="true"
      />
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 bg-gradient-to-b from-black/85 via-black/45 to-transparent transition-all duration-300 ${
          fullscreen ? "px-10 pb-24 pt-8" : "px-5 pb-16 pt-5"
        } ${
          chromeVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <h2
          className={`min-w-0 truncate font-display font-semibold drop-shadow-lg ${
            fullscreen ? "text-2xl" : "text-lg"
          }`}
        >
          {title}
        </h2>
        <button
          className={`pointer-events-auto shrink-0 rounded-full bg-black/60 text-zinc-200 hover:bg-white/15 ${
            fullscreen ? "p-3.5 [&_svg]:size-6" : "p-2.5"
          }`}
          onClick={(event) => {
            event.stopPropagation()
            void close()
          }}
          aria-label="Close playback"
        >
          <X size={21} />
        </button>
      </div>

      {error ? (
        <div className="absolute inset-0 z-10 grid place-items-center p-5">
          <Card className="w-full max-w-lg border-red-950 bg-zinc-950/95 p-6">
            <p className="font-medium text-red-400">Could not start mpv</p>
            <p className="mt-2 text-sm text-zinc-400">{error}</p>
            <p className="mt-3 text-xs text-zinc-600">
              Ensure the libmpv development package is available to the desktop application.
            </p>
          </Card>
        </div>
      ) : !snapshot ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <p className="flex items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-zinc-300">
            <LoaderCircle className="animate-spin" size={18} /> Starting native playback…
          </p>
        </div>
      ) : null}

      {snapshot && !error && (
        <div
          className={`absolute inset-x-0 bottom-0 z-10 transition-all duration-300 ${
            fullscreen ? "px-10 pb-8 pt-28" : "px-4 pb-4 pt-20 sm:px-6"
          } ${
            chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={(event) => event.stopPropagation()}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === "opacity") {
              resetControlsSurface()
            }
          }}
        >
          <div className={`relative mx-auto ${fullscreen ? "max-w-none" : "max-w-7xl"}`}>
            {activeMenu === "audio" && (
              <TrackMenu
                title="Audio"
                anchor={audioButton}
                tracks={audioTracks}
                empty="No selectable audio tracks."
                onSelect={(track) => void selectTrack("aid", track)}
                onClose={closeTrackMenu}
              />
            )}
            {activeMenu === "subtitles" && (
              <TrackMenu
                title="Subtitles"
                anchor={subtitleButton}
                tracks={subtitleTracks}
                empty="No embedded or add-on subtitles."
                addonSubtitles={addonSubtitles}
                selectedAddonSubtitle={selectedAddonSubtitle}
                allowOff
                onSelect={(track) => void selectTrack("sid", track)}
                onSelectAddon={async (subtitle) => {
                  try {
                    await nativePlayerCommand([
                      "sub-add",
                      subtitle.url,
                      "select",
                      subtitle.display,
                      subtitle.language,
                    ])
                    setSelectedAddonSubtitle(subtitle.key)
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
                    closeTrackMenu()
                  } catch (cause: unknown) {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  }
                }}
                onOff={async () => {
                  try {
                    await nativePlayerCommand(["set", "sid", "no"])
                    setSelectedAddonSubtitle(undefined)
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
                    closeTrackMenu()
                  } catch (cause: unknown) {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  }
                }}
                onClose={closeTrackMenu}
              />
            )}

            <input
              className={`player-seek block w-full cursor-pointer ${
                fullscreen ? "h-2" : "h-1.5"
              }`}
              style={
                {
                  "--player-progress": `${
                    snapshot.duration > 0
                      ? Math.min(100, (snapshot.position / snapshot.duration) * 100)
                      : 0
                  }%`,
                } as React.CSSProperties
              }
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

            <div
              className={`flex items-center ${
                fullscreen ? "mt-5 gap-3" : "mt-3 gap-1 sm:gap-2"
              }`}
            >
              <PlayerIcon
                label="Back 10 seconds"
                fullscreen={fullscreen}
                onClick={() => seekRelative(-10)}
              >
                <RotateCcw size={21} />
                <span className="absolute text-[9px] font-bold">10</span>
              </PlayerIcon>
              <PlayerIcon
                label={snapshot.paused ? "Play" : "Pause"}
                fullscreen={fullscreen}
                onClick={togglePlayback}
              >
                {snapshot.paused ? <Play size={22} /> : <Pause size={22} />}
              </PlayerIcon>
              <PlayerIcon
                label="Forward 10 seconds"
                fullscreen={fullscreen}
                onClick={() => seekRelative(10)}
              >
                <RotateCw size={21} />
                <span className="absolute text-[9px] font-bold">10</span>
              </PlayerIcon>
              <PlayerIcon
                label={snapshot.volume === 0 ? "Unmute" : "Mute"}
                fullscreen={fullscreen}
                onClick={() => {
                  const volume = snapshot.volume === 0 ? 100 : 0
                  void nativePlayerCommand(["set", "volume", volume])
                  setSnapshot((current) => (current ? { ...current, volume } : current))
                }}
              >
                {snapshot.volume === 0 ? <VolumeX size={21} /> : <Volume2 size={21} />}
              </PlayerIcon>
              <input
                className={`hidden h-1 accent-amber-400 sm:block ${
                  fullscreen ? "w-32" : "w-20"
                }`}
                type="range"
                min={0}
                max={100}
                value={snapshot.volume}
                aria-label="Volume"
                onChange={(event) => {
                  const volume = Number(event.target.value)
                  void nativePlayerCommand(["set", "volume", volume])
                  setSnapshot((current) => (current ? { ...current, volume } : current))
                }}
              />
              <span
                className={`ml-1 tabular-nums text-zinc-300 ${
                  fullscreen ? "text-sm" : "text-xs"
                }`}
              >
                {formatTime(snapshot.position)}
                <span className="text-zinc-500"> / {formatTime(snapshot.duration)}</span>
              </span>

              <div className="flex-1" />

              <div ref={audioButton} data-track-menu-trigger>
                <PlayerIcon
                  label={`Audio${selectedAudio ? `: ${trackName(selectedAudio, "Audio")}` : ""}`}
                  active={activeMenu === "audio"}
                  fullscreen={fullscreen}
                  onClick={() => toggleTrackMenu("audio")}
                >
                  <Languages size={21} />
                </PlayerIcon>
              </div>
              <div ref={subtitleButton} data-track-menu-trigger>
                <PlayerIcon
                  label={`Subtitles${
                    selectedSubtitle ? `: ${trackName(selectedSubtitle, "Subtitles")}` : ": Off"
                  }`}
                  active={activeMenu === "subtitles"}
                  fullscreen={fullscreen}
                  onClick={() => toggleTrackMenu("subtitles")}
                >
                  <Captions size={22} />
                </PlayerIcon>
              </div>
              <PlayerIcon
                label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                fullscreen={fullscreen}
                onClick={() => {
                  void toggleNativeFullscreen().then(setFullscreen)
                }}
              >
                {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
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
  fullscreen,
  children,
  onClick,
}: {
  label: string
  active?: boolean
  fullscreen?: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={`relative grid place-items-center rounded-lg bg-black/35 text-zinc-200 shadow-sm transition hover:bg-white/15 hover:text-white ${
        fullscreen ? "size-12 [&_svg]:size-7" : "size-10"
      } ${
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
  anchor,
  tracks,
  empty,
  allowOff,
  addonSubtitles,
  selectedAddonSubtitle,
  onSelect,
  onSelectAddon,
  onOff,
  onClose,
}: {
  title: string
  anchor: React.RefObject<HTMLElement | null>
  tracks: NativeTrack[]
  empty: string
  allowOff?: boolean
  addonSubtitles?: ResolvedAddonSubtitle[]
  selectedAddonSubtitle?: string
  onSelect: (track: NativeTrack) => void
  onSelectAddon?: (subtitle: ResolvedAddonSubtitle) => void
  onOff?: () => void
  onClose: () => void
}) {
  const [position, setPosition] = useState({ bottom: 80, right: 24, maxHeight: 400 })

  useLayoutEffect(() => {
    const updatePosition = () => {
      const bounds = anchor.current?.getBoundingClientRect()
      if (!bounds) return
      setPosition({
        bottom: Math.max(16, window.innerHeight - bounds.top + 10),
        right: Math.max(16, window.innerWidth - bounds.right),
        maxHeight: Math.max(160, Math.min(window.innerHeight * 0.6, bounds.top - 24)),
      })
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [anchor])

  return createPortal(
    <div
      data-track-menu
      className="fixed z-[100] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 p-2 shadow-2xl"
      style={position}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
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
            tracks.some((track) => track.selected) || selectedAddonSubtitle
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
      {addonSubtitles?.map((subtitle) => (
        <button
          key={subtitle.key}
          className={`mb-1 block w-full rounded-lg px-3 py-2 text-left ${
            selectedAddonSubtitle === subtitle.key
              ? "bg-amber-400 text-zinc-950"
              : "text-zinc-300 hover:bg-zinc-800"
          }`}
          onClick={() => onSelectAddon?.(subtitle)}
        >
          <span className="block text-sm font-medium">{subtitle.display}</span>
          <span
            className={`text-xs ${
              selectedAddonSubtitle === subtitle.key ? "text-zinc-800" : "text-zinc-500"
            }`}
          >
            Add-on subtitle
          </span>
        </button>
      ))}
      {!tracks.length && !addonSubtitles?.length && (
        <p className="px-3 py-2 text-sm text-zinc-500">{empty}</p>
      )}
    </div>,
    document.body,
  )
}

function trackName(track: NativeTrack, fallback: string): string {
  return track.title || languageName(track.lang) || `${fallback} ${track.id}`
}

interface ResolvedAddonSubtitle {
  key: string
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
    return result.value.subtitles.flatMap((subtitle, index) => {
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
          key: `${result.value.addon.id}:${subtitle.id || index}`,
          url: subtitle.url,
          language,
          display: `${languageName(language) || language} · ${result.value.addon.manifest.name}`,
        },
      ]
    })
  })
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
