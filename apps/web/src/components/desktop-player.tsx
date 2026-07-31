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
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import type { InstalledAddon, ProgressMetadata } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import {
  nativePlayerCommand,
  nativeFullscreen,
  nativePlayerSnapshot,
  openNativePlayer,
  redrawNativeSurface,
  refreshNativeSurface,
  resetNativeOverlaySurface,
  stopNativePlayer,
  toggleNativeFullscreen,
  type NativePlayerSnapshot,
  type NativeTrack,
} from "../lib/desktop"
import { loadSubtitles, type Video } from "../lib/core"
import { nativeMediaTitle, playerHeading, type PlayerHeading } from "../lib/player-title"
import { readPreferences, writePreferences } from "../lib/preferences"
import { bufferStatus } from "../lib/playback-buffer"
import {
  configuredTrackLanguage,
  matchesTrackLanguage,
} from "../lib/track-preference"
import { mpvVideoScaleCommands, type VideoScale } from "../lib/video-scale"
import { usePlaybackProgress } from "../lib/progress"
import { Card } from "./ui/card"
import {
  NextEpisodePrompt,
  PlayerEpisodeDrawer,
  type PlayerSeriesContext,
} from "./player-series"
import { VideoScaleControl } from "./video-scale-control"
import { SubtitlePicker } from "./subtitle-picker"

type TrackMenuName = "audio" | "subtitles"

export function usesExpandedPlayerControls(width: number, height: number): boolean {
  return width >= 1200 && height >= 700
}

export function nativePlaybackEnded(
  previous: NativePlayerSnapshot | undefined,
  next: NativePlayerSnapshot,
): boolean {
  return next.ended ||
    Boolean(
      previous?.duration &&
      next.duration <= 0 &&
      (
        previous.position / previous.duration >= 0.9 ||
        previous.duration - previous.position <= 2
      ),
    )
}

function isSpaciousViewport(): boolean {
  return usesExpandedPlayerControls(window.innerWidth, window.innerHeight)
}

