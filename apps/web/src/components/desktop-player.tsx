import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { createPortal } from "react-dom"
import {
  Captions,
  Languages,
  Pause,
  Play,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import type { InstalledAddon, PlaybackSource, PlayerArtwork, ProgressMetadata } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import { audioTrackDisplay } from "../lib/audio-track-display"
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
import { isDesktopBuffering, isDesktopInitialLoading } from "../lib/desktop-player-state"
import { loadSubtitles, type Video } from "../lib/core"
import { nativeMediaTitle, playerHeading, type PlayerHeading } from "../lib/player-title"
import { readPreferences, writePreferences } from "../lib/preferences"
import { configuredTrackLanguage, matchesTrackLanguage } from "../lib/track-preference"
import { mpvVideoScaleCommands, type VideoScale } from "../lib/video-scale"
import { usePlaybackProgress } from "../lib/progress"
import { AUTO_SELECTION_STARTUP_TIMEOUT_MS } from "../lib/stream-selection"
import { Card } from "./ui/card"
import { NextEpisodePrompt, PlayerEpisodeDrawer, type PlayerSeriesContext } from "./player-series"
import { VideoScaleControl } from "./video-scale-control"
import { SubtitlePicker } from "./subtitle-picker"
import {
  DesktopPlayerBufferingOverlay,
  DesktopPlayerOpeningOverlay,
} from "./desktop-player-overlays"
import {
  DesktopPlayerChromeBottom,
  DesktopPlayerChromeTop,
  DesktopPlayerControl as PlayerIcon,
} from "./desktop-player-chrome"

type TrackMenuName = "audio" | "subtitles"

export function usesExpandedPlayerControls(width: number, height: number): boolean {
  return width >= 1200 && height >= 700
}

export function nativePlaybackEnded(
  previous: NativePlayerSnapshot | undefined,
  next: NativePlayerSnapshot,
): boolean {
  return (
    next.ended ||
    Boolean(
      previous?.duration &&
      next.duration <= 0 &&
      (previous.position / previous.duration >= 0.9 || previous.duration - previous.position <= 2),
    )
  )
}

export function nativePlaybackDescription(snapshot: NativePlayerSnapshot): string {
  const codecs = [snapshot.videoCodec, snapshot.audioCodec]
    .filter(Boolean)
    .map((codec) => codec!.toUpperCase())
    .join(" / ")
  const details = [
    "Direct Play",
    snapshot.container?.toUpperCase(),
    codecs,
    snapshot.hardwareDecoder
      ? `Hardware (${snapshot.hardwareDecoder})`
      : snapshot.videoCodec
        ? "Software"
        : "",
  ].filter(Boolean)
  return details.join(" · ")
}

function isSpaciousViewport(): boolean {
  return usesExpandedPlayerControls(window.innerWidth, window.innerHeight)
}

export function DesktopPlayer({
  url,
  type,
  videoId,
  profileId,
  accountId = profileId,
  playbackSource,
  progressMetadata,
  artwork,
  addons,
  seriesContext,
  nextEpisode,
  nextEpisodeLabel,
  onSelectEpisode,
  onNextEpisode,
  onEnded,
  autoRecoveryAttempt = false,
  onAutoRecoveryStarted,
  onAutoRecoveryFailed,
  onClose,
}: {
  accountId?: string
  url: string
  type: string
  videoId: string
  profileId: string
  playbackSource?: PlaybackSource
  progressMetadata: ProgressMetadata
  artwork?: PlayerArtwork
  addons: InstalledAddon[]
  seriesContext?: PlayerSeriesContext
  nextEpisode?: Video
  nextEpisodeLabel?: string
  onSelectEpisode?: (video: Video) => void | Promise<void>
  onNextEpisode?: () => void | Promise<void>
  onEnded?: (allowAutoplay?: boolean) => void | Promise<void>
  autoRecoveryAttempt?: boolean
  onAutoRecoveryStarted?: () => void
  onAutoRecoveryFailed?: () => void
  onClose: () => void
}) {
  const preferences = readPreferences()
  const [snapshot, setSnapshot] = useState<NativePlayerSnapshot>()
  const heading = playerHeading(progressMetadata)
  const mediaTitle = nativeMediaTitle(progressMetadata)
  const [error, setError] = useState<string>()
  const [controlsVisible, setControlsVisible] = useState(true)
  const [showRemainingTime, setShowRemainingTime] = useState(false)
  const [activeMenu, setActiveMenu] = useState<TrackMenuName>()
  const [fullscreen, setFullscreen] = useState(false)
  const [spaciousViewport, setSpaciousViewport] = useState(isSpaciousViewport)
  const [videoScale, setVideoScale] = useState<VideoScale>("fit")
  const [addonSubtitles, setAddonSubtitles] = useState<ResolvedAddonSubtitle[]>([])
  const [addonSubtitlesResolved, setAddonSubtitlesResolved] = useState(false)
  const [selectedAddonSubtitle, setSelectedAddonSubtitle] = useState<string>()
  const [subtitlePosition, setSubtitlePosition] = useState(preferences.subtitlePosition)
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState(false)
  const [holdSpeedActive, setHoldSpeedActive] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const holdSpeedTimer = useRef<number | undefined>(undefined)
  const holdSpeedActiveRef = useRef(false)
  const holdSpeedTriggered = useRef(false)
  const closing = useRef(false)
  const audioButton = useRef<HTMLDivElement>(null)
  const subtitleButton = useRef<HTMLDivElement>(null)
  const previousMenu = useRef<TrackMenuName | undefined>(undefined)
  const previousMenuContent = useRef("")
  const previousChromeVisible = useRef(true)
  const previousEpisodeDrawerOpen = useRef(false)
  const previousLoadingOverlayVisible = useRef(false)
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
  const subtitleMetadataReadyPolls = useRef(0)
  const autoRecoveryStarted = useRef(false)
  const autoRecoveryFailureReported = useRef(false)
  const autoRecoveryAttemptRef = useRef(autoRecoveryAttempt)
  const onAutoRecoveryStartedRef = useRef(onAutoRecoveryStarted)
  const onAutoRecoveryFailedRef = useRef(onAutoRecoveryFailed)
  autoRecoveryAttemptRef.current = autoRecoveryAttempt
  onAutoRecoveryStartedRef.current = onAutoRecoveryStarted
  onAutoRecoveryFailedRef.current = onAutoRecoveryFailed
  const [playbackStarted, setPlaybackStarted] = useState(false)
  const preferredAudioLanguage = configuredTrackLanguage(preferences.audioLanguage, addons)
  const preferredSubtitleLanguage = configuredTrackLanguage(preferences.subtitleLanguage, addons)
  const { progress, save: saveProgress } = usePlaybackProgress(
    profileId,
    videoId,
    progressMetadata,
    playbackStarted ? playbackSource : undefined,
    accountId,
  )

  const reportAutoRecoveryFailure = useCallback(() => {
    if (
      !autoRecoveryAttemptRef.current ||
      autoRecoveryStarted.current ||
      autoRecoveryFailureReported.current
    )
      return
    autoRecoveryFailureReported.current = true
    onAutoRecoveryFailedRef.current?.()
  }, [])

  const markAutoRecoveryStarted = useCallback(() => {
    if (!autoRecoveryAttemptRef.current || autoRecoveryStarted.current) return
    autoRecoveryStarted.current = true
    onAutoRecoveryStartedRef.current?.()
  }, [])

  useEffect(() => {
    autoRecoveryStarted.current = false
    autoRecoveryFailureReported.current = false
    setPlaybackStarted(false)
  }, [url])

  useEffect(() => {
    if (!autoRecoveryAttempt) return
    const timeout = window.setTimeout(reportAutoRecoveryFailure, AUTO_SELECTION_STARTUP_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [autoRecoveryAttempt, reportAutoRecoveryFailure, url])

  const showControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    if (!snapshot?.firstFrameReady) return
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2800)
  }, [snapshot?.firstFrameReady])

  const endHoldSpeed = useCallback(() => {
    window.clearTimeout(holdSpeedTimer.current)
    holdSpeedTimer.current = undefined
    if (!holdSpeedActiveRef.current) return
    holdSpeedActiveRef.current = false
    setHoldSpeedActive(false)
    void nativePlayerCommand(["set", "speed", 1]).catch(() => undefined)
  }, [])

  const beginHoldSpeed = useCallback(
    (event: ReactPointerEvent) => {
      if (
        !snapshot ||
        snapshot.loading ||
        snapshot.duration <= 0 ||
        (event.pointerType === "mouse" && event.button !== 0) ||
        (event.target instanceof Element && event.target.closest("[data-native-overlay]"))
      )
        return
      window.clearTimeout(holdSpeedTimer.current)
      holdSpeedTriggered.current = false
      holdSpeedTimer.current = window.setTimeout(() => {
        holdSpeedTriggered.current = true
        holdSpeedActiveRef.current = true
        setHoldSpeedActive(true)
        void nativePlayerCommand(["set", "speed", 2]).catch(() => undefined)
      }, 450)
    },
    [snapshot],
  )

  useEffect(
    () => () => {
      window.clearTimeout(holdSpeedTimer.current)
      if (holdSpeedActiveRef.current) {
        holdSpeedActiveRef.current = false
        void nativePlayerCommand(["set", "speed", 1]).catch(() => undefined)
      }
    },
    [],
  )

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
    let playerStarted = false
    preferredAudioApplied.current = false
    preferredSubtitleApplied.current = false
    setShowRemainingTime(false)
    subtitleMetadataReadyPolls.current = 0
    setAddonSubtitlesResolved(false)
    endedHandled.current = false
    nextTransitionSuppressed.current = false
    nextTransitionRequested.current = false
    seekActive.current = false
    seekDraft.current = undefined
    lastNativeSnapshot.current = undefined
    lastPlayback.current = { position: 0, duration: 0 }
    document.documentElement.classList.add("native-playback")
    void openNativePlayer(
      url,
      mediaTitle,
      preferences.readAheadSeconds,
      preferences.hardwareAcceleration,
      {
        title: mediaTitle,
        ...artwork,
        series: seriesContext
          ? {
              name: seriesContext.name,
              show: seriesContext.show,
              videos: seriesContext.videos,
              progress: seriesContext.progress,
              currentVideoId: seriesContext.currentVideoId,
            }
          : undefined,
      },
    )
      .then(async (initial) => {
        if (cancelled) return
        playerStarted = true
        setSnapshot(initial)
        if (initial.firstFrameReady) setPlaybackStarted(true)
        await nativePlayerCommand(["set", "sub-pos", preferences.subtitlePosition])
        await nativePlayerCommand(["set", "sub-border-size", preferences.subtitleOutline ? 3 : 0])
        const resolved = await resolveAddonSubtitles(addons, type, videoId)
        if (!cancelled) {
          setAddonSubtitles(resolved)
          setAddonSubtitlesResolved(true)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          reportAutoRecoveryFailure()
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })

    const poll = window.setInterval(() => {
      if (!playerStarted || cancelled) return
      void nativePlayerSnapshot()
        .then((next) => {
          if (cancelled) return
          const previous = lastNativeSnapshot.current
          const resolved = nativePlaybackEnded(previous, next) ? { ...next, ended: true } : next
          lastNativeSnapshot.current = resolved
          setSnapshot(
            seekActive.current && seekDraft.current !== undefined
              ? { ...resolved, position: seekDraft.current }
              : resolved,
          )
        })
        .catch(() => undefined)
    }, 250)

    return () => {
      cancelled = true
      playerStarted = false
      window.clearInterval(poll)
      window.clearTimeout(hideTimer.current)
      window.clearTimeout(seekCommitTimer.current)
      document.documentElement.classList.remove("native-playback")
      if (!closing.current) void stopNativePlayer()
    }
  }, [
    addons,
    artwork?.background,
    artwork?.logo,
    artwork?.poster,
    markAutoRecoveryStarted,
    mediaTitle,
    preferences.subtitleOutline,
    preferences.subtitlePosition,
    reportAutoRecoveryFailure,
    type,
    url,
    videoId,
  ])

  useEffect(() => {
    if (!autoRecoveryAttempt || !snapshot) return
    if (snapshot.firstFrameReady && !error) {
      setPlaybackStarted(true)
      markAutoRecoveryStarted()
      return
    }
    if (error) reportAutoRecoveryFailure()
  }, [autoRecoveryAttempt, error, markAutoRecoveryStarted, reportAutoRecoveryFailure, snapshot])

  useEffect(() => {
    const electron = window.__CONDUIT_ELECTRON__
    if (!electron) return
    const unsubscribeClose = electron.onPlayerOverlayClose(onClose)
    const unsubscribeNext = electron.onPlayerOverlayNext(() => {
      if (onNextEpisode) void onNextEpisode()
    })
    const unsubscribeEpisode = electron.onPlayerOverlayEpisode?.((selectedVideoId) => {
      const selectedVideo = seriesContext?.videos.find((video) => video.id === selectedVideoId)
      if (!selectedVideo || !onSelectEpisode || nextTransitionRequested.current) return
      nextTransitionRequested.current = true
      resetOverlay()
      void Promise.resolve(onSelectEpisode(selectedVideo)).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    }) ?? (() => undefined)
    return () => {
      unsubscribeClose()
      unsubscribeNext()
      unsubscribeEpisode()
    }
  }, [onClose, onNextEpisode, onSelectEpisode, resetOverlay, seriesContext?.videos])

  useEffect(() => {
    if (preferredAudioApplied.current || !preferredAudioLanguage || !snapshot) {
      return
    }
    const audioTracks = snapshot.tracks.filter((track) => track.type === "audio")
    if (!audioTracks.length) return
    preferredAudioApplied.current = true
    const match = audioTracks.find((track) =>
      matchesTrackLanguage(preferredAudioLanguage, track.lang, track.title),
    )
    if (!match || match.selected) return
    void nativePlayerCommand(["set", "aid", match.id])
      .then(() => {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                tracks: current.tracks.map((track) =>
                  track.type === "audio" ? { ...track, selected: track.id === match.id } : track,
                ),
              }
            : current,
        )
      })
      .catch(() => undefined)
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
    // mpv can report its first snapshot before the stream's embedded tracks
    // are populated. Do not permanently apply an add-on/external fallback
    // during that partial state; wait for loaded media and subtitle metadata.
    if (!snapshot.duration) return
    if (subtitleTracks.length === 0) {
      // Allow mpv another polling cycle to publish embedded tracks. Streams
      // with no subtitle tracks can still fall back to an add-on afterward.
      subtitleMetadataReadyPolls.current += 1
      if (subtitleMetadataReadyPolls.current < 2) return
    }
    const embeddedMatch = subtitleTracks.find(
      (track) =>
        !track.external && matchesTrackLanguage(preferredSubtitleLanguage, track.lang, track.title),
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
  }, [addonSubtitles, addonSubtitlesResolved, preferredSubtitleLanguage, snapshot])

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
      void Promise.resolve(onEnded?.(!nextTransitionSuppressed.current)).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    }
    void saveProgress(duration, duration, true).catch((cause: unknown) => {
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
    if (!snapshot?.firstFrameReady || snapshot.paused || activeMenu || error) {
      window.clearTimeout(hideTimer.current)
      setControlsVisible(true)
    } else {
      showControls()
    }
  }, [activeMenu, error, showControls, snapshot?.firstFrameReady, snapshot?.paused])

  const close = () => {
    if (closing.current) return
    closing.current = true
    if (snapshot && resumed.current) {
      void saveProgress(snapshot.position, snapshot.duration, true).catch(() => undefined)
    }
    void stopNativePlayer().catch(() => undefined)
    document.documentElement.classList.remove("native-playback")
    onClose()
    window.requestAnimationFrame(() => void refreshNativeSurface())
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

  const seekRelative = useCallback(
    (seconds: number) => {
      if (!snapshot) return
      void nativePlayerCommand(["seek", seconds, "relative+exact"])
      setSnapshot((current) =>
        current
          ? {
              ...current,
              position: Math.max(
                0,
                Math.min(current.duration || Infinity, current.position + seconds),
              ),
            }
          : current,
      )
      showControls()
    },
    [showControls, snapshot],
  )

  const commitSeek = useCallback(() => {
    window.clearTimeout(seekCommitTimer.current)
    seekCommitTimer.current = undefined
    const position = seekDraft.current
    seekDraft.current = undefined
    seekActive.current = false
    if (position === undefined) return
    void nativePlayerCommand(["seek", position, "absolute+exact"])
  }, [])

  const previewSeek = useCallback(
    (position: number) => {
      seekActive.current = true
      seekDraft.current = position
      setSnapshot((current) => (current ? { ...current, position } : current))

      // Range inputs emit continuously while dragged. An exact mpv seek may
      // decode every frame from the preceding keyframe, so issuing one for each
      // pixel of motion can queue enough decoder work to freeze the desktop.
      // Commit once the gesture pauses; pointer/key release commits immediately.
      window.clearTimeout(seekCommitTimer.current)
      seekCommitTimer.current = window.setTimeout(commitSeek, 180)
    },
    [commitSeek],
  )

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
  const electronNativePlayer = window.__CONDUIT_ELECTRON__ !== undefined
  const expandedControls = fullscreen || spaciousViewport
  const loadingOverlayVisible = isDesktopInitialLoading(snapshot, error)
  const bufferingOverlayVisible = isDesktopBuffering(snapshot, error)

  useLayoutEffect(() => {
    const overlayHidden = previousLoadingOverlayVisible.current && !loadingOverlayVisible
    previousLoadingOverlayVisible.current = loadingOverlayVisible
    if (!overlayHidden) return
    resetOverlay()
    redrawControls()
  }, [loadingOverlayVisible, redrawControls, resetOverlay])

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

  // Explicitly invalidate the native overlay whenever dynamic control pixels
  // move. This is required by the WebKitGTK player and harmless for Electron.
  useLayoutEffect(() => {
    if (snapshot) redrawControls()
  }, [
    redrawControls,
    snapshot?.duration,
    snapshot?.firstFrameReady,
    snapshot?.loading,
    snapshot?.paused,
    snapshot?.position,
    snapshot?.volume,
    showRemainingTime,
  ])

  return createPortal(
    <div
      className={`native-player fixed inset-0 z-50 select-none overflow-hidden ${
        electronNativePlayer ? "electron-native-player" : ""
      } ${chromeVisible ? "cursor-default" : "cursor-none"}`}
      onMouseMove={showControls}
      onPointerDown={beginHoldSpeed}
      onPointerUp={endHoldSpeed}
      onPointerCancel={endHoldSpeed}
      onPointerLeave={endHoldSpeed}
    >
      <div
        className={`absolute inset-0 z-0 ${activeMenu ? "pointer-events-none" : ""}`}
        onClick={(event) => {
          if (holdSpeedTriggered.current) {
            holdSpeedTriggered.current = false
            event.preventDefault()
            return
          }
          togglePlayback()
        }}
        aria-hidden="true"
      />
      {holdSpeedActive && (
        <div
          className="pointer-events-none absolute inset-x-0 top-6 z-20 text-center text-xl font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)]"
          aria-live="polite"
        >
          » 2×
        </div>
      )}
      <DesktopPlayerChromeTop
        expandedControls={expandedControls}
        visible={chromeVisible}
        fullscreen={fullscreen}
        heading={<PlayerHeadingText heading={heading} expanded={expandedControls} />}
        description={
          snapshot ? (
            <p
              className={`mt-1 truncate text-zinc-400 ${
                expandedControls ? "text-sm" : "text-xs"
              }`}
              title={nativePlaybackDescription(snapshot)}
            >
              {nativePlaybackDescription(snapshot)}
            </p>
          ) : undefined
        }
        onBack={close}
        onFullscreen={() => {
          void toggleNativeFullscreen().then(setFullscreen)
        }}
      />
      {error ? (
        <div className="absolute inset-0 z-10 grid place-items-center p-5">
          <Card className="w-full max-w-lg border-red-950 bg-zinc-950/95 p-6" data-native-overlay>
            <p className="font-medium text-red-400">Could not start mpv</p>
            <p className="mt-2 text-sm text-zinc-400">{error}</p>
            <p className="mt-3 text-xs text-zinc-600">
              Check the desktop logs for the libmpv initialization error.
            </p>
          </Card>
        </div>
      ) : loadingOverlayVisible ? (
        <DesktopPlayerOpeningOverlay artwork={artwork} title={mediaTitle} />
      ) : bufferingOverlayVisible ? (
        <DesktopPlayerBufferingOverlay />
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
        handleVisible={chromeVisible}
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
        <DesktopPlayerChromeBottom expandedControls={expandedControls} visible={chromeVisible}>
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

            <div className="flex items-center gap-3" data-native-overlay>
              <span
                className={`player-time player-time-elapsed tabular-nums text-zinc-300 ${
                  expandedControls ? "text-base" : "text-sm"
                }`}
                aria-label="Elapsed time"
              >
                {snapshot.duration > 0 ? formatTime(snapshot.position) : "--:--:--"}
              </span>
              <input
                className={`player-seek block min-w-0 flex-1 cursor-pointer ${
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
                            ((snapshot.position + snapshot.bufferedDuration) / snapshot.duration) *
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
              <button
                className={`player-time player-time-duration cursor-pointer border-0 p-0 tabular-nums text-zinc-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                  expandedControls ? "text-base" : "text-sm"
                }`}
                type="button"
                aria-label={
                  showRemainingTime
                    ? "Time remaining. Click to show end time."
                    : "End time. Click to show time remaining."
                }
                title={
                  showRemainingTime
                    ? "Click to show end time"
                    : "Click to show time remaining"
                }
                onClick={() => {
                  setShowRemainingTime((current) => !current)
                  showControls()
                }}
              >
                {snapshot.duration > 0
                  ? showRemainingTime
                    ? `-${formatTime(Math.max(0, snapshot.duration - snapshot.position))}`
                    : formatTime(snapshot.duration)
                  : "--:--:--"}
              </button>
            </div>

            <div
              className={`flex items-center ${
                expandedControls ? "mt-5 gap-3" : "mt-3 gap-1 sm:gap-2"
              }`}
              data-native-overlay
            >
              <PlayerIcon
                label={snapshot.paused ? "Play" : "Pause"}
                expanded={expandedControls}
                onClick={togglePlayback}
              >
                {snapshot.paused ? <Play size={22} /> : <Pause size={22} />}
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
                className={`player-volume hidden sm:block ${expandedControls ? "w-32" : "w-20"}`}
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
        </DesktopPlayerChromeBottom>
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

function PlayerHeadingText({ heading, expanded }: { heading: PlayerHeading; expanded: boolean }) {
  return (
    <div className="min-w-0 drop-shadow-lg">
      <h2 className={`truncate font-display font-semibold ${expanded ? "text-2xl" : "text-lg"}`}>
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
        bottom: Math.max(56, window.innerHeight - bounds.top + 56),
        right: Math.max(16, window.innerWidth - bounds.right),
        maxHeight: Math.max(160, Math.min(window.innerHeight * 0.6, bounds.top - 48)),
      })
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [anchor])

  return createPortal(
    <div
      data-track-menu
      data-native-overlay
      className="fixed z-[100] w-[46rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-zinc-950 p-2 shadow-2xl"
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
              embedded: !track.external,
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
            <AudioTrackMenuRow
              key={track.id}
              track={track}
              fallback={`${title} ${track.id}`}
              onSelect={() => onSelect(track)}
            />
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

function AudioTrackMenuRow({
  track,
  fallback,
  onSelect,
}: {
  track: NativeTrack
  fallback: string
  onSelect: () => void
}) {
  const display = audioTrackDisplay(track, fallback)
  return (
    <button
      className={`mb-1 block w-full rounded-lg px-3 py-2 text-left ${
        track.selected ? "bg-amber-400 text-zinc-950" : "text-zinc-300 hover:bg-zinc-800"
      }`}
      onClick={onSelect}
    >
      <span className="block truncate text-sm font-medium" title={display.primary}>
        {display.primary}
      </span>
      <span className={`text-xs ${track.selected ? "text-zinc-800" : "text-zinc-500"}`}>
        {display.secondary}
      </span>
    </button>
  )
}

export function filterAddedAddonSubtitles<
  TSubtitle extends { display: string },
  TTrack extends { external: boolean; title?: string },
>(subtitles: TSubtitle[], tracks: TTrack[]): TSubtitle[] {
  const installedTitles = new Set(
    tracks.filter((track) => track.external && track.title).map((track) => track.title),
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
  return dedupeAddonSubtitles(
    results.flatMap((result) => {
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
    }),
  )
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