export function DesktopPlayer({
  url,
  type,
  videoId,
  profileId,
  progressMetadata,
  addons,
  seriesContext,
  nextEpisode,
  nextEpisodeLabel,
  onSelectEpisode,
  onNextEpisode,
  onEnded,
  onClose,
}: {
  url: string
  type: string
  videoId: string
  profileId: string
  progressMetadata: ProgressMetadata
  addons: InstalledAddon[]
  seriesContext?: PlayerSeriesContext
  nextEpisode?: Video
  nextEpisodeLabel?: string
  onSelectEpisode?: (video: Video) => void | Promise<void>
  onNextEpisode?: () => void | Promise<void>
  onEnded?: (allowAutoplay?: boolean) => void | Promise<void>
  onClose: () => void
}) {
  const preferences = readPreferences()
  const [snapshot, setSnapshot] = useState<NativePlayerSnapshot>()
  const heading = playerHeading(progressMetadata)
  const mediaTitle = nativeMediaTitle(progressMetadata)
  const [error, setError] = useState<string>()
  const [controlsVisible, setControlsVisible] = useState(true)
  const [activeMenu, setActiveMenu] = useState<TrackMenuName>()
  const [fullscreen, setFullscreen] = useState(false)
  const [spaciousViewport, setSpaciousViewport] = useState(isSpaciousViewport)
  const [videoScale, setVideoScale] = useState<VideoScale>("fit")
  const [addonSubtitles, setAddonSubtitles] = useState<ResolvedAddonSubtitle[]>([])
  const [addonSubtitlesResolved, setAddonSubtitlesResolved] = useState(false)
  const [selectedAddonSubtitle, setSelectedAddonSubtitle] = useState<string>()
  const [subtitlePosition, setSubtitlePosition] = useState(preferences.subtitlePosition)
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const closing = useRef(false)
  const audioButton = useRef<HTMLDivElement>(null)
  const subtitleButton = useRef<HTMLDivElement>(null)
  const previousMenu = useRef<TrackMenuName | undefined>(undefined)
  const previousMenuContent = useRef("")
  const previousChromeVisible = useRef(true)
  const previousEpisodeDrawerOpen = useRef(false)
  const previousPaused = useRef(false)
  const resumed = useRef(false)
  const endedHandled = useRef(false)
  const nextTransitionSuppressed = useRef(false)
  const nextTransitionRequested = useRef(false)
  const lastPlayback = useRef({ position: 0, duration: 0 })
  const lastNativeSnapshot = useRef<NativePlayerSnapshot | undefined>(undefined)
  const seekActive = useRef(false)
  const seekDraft = useRef<number | undefined>(undefined)
  const seekCommitTimer = useRef<number | undefined>(undefined)
  const pendingAddonSubtitle = useRef(new Set<string>())
  const preferredAudioApplied = useRef(false)
  const preferredSubtitleApplied = useRef(false)
  const preferredAudioLanguage = configuredTrackLanguage(preferences.audioLanguage, addons)
  const preferredSubtitleLanguage = configuredTrackLanguage(preferences.subtitleLanguage, addons)
  const { progress, save: saveProgress } = usePlaybackProgress(
    profileId,
    videoId,
    progressMetadata,
  )

  const showControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2800)
  }, [])

  const redrawControls = useCallback(() => {
    window.requestAnimationFrame(() => void redrawNativeSurface())
  }, [])

  const resetOverlay = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => void resetNativeOverlaySurface())
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    preferredAudioApplied.current = false
    preferredSubtitleApplied.current = false
    setAddonSubtitlesResolved(false)
    endedHandled.current = false
    nextTransitionSuppressed.current = false
    nextTransitionRequested.current = false
    lastNativeSnapshot.current = undefined
    lastPlayback.current = { position: 0, duration: 0 }
    document.documentElement.classList.add("native-playback")
    void openNativePlayer(url, mediaTitle, preferences.readAheadSeconds)
      .then(async (initial) => {
        if (cancelled) return
        setSnapshot(initial)
        // WebKitGTK can retain pixels from the page that was visible before
        // its background became transparent. Reallocate the overlay after the
        // player DOM has committed, matching the repaint caused by fullscreen.
        resetOverlay()
        await nativePlayerCommand(["set", "sub-pos", preferences.subtitlePosition])
        const resolved = await resolveAddonSubtitles(addons, type, videoId)
        if (!cancelled) {
          setAddonSubtitles(resolved)
          setAddonSubtitlesResolved(true)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    const poll = window.setInterval(() => {
      void nativePlayerSnapshot()
        .then((next) => {
          if (cancelled) return
          const previous = lastNativeSnapshot.current
          const resolved = nativePlaybackEnded(previous, next)
            ? { ...next, ended: true }
            : next
          lastNativeSnapshot.current = resolved
          setSnapshot(
            seekActive.current && seekDraft.current !== undefined
              ? { ...resolved, position: seekDraft.current }
              : resolved,
          )
        })
        .catch(() => undefined)
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      window.clearTimeout(hideTimer.current)
      window.clearTimeout(seekCommitTimer.current)
      document.documentElement.classList.remove("native-playback")
      if (!closing.current) void stopNativePlayer()
    }
  }, [addons, mediaTitle, resetOverlay, type, url, videoId])

  useEffect(() => {
    if (
      preferredAudioApplied.current ||
      !preferredAudioLanguage ||
      !snapshot
    ) {
      return
    }
    const audioTracks = snapshot.tracks.filter((track) => track.type === "audio")
    if (!audioTracks.length) return
    preferredAudioApplied.current = true
    const match = audioTracks.find((track) =>
      matchesTrackLanguage(preferredAudioLanguage, track.lang, track.title),
    )
    if (!match || match.selected) return
    void nativePlayerCommand(["set", "aid", match.id]).then(() => {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              tracks: current.tracks.map((track) =>
                track.type === "audio"
                  ? { ...track, selected: track.id === match.id }
                  : track,
              ),
            }
          : current,
      )
    }).catch(() => undefined)
  }, [preferredAudioLanguage, snapshot])

  useEffect(() => {
    if (
      preferredSubtitleApplied.current ||
      !preferredSubtitleLanguage ||
      !snapshot ||
      !addonSubtitlesResolved
    ) {
      return
    }
    const subtitleTracks = snapshot.tracks.filter((track) => track.type === "sub")
    const embeddedMatch = subtitleTracks.find((track) =>
      matchesTrackLanguage(preferredSubtitleLanguage, track.lang, track.title),
    )
    preferredSubtitleApplied.current = true
    if (embeddedMatch) {
      if (!embeddedMatch.selected) {
        void nativePlayerCommand(["set", "sid", embeddedMatch.id])
        setSnapshot((current) =>
          current
            ? {
                ...current,
                tracks: current.tracks.map((track) =>
                  track.type === "sub"
                    ? { ...track, selected: track.id === embeddedMatch.id }
                    : track,
                ),
              }
            : current,
        )
      }
      return
    }
    const addonMatch = addonSubtitles.find((subtitle) =>
      matchesTrackLanguage(preferredSubtitleLanguage, subtitle.language, subtitle.display),
    )
    if (!addonMatch) return
    pendingAddonSubtitle.current.add(addonMatch.key)
    void nativePlayerCommand([
      "sub-add",
      addonMatch.url,
      "select",
      addonMatch.display,
      addonMatch.language,
    ])
      .then(() => setSelectedAddonSubtitle(addonMatch.key))
      .catch(() => undefined)
      .finally(() => pendingAddonSubtitle.current.delete(addonMatch.key))
  }, [
    addonSubtitles,
    addonSubtitlesResolved,
    preferredSubtitleLanguage,
    snapshot,
  ])

  useEffect(() => {
    if (resumed.current || !snapshot?.duration || !progress.isSuccess) return
    resumed.current = true
    if (!progress.data || progress.data.watched) return
    const saved = progress.data.positionMs / 1000
    if (saved > 0 && (!snapshot.duration || saved < snapshot.duration - 5)) {
      void nativePlayerCommand(["seek", saved, "absolute+exact"])
      setSnapshot((current) => (current ? { ...current, position: saved } : current))
    }
  }, [progress.data, progress.isSuccess, snapshot])

  useEffect(() => {
    if (!snapshot || !resumed.current) return
    if (snapshot.duration > 0) {
      lastPlayback.current = {
        position: snapshot.position,
        duration: snapshot.duration,
      }
    }
    const justPaused = snapshot.paused && !previousPaused.current
    previousPaused.current = snapshot.paused
    void saveProgress(snapshot.position, snapshot.duration, justPaused)
  }, [saveProgress, snapshot])

  useEffect(() => {
    if (!snapshot?.ended || endedHandled.current) return
    endedHandled.current = true
    const duration = snapshot.duration || lastPlayback.current.duration
    if (!nextTransitionRequested.current) {
      nextTransitionRequested.current = true
      resetOverlay()
      void Promise.resolve(
        onEnded?.(!nextTransitionSuppressed.current),
      ).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    }
    void saveProgress(duration, duration, true)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [onEnded, resetOverlay, saveProgress, snapshot])

  useEffect(() => {
    const syncWindowLayout = () => {
      setSpaciousViewport(isSpaciousViewport())
      void nativeFullscreen()
        .then(setFullscreen)
        .catch(() => undefined)
    }
    syncWindowLayout()
    window.addEventListener("resize", syncWindowLayout)
    return () => window.removeEventListener("resize", syncWindowLayout)
  }, [])

  useEffect(() => {
    if (videoScale !== "stretch") return
    const updateStretchAspect = () => {
      void applyNativeVideoScale(videoScale).catch(() => undefined)
    }
    window.addEventListener("resize", updateStretchAspect)
    return () => window.removeEventListener("resize", updateStretchAspect)
  }, [videoScale])

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
      if (snapshot && resumed.current) {
        await saveProgress(snapshot.position, snapshot.duration, true)
      }
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

  const commitSeek = useCallback(() => {
    window.clearTimeout(seekCommitTimer.current)
    seekCommitTimer.current = undefined
    const position = seekDraft.current
    seekDraft.current = undefined
    seekActive.current = false
    if (position === undefined) return
    void nativePlayerCommand(["seek", position, "absolute+exact"])
  }, [])

  const previewSeek = useCallback((position: number) => {
    seekActive.current = true
    seekDraft.current = position
    setSnapshot((current) => (current ? { ...current, position } : current))

    // Range inputs emit continuously while dragged. An exact mpv seek may
    // decode every frame from the preceding keyframe, so issuing one for each
    // pixel of motion can queue enough decoder work to freeze the desktop.
    // Commit once the gesture pauses; pointer/key release commits immediately.
    window.clearTimeout(seekCommitTimer.current)
    seekCommitTimer.current = window.setTimeout(commitSeek, 180)
  }, [commitSeek])

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
      redrawControls()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const audioTracks = snapshot?.tracks.filter((track) => track.type === "audio") ?? []
  const subtitleTracks = snapshot?.tracks.filter((track) => track.type === "sub") ?? []
  const selectedAudio = audioTracks.find((track) => track.selected)
  const selectedSubtitle = subtitleTracks.find((track) => track.selected)
  const menuContentSignature =
    activeMenu === "audio"
      ? audioTracks.map((track) => `${track.id}:${track.selected}`).join("|")
      : activeMenu === "subtitles"
        ? [
            ...subtitleTracks.map((track) => `${track.id}:${track.selected}`),
            ...filterAddedAddonSubtitles(addonSubtitles, subtitleTracks).map(
              (subtitle) => subtitle.key,
            ),
          ].join("|")
        : ""
  const chromeVisible =
    controlsVisible ||
    Boolean(snapshot?.paused) ||
    Boolean(activeMenu) ||
    episodeDrawerOpen ||
    !snapshot
  const expandedControls = fullscreen || spaciousViewport

  useLayoutEffect(() => {
    redrawControls()
    const menuChanged = Boolean(previousMenu.current && previousMenu.current !== activeMenu)
    const menuContentChanged =
      Boolean(activeMenu) &&
      previousMenu.current === activeMenu &&
      previousMenuContent.current !== menuContentSignature
    const chromeHidden = previousChromeVisible.current && !chromeVisible
    if (menuChanged || menuContentChanged || chromeHidden) resetOverlay()
    previousMenu.current = activeMenu
    previousMenuContent.current = menuContentSignature
    previousChromeVisible.current = chromeVisible
  }, [activeMenu, chromeVisible, menuContentSignature, redrawControls, resetOverlay])

  useLayoutEffect(() => {
    if (previousEpisodeDrawerOpen.current === episodeDrawerOpen) return
    previousEpisodeDrawerOpen.current = episodeDrawerOpen
    resetOverlay()
    redrawControls()
  }, [episodeDrawerOpen, redrawControls, resetOverlay])

  // The Linux player layers a transparent WebKitGTK surface over GtkGLArea.
  // Explicitly invalidate that surface whenever dynamic control pixels move;
  // otherwise WebKit's partial damage region can leave the previous thumb or
  // timestamp glyph visible over the video.
  useLayoutEffect(() => {
    if (snapshot) redrawControls()
  }, [
    redrawControls,
    snapshot?.duration,
    snapshot?.paused,
    snapshot?.position,
    snapshot?.volume,
  ])

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
        data-player-chrome="top"
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 bg-gradient-to-b from-black/85 via-black/45 to-transparent ${
          expandedControls ? "px-10 pb-24 pt-8" : "px-5 pb-16 pt-5"
        } ${
          chromeVisible ? "visible" : "invisible"
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            className={`pointer-events-auto grid shrink-0 place-items-center rounded-full bg-black/60 text-zinc-200 hover:bg-white/15 ${
              expandedControls ? "size-13 [&_svg]:size-7" : "size-10"
            }`}
            onClick={(event) => {
              event.stopPropagation()
              void close()
            }}
            aria-label="Back to details"
          >
            <Play className="rotate-180 fill-current" size={21} />
          </button>
          <PlayerHeadingText heading={heading} expanded={expandedControls} />
        </div>
        <button
          className={`pointer-events-auto grid shrink-0 place-items-center rounded-full bg-black/60 text-zinc-200 hover:bg-white/15 ${
            expandedControls ? "size-13 [&_svg]:size-7" : "size-10"
          }`}
          type="button"
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => {
            void toggleNativeFullscreen().then(setFullscreen)
          }}
        >
          {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
      </div>

      {error ? (
        <div className="absolute inset-0 z-10 grid place-items-center p-5">
          <Card className="w-full max-w-lg border-red-950 bg-zinc-950/95 p-6">
            <p className="font-medium text-red-400">Could not start mpv</p>
            <p className="mt-2 text-sm text-zinc-400">{error}</p>
            <p className="mt-3 text-xs text-zinc-600">
              Check the desktop logs for the libmpv initialization error.
            </p>
          </Card>
        </div>
      ) : !snapshot || snapshot.loading || snapshot.duration <= 0 ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
          role="status"
          aria-label="Video loading"
        >
          <div className="rounded-full bg-black/55 p-3 shadow-lg backdrop-blur-sm">
            <LoaderCircle className="animate-spin text-white" size={36} />
          </div>
        </div>
      ) : null}

      {snapshot && !error && !episodeDrawerOpen && (
        <NextEpisodePrompt
          seriesName={seriesContext?.name ?? progressMetadata.name}
          episode={nextEpisode}
          position={snapshot.position}
          duration={snapshot.duration || lastPlayback.current.duration}
          paused={snapshot.paused}
          autoplay={preferences.autoplay}
          onDismiss={() => {
            nextTransitionSuppressed.current = true
            resetOverlay()
          }}
          onVisibilityChange={(visible) => {
            if (!visible) resetOverlay()
          }}
          onWatchNow={() => {
            if (nextTransitionRequested.current) return
            nextTransitionRequested.current = true
            resetOverlay()
            const duration = snapshot.duration || lastPlayback.current.duration
            void saveProgress(duration, duration, true)
            void Promise.resolve(onNextEpisode?.()).catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : String(cause))
            })
          }}
        />
      )}
      <PlayerEpisodeDrawer
        open={episodeDrawerOpen}
        context={seriesContext}
        onOpenChange={setEpisodeDrawerOpen}
        onSelect={(video) => {
          if (nextTransitionRequested.current) return
          nextTransitionRequested.current = true
          resetOverlay()
          void Promise.resolve(onSelectEpisode?.(video)).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause))
          })
        }}
      />

      {snapshot && !error && (
        <div
          data-player-chrome="bottom"
          className={`absolute inset-x-0 bottom-0 z-10 ${
            expandedControls ? "px-10 pb-8 pt-28" : "px-4 pb-4 pt-20 sm:px-6"
          } ${
            chromeVisible ? "visible" : "pointer-events-none invisible"
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className={`native-controls-surface relative mx-auto ${
              expandedControls ? "max-w-none" : "max-w-7xl"
            }`}
          >
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
                preferredLanguage={preferences.subtitleLanguage}
                subtitlePosition={subtitlePosition}
                onSubtitlePosition={(value) => {
                  setSubtitlePosition(value)
                  writePreferences({ ...readPreferences(), subtitlePosition: value })
                  void nativePlayerCommand(["set", "sub-pos", value]).catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  })
                }}
                allowOff
                onSelect={(track) => void selectTrack("sid", track)}
                onSelectAddon={async (subtitle) => {
                  if (pendingAddonSubtitle.current.has(subtitle.key)) return
                  pendingAddonSubtitle.current.add(subtitle.key)
                  try {
                    const existing = subtitleTracks.find(
                      (track) => track.external && track.title === subtitle.display,
                    )
                    if (existing) {
                      await nativePlayerCommand(["set", "sid", existing.id])
                    } else {
                      await nativePlayerCommand([
                        "sub-add",
                        subtitle.url,
                        "select",
                        subtitle.display,
                        subtitle.language,
                      ])
                    }
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
                    redrawControls()
                  } catch (cause: unknown) {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  } finally {
                    pendingAddonSubtitle.current.delete(subtitle.key)
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
                    redrawControls()
                  } catch (cause: unknown) {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  }
                }}
                onClose={closeTrackMenu}
              />
            )}

            <input
              className={`player-seek block w-full cursor-pointer ${
                expandedControls ? "h-2" : "h-1.5"
              }`}
              style={
                {
                  "--player-progress": `${
                    snapshot.duration > 0
                      ? Math.min(100, (snapshot.position / snapshot.duration) * 100)
                      : 0
                  }%`,
                  "--player-buffered": `${
                    snapshot.duration > 0
                      ? Math.min(
                          100,
                          ((snapshot.position + snapshot.bufferedDuration) /
                            snapshot.duration) *
                            100,
                        )
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
                previewSeek(position)
              }}
              onPointerUp={commitSeek}
              onPointerCancel={commitSeek}
              onKeyUp={commitSeek}
              onBlur={commitSeek}
            />

            <div
              className={`flex items-center ${
                expandedControls ? "mt-5 gap-3" : "mt-3 gap-1 sm:gap-2"
              }`}
            >
              <PlayerIcon
                label="Back 10 seconds"
                expanded={expandedControls}
                onClick={() => seekRelative(-10)}
              >
                <RotateCcw size={21} />
                <span className="absolute text-[9px] font-bold">10</span>
              </PlayerIcon>
              <PlayerIcon
                label={snapshot.paused ? "Play" : "Pause"}
                expanded={expandedControls}
                onClick={togglePlayback}
              >
                {snapshot.paused ? <Play size={22} /> : <Pause size={22} />}
              </PlayerIcon>
              <PlayerIcon
                label="Forward 10 seconds"
                expanded={expandedControls}
                onClick={() => seekRelative(10)}
              >
                <RotateCw size={21} />
                <span className="absolute text-[9px] font-bold">10</span>
              </PlayerIcon>
              {onNextEpisode && (
                <PlayerIcon
                  label={`Next episode${nextEpisodeLabel ? `: ${nextEpisodeLabel}` : ""}`}
                  expanded={expandedControls}
                  onClick={() => {
                    if (nextTransitionRequested.current) return
                    nextTransitionRequested.current = true
                    resetOverlay()
                    void onNextEpisode()
                  }}
                >
                  <SkipForward size={21} />
                </PlayerIcon>
              )}
              <PlayerIcon
                label={snapshot.volume === 0 ? "Unmute" : "Mute"}
                expanded={expandedControls}
                onClick={() => {
                  const volume = snapshot.volume === 0 ? 100 : 0
                  void nativePlayerCommand(["set", "volume", volume])
                  setSnapshot((current) => (current ? { ...current, volume } : current))
                }}
              >
                {snapshot.volume === 0 ? <VolumeX size={21} /> : <Volume2 size={21} />}
              </PlayerIcon>
              <input
                className={`player-volume hidden sm:block ${
                  expandedControls ? "w-32" : "w-20"
                }`}
                style={
                  {
                    "--player-volume": `${Math.max(0, Math.min(100, snapshot.volume))}%`,
                  } as React.CSSProperties
                }
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
                className={`player-time ml-1 tabular-nums text-zinc-300 ${
                  expandedControls ? "text-sm" : "text-xs"
                }`}
              >
                {snapshot.duration > 0 ? (
                  <>
                    {formatTime(snapshot.position)}
                    <span className="text-zinc-500"> / {formatTime(snapshot.duration)}</span>
                  </>
                ) : (
                  <span className="text-zinc-500">--:--:-- / --:--:--</span>
                )}
              </span>
              <span
                className={`hidden tabular-nums text-zinc-500 lg:block ${
                  expandedControls ? "text-xs" : "text-[11px]"
                }`}
                title="Temporary in-memory media buffer and current download throughput"
              >
                {bufferStatus(
                  snapshot.bufferedDuration,
                  snapshot.downloadBytesPerSecond,
                )}
              </span>

              <div className="flex-1" />

              <div ref={audioButton} data-track-menu-trigger>
                <PlayerIcon
                  label={`Audio${selectedAudio ? `: ${trackName(selectedAudio, "Audio")}` : ""}`}
                  active={activeMenu === "audio"}
                  expanded={expandedControls}
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
                  expanded={expandedControls}
                  onClick={() => toggleTrackMenu("subtitles")}
                >
                  <Captions size={22} />
                </PlayerIcon>
              </div>
              <VideoScaleControl
                value={videoScale}
                expanded={expandedControls}
                indicatorPlacement="above"
                onIndicatorHidden={resetOverlay}
                onChange={(scale) => {
                  resetOverlay()
                  setVideoScale(scale)
                  void applyNativeVideoScale(scale).catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  })
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

async function applyNativeVideoScale(scale: VideoScale): Promise<void> {
  for (const command of mpvVideoScaleCommands(scale, {
    width: window.innerWidth,
    height: window.innerHeight,
  })) {
    await nativePlayerCommand(command)
  }
}

function PlayerIcon({
  label,
  active,
  expanded,
  children,
  onClick,
}: {
  label: string
  active?: boolean
  expanded?: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={`relative grid place-items-center rounded-lg bg-zinc-950 text-zinc-200 shadow-sm transition hover:bg-zinc-800 hover:text-white ${
      expanded ? "size-12 [&_svg]:size-7" : "size-10"
      } ${
        active ? "bg-amber-950 text-amber-300" : ""
      }`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function PlayerHeadingText({
  heading,
  expanded,
}: {
  heading: PlayerHeading
  expanded: boolean
}) {
  return (
    <div className="min-w-0 drop-shadow-lg">
      <h2
        className={`truncate font-display font-semibold ${
          expanded ? "text-2xl" : "text-lg"
        }`}
      >
        {heading.primary}
      </h2>
      {heading.secondary && (
        <p className={`truncate text-zinc-300 ${expanded ? "text-sm" : "text-xs"}`}>
          {heading.secondary}
        </p>
      )}
    </div>
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
  preferredLanguage,
  subtitlePosition,
  onSubtitlePosition,
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
  preferredLanguage?: string
  subtitlePosition?: number
  onSubtitlePosition?: (value: number) => void
  onSelect: (track: NativeTrack) => void
  onSelectAddon?: (subtitle: ResolvedAddonSubtitle) => void
  onOff?: () => void
  onClose: () => void
}) {
  const [position, setPosition] = useState({ bottom: 80, right: 24, maxHeight: 400 })
  const availableAddonSubtitles = filterAddedAddonSubtitles(addonSubtitles ?? [], tracks)

  useLayoutEffect(() => {
    const updatePosition = () => {
      const bounds = anchor.current?.getBoundingClientRect()
      if (!bounds) return
      setPosition({
        bottom: Math.max(32, window.innerHeight - bounds.top + 32),
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
      className={`fixed z-[100] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-zinc-950 p-2 shadow-2xl ${
        allowOff ? "w-[46rem]" : "w-80"
      }`}
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
      {allowOff ? (
        <SubtitlePicker
          items={[
            ...tracks.map((track) => ({
              key: `track:${track.id}`,
              language: track.lang || track.title,
              title: trackName(track, title),
              detail: [track.codec?.toUpperCase(), track.external ? "External" : "Embedded"]
                .filter(Boolean)
                .join(" · "),
              active: track.selected,
            })),
            ...availableAddonSubtitles.map((subtitle) => ({
              key: `addon:${subtitle.key}`,
              language: subtitle.language,
              title: languageName(subtitle.language) || subtitle.language,
              detail: subtitle.display.split(" · ").slice(1).join(" · ") || "Add-on subtitle",
              active: selectedAddonSubtitle === subtitle.key,
            })),
          ]}
          preferredLanguage={preferredLanguage}
          off={!tracks.some((track) => track.selected) && !selectedAddonSubtitle}
          position={subtitlePosition ?? 90}
          onPositionChange={(value) => onSubtitlePosition?.(value)}
          onOff={() => onOff?.()}
          onSelect={(key) => {
            if (key.startsWith("track:")) {
              const id = key.slice("track:".length)
              const track = tracks.find((candidate) => String(candidate.id) === id)
              if (track) onSelect(track)
            } else {
              const subtitle = availableAddonSubtitles.find(
                (candidate) => candidate.key === key.slice("addon:".length),
              )
              if (subtitle) onSelectAddon?.(subtitle)
            }
          }}
        />
      ) : (
        <>
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
      {availableAddonSubtitles.map((subtitle) => (
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
      {!tracks.length && !availableAddonSubtitles.length && (
        <p className="px-3 py-2 text-sm text-zinc-500">{empty}</p>
      )}
        </>
      )}
    </div>,
    document.body,
  )
}

export function filterAddedAddonSubtitles<
  TSubtitle extends { display: string },
  TTrack extends { external: boolean; title?: string },
>(subtitles: TSubtitle[], tracks: TTrack[]): TSubtitle[] {
  const installedTitles = new Set(
    tracks
      .filter((track) => track.external && track.title)
      .map((track) => track.title),
  )
  return subtitles.filter((subtitle) => !installedTitles.has(subtitle.display))
}

export function dedupeAddonSubtitles<TSubtitle extends { display: string }>(
  subtitles: TSubtitle[],
): TSubtitle[] {
  const seen = new Set<string>()
  return subtitles.filter((subtitle) => {
    const key = subtitle.display.trim().toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
  return dedupeAddonSubtitles(results.flatMap((result) => {
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
  }))
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
