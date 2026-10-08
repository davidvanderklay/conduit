import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { createPortal } from "react-dom"
import { Captions, Languages, Pause, Play, SkipForward, Volume2, VolumeX, X } from "lucide-react"
import type { InstalledAddon, PlaybackSource, PlayerArtwork, ProgressMetadata } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import { audioTrackDisplay } from "../lib/audio-track-display"
import {
  nativePlayerCommand,
  nativeFullscreen,
  nativePlayerSnapshot,
  openNativePlayer,
  updateNativePlayerOverlay,
  redrawNativeSurface,
  refreshNativeSurface,
  resetNativeOverlaySurface,
  setNativePlayerPlaying,
  stopNativePlayer,
  toggleNativeFullscreen,
  type NativePlayerSnapshot,
  type NativeTrack,
} from "../lib/desktop"
import { isDesktopBuffering, isDesktopInitialLoading } from "../lib/desktop-player-state"
import { loadSubtitles, type Video } from "../lib/core"
import { nativeMediaTitle, playerHeading, type PlayerHeading } from "../lib/player-title"
import { readPreferences, writePreferences } from "../lib/preferences"
import {
  activeSkipSegment,
  loadSkipSegments,
  shouldShowUpNext,
  type SkipSegment,
} from "../lib/skip-segments"
import { configuredTrackLanguage, matchesTrackLanguage } from "../lib/track-preference"
import { mpvVideoScaleCommands, type VideoScale } from "../lib/video-scale"
import { usePlaybackProgress } from "../lib/progress"
import { AUTO_SELECTION_STARTUP_TIMEOUT_MS } from "../lib/stream-selection"
import { Card } from "./ui/card"
import {
  NextEpisodePrompt,
  PlayerEpisodeDrawer,
  nextControlLabel,
  type PlayerDrawerOpen,
  type PlayerQueue,
  type PlayerSeriesContext,
} from "./player-series"
import type { PlayerUpNext } from "../lib/queue"
import type { QueueItem } from "../lib/api"
import { QueueIcon, QueueNotice } from "./queue"
import { SkipSegmentButton } from "./player-skip-prompt"
import { VideoScaleControl } from "./video-scale-control"
import { preferredSubtitle, subtitleLookupResults } from "../lib/subtitle-selection"
import { SubtitlePicker } from "./subtitle-picker"
import { trackDisplayName } from "../lib/track-display"
import {
  DesktopPlayerBufferingOverlay,
  DesktopPlayerOpeningOverlay,
} from "./desktop-player-overlays"
import {
  DesktopPlayerChromeBottom,
  DesktopPlayerChromeTop,
  DesktopPlayerControl as PlayerIcon,
} from "./desktop-player-chrome"
import { WatchPartyButton } from "./watch-party-dialog"
import {
  mediaFromProgressMetadata,
  type WatchPartyMedia,
  type WatchPartySession,
} from "../lib/watch-party"

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
  upNext,
  queue,
  onSelectEpisode,
  onNextEpisode,
  onEnded,
  autoRecoveryAttempt = false,
  onAutoRecoveryStarted,
  onAutoRecoveryFailed,
  onClose,
  partySession,
  onWatchParty,
  onRemoteMedia,
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
  upNext?: PlayerUpNext
  queue?: PlayerQueue
  onSelectEpisode?: (video: Video) => void | Promise<void>
  onNextEpisode?: () => void | Promise<void>
  onEnded?: (allowAutoplay?: boolean) => void | Promise<void>
  autoRecoveryAttempt?: boolean
  onAutoRecoveryStarted?: () => void
  onAutoRecoveryFailed?: () => void
  onClose: () => void
  partySession?: WatchPartySession
  onWatchParty?: () => void
  onRemoteMedia?: (media?: WatchPartyMedia) => void
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
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState<PlayerDrawerOpen>(false)
  const [skipSegments, setSkipSegments] = useState<SkipSegment[]>([])
  const [holdSpeedActive, setHoldSpeedActive] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const holdSpeedTimer = useRef<number | undefined>(undefined)
  const holdSpeedActiveRef = useRef(false)
  const holdSpeedTriggered = useRef(false)
  const closing = useRef(false)
  const currentUrl = useRef(url)
  currentUrl.current = url
  const audioButton = useRef<HTMLDivElement>(null)
  const subtitleButton = useRef<HTMLDivElement>(null)
  const previousMenu = useRef<TrackMenuName | undefined>(undefined)
  const previousMenuContent = useRef("")
  const previousChromeVisible = useRef(true)
  const previousEpisodeDrawerOpen = useRef<PlayerDrawerOpen>(false)
  const previousLoadingOverlayVisible = useRef(false)
  const previousPaused = useRef(false)
  const resumed = useRef(false)
  const mediaDurationObserved = useRef(false)
  const endedHandled = useRef(false)
  const nextTransitionSuppressed = useRef(false)
  const nextTransitionRequested = useRef(false)
  const lastPlayback = useRef({ position: 0, duration: 0 })
  const latestSnapshot = useRef<NativePlayerSnapshot | undefined>(undefined)
  const lastNativeSnapshot = useRef<NativePlayerSnapshot | undefined>(undefined)
  const seekActive = useRef(false)
  const seekDraft = useRef<number | undefined>(undefined)
  const seekCommitTimer = useRef<number | undefined>(undefined)
  const pendingAddonSubtitle = useRef(new Set<string>())
  const preferredAudioApplied = useRef(false)
  const preferredSubtitleApplied = useRef(false)
  const subtitleSelectionGeneration = useRef(0)
  const subtitlePlaybackReady = useRef(false)
  const addonLookupReady = useRef(false)
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
  const preferredAudioLanguage = configuredTrackLanguage(preferences.audioLanguage)
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
    let cancelled = false
    if (!preferences.skipSegments || type !== "series") {
      setSkipSegments([])
      return
    }
    void loadSkipSegments(
      progressMetadata.mediaId,
      progressMetadata.season,
      progressMetadata.episode,
    ).then((segments) => {
      if (!cancelled) setSkipSegments(segments)
    })
    return () => {
      cancelled = true
    }
  }, [
    preferences.skipSegments,
    progressMetadata.episode,
    progressMetadata.mediaId,
    progressMetadata.season,
    type,
  ])

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
  latestSnapshot.current = snapshot

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
        partySession?.role === "guest" ||
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
    [snapshot, partySession?.role],
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

  // The Linux overlay window cannot reach the API, so queue state is mirrored to it.
  const overlayQueueState = JSON.stringify({
    upNext,
    queue: queue && { items: queue.controls.items, media: queue.media },
  })
  const latestOverlayQueueState = useRef(overlayQueueState)
  latestOverlayQueueState.current = overlayQueueState
  useEffect(() => {
    void updateNativePlayerOverlay(JSON.parse(overlayQueueState)).catch(() => undefined)
  }, [overlayQueueState])

  const resetOverlay = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => void resetNativeOverlaySurface())
    })
  }, [])

  const playQueued = (item: QueueItem) => {
    if (!queue || nextTransitionRequested.current) return
    nextTransitionRequested.current = true
    resetOverlay()
    queue.onPlay(item)
  }

  useEffect(() => {
    let cancelled = false
    let playerStarted = false
    preferredAudioApplied.current = false
    preferredSubtitleApplied.current = false
    subtitleSelectionGeneration.current += 1
    subtitlePlaybackReady.current = false
    addonLookupReady.current = false
    setAddonSubtitles([])
    setShowRemainingTime(false)
    subtitleMetadataReadyPolls.current = 0
    setAddonSubtitlesResolved(false)
    endedHandled.current = false
    nextTransitionSuppressed.current = false
    nextTransitionRequested.current = false
    seekActive.current = false
    seekDraft.current = undefined
    mediaDurationObserved.current = false
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
              mediaId: seriesContext.media?.id,
              show: seriesContext.show,
              videos: seriesContext.videos,
              progress: seriesContext.progress,
              currentVideoId: seriesContext.currentVideoId,
            }
          : undefined,
      },
      {
        profileId,
        media: mediaFromProgressMetadata(progressMetadata, videoId),
        role: partySession?.role,
        party: partySession?.party,
        connected: partySession?.connected,
      },
      preferredAudioLanguage,
    )
      .then(async (initial) => {
        if (cancelled) return
        playerStarted = true
        subtitlePlaybackReady.current = true
        if (initial.duration > 0) mediaDurationObserved.current = true
        setSnapshot(initial)
        // The overlay only exists once the player is open; resend what it missed.
        void updateNativePlayerOverlay(JSON.parse(latestOverlayQueueState.current)).catch(
          () => undefined,
        )
        if (initial.firstFrameReady) setPlaybackStarted(true)
        if (!preferredSubtitleApplied.current) await nativePlayerCommand(["set", "sid", "no"])
        // Read styling at open time rather than depending on it: a dependency would
        // tear down and reopen the player whenever the position is adjusted mid-playback.
        const { subtitlePosition, subtitleOutline } = readPreferences()
        await nativePlayerCommand(["set", "sub-pos", subtitlePosition])
        await nativePlayerCommand(["set", "sub-border-size", subtitleOutline ? 3 : 0])
        const resolved = await resolveAddonSubtitles(addons, type, videoId)
        if (!cancelled) {
          // Keep the add-on catalog available immediately. `sub-add` is a
          // synchronous mpv command in the Linux helper, so bulk-loading every
          // subtitle here can block seeks and play/pause while remote files
          // download. The preference effect below loads only the selected
          // language, and manual selection loads one track at a time.
          setAddonSubtitles(resolved)
          addonLookupReady.current = true
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
          if (next.duration > 0) mediaDurationObserved.current = true
          const previous = lastNativeSnapshot.current
          const resolved = nativePlaybackEnded(previous, next) ? { ...next, ended: true } : next
          lastNativeSnapshot.current = resolved
          if (resolved.firstFrameReady) setPlaybackStarted(true)
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
      subtitleSelectionGeneration.current += 1
      playerStarted = false
      window.clearInterval(poll)
      window.clearTimeout(hideTimer.current)
      window.clearTimeout(seekCommitTimer.current)
      document.documentElement.classList.remove("native-playback")
      if (!closing.current && currentUrl.current === url) void stopNativePlayer()
    }
  }, [
    addons,
    artwork?.background,
    artwork?.logo,
    artwork?.poster,
    markAutoRecoveryStarted,
    mediaTitle,
    preferredAudioLanguage,
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
    const unsubscribeSubtitle =
      electron.onPlayerOverlaySubtitle?.(() => {
        preferredSubtitleApplied.current = true
        subtitleSelectionGeneration.current += 1
        setSelectedAddonSubtitle(undefined)
      }) ?? (() => undefined)
    const unsubscribeClose = electron.onPlayerOverlayClose(onClose)
    const unsubscribeNext = electron.onPlayerOverlayNext(() => {
      if (!onNextEpisode || nextTransitionRequested.current) return
      nextTransitionRequested.current = true
      const { duration } = lastPlayback.current
      void saveProgress(duration, duration, true)
      void Promise.resolve(onNextEpisode()).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    })
    const unsubscribeEpisode =
      electron.onPlayerOverlayEpisode?.((selectedVideoId) => {
        const selectedVideo = seriesContext?.videos.find((video) => video.id === selectedVideoId)
        if (!selectedVideo || !onSelectEpisode || nextTransitionRequested.current) return
        nextTransitionRequested.current = true
        resetOverlay()
        void Promise.resolve(onSelectEpisode(selectedVideo)).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause))
        })
      }) ?? (() => undefined)
    const unsubscribeWatchAction =
      electron.onPlayerOverlayWatchAction?.(({ videoIds, watched }) => {
        const targets = seriesContext?.videos.filter((video) => videoIds.includes(video.id)) ?? []
        if (!targets.length || !seriesContext?.onWatchAction) return
        void seriesContext.onWatchAction(targets, watched).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause))
        })
      }) ?? (() => undefined)
    const unsubscribeQueuePlay =
      electron.onPlayerOverlayQueuePlay?.(playQueued) ?? (() => undefined)
    const unsubscribeQueueSet =
      electron.onPlayerOverlayQueueSet?.((items) => queue?.controls.set(items)) ?? (() => undefined)
    return () => {
      unsubscribeSubtitle()
      unsubscribeClose()
      unsubscribeNext()
      unsubscribeEpisode()
      unsubscribeWatchAction()
      unsubscribeQueuePlay()
      unsubscribeQueueSet()
    }
  }, [
    playQueued,
    queue?.controls,
    onClose,
    onNextEpisode,
    onSelectEpisode,
    resetOverlay,
    saveProgress,
    seriesContext?.onWatchAction,
    seriesContext?.videos,
  ])

  useEffect(() => {
    if (preferredAudioApplied.current || !preferredAudioLanguage || !snapshot) {
      return
    }
    // The Linux overlay can select audio independently of this component.
    if (snapshot.audioSelectionExplicit) {
      preferredAudioApplied.current = true
      return
    }
    const audioTracks = snapshot.tracks.filter((track) => track.type === "audio")
    if (!audioTracks.length) return
    const match = audioTracks.find((track) =>
      matchesTrackLanguage(preferredAudioLanguage, track.lang, track.title),
    )
    if (!match) return
    preferredAudioApplied.current = true
    if (match.selected) return
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
      .catch(() => {
        preferredAudioApplied.current = false
      })
  }, [preferredAudioLanguage, snapshot])

  useEffect(() => {
    if (!subtitlePlaybackReady.current || preferredSubtitleApplied.current || !snapshot?.duration)
      return
    const subtitleTracks = snapshot.tracks.filter((track) => track.type === "sub")
    if (subtitleTracks.length === 0 && ++subtitleMetadataReadyPolls.current < 2) return
    const selected = preferredSubtitle<
      { kind: "embedded"; value: NativeTrack } | { kind: "addon"; value: ResolvedAddonSubtitle }
    >({
      candidates: [
        ...subtitleTracks
          .filter((track) => !track.external)
          .map((track) => ({
            track: { kind: "embedded" as const, value: track },
            language: track.lang,
            title: track.title,
            embedded: true,
          })),
        ...addonSubtitles.map((track) => ({
          track: { kind: "addon" as const, value: track },
          language: track.language,
          title: track.display,
          embedded: false,
        })),
      ],
      primary: preferences.subtitleLanguage,
      secondary: preferences.secondarySubtitleLanguage,
      embeddedReady: true,
      addonsReady: addonLookupReady.current,
    })
    if (selected === undefined) return
    preferredSubtitleApplied.current = true
    if (selected === null) {
      void nativePlayerCommand(["set", "sid", "no"]).catch(() => undefined)
      return
    }
    if (selected.kind === "embedded") {
      void nativePlayerCommand(["set", "sid", selected.value.id]).catch(() => undefined)
      return
    }
    const subtitle = selected.value
    const generation = subtitleSelectionGeneration.current
    const loaded = subtitleTracks.find(
      (track) => track.external && track.title === subtitle.display,
    )
    pendingAddonSubtitle.current.add(subtitle.key)
    // Loading must not select a track after a newer manual choice.
    void (
      loaded
        ? Promise.resolve()
        : nativePlayerCommand([
            "sub-add",
            subtitle.url,
            "auto",
            subtitle.display,
            subtitle.language,
          ])
    )
      .then(async () => {
        if (generation !== subtitleSelectionGeneration.current) return
        const tracks = loaded ? [loaded] : (await nativePlayerSnapshot()).tracks
        const track = tracks.find((track) => track.external && track.title === subtitle.display)
        if (!track || generation !== subtitleSelectionGeneration.current) return
        await nativePlayerCommand(["set", "sid", track.id])
        setSelectedAddonSubtitle(subtitle.key)
      })
      .catch(() => undefined)
      .finally(() => pendingAddonSubtitle.current.delete(subtitle.key))
  }, [
    addonSubtitles,
    addonSubtitlesResolved,
    preferences.subtitleLanguage,
    preferences.secondarySubtitleLanguage,
    snapshot,
  ])

  useEffect(() => {
    if (resumed.current || !snapshot?.duration || !progress.isSuccess) return
    resumed.current = true
    if (partySession?.role === "guest" || !progress.data || progress.data.watched) return
    const saved = progress.data.positionMs / 1000
    if (saved > 0 && (!snapshot.duration || saved < snapshot.duration - 5)) {
      void nativePlayerCommand(["seek", saved, "absolute+exact"])
      setSnapshot((current) => (current ? { ...current, position: saved } : current))
    }
  }, [progress.data, progress.isSuccess, snapshot])

  useEffect(() => {
    partySession?.sendReady(Boolean(snapshot?.firstFrameReady && !snapshot.loading))
  }, [partySession, snapshot?.firstFrameReady, snapshot?.loading])

  useEffect(() => {
    const updateContext = () => {
      void window.__CONDUIT_ELECTRON__?.invoke("player_overlay_context", {
        profileId,
        media: mediaFromProgressMetadata(progressMetadata, videoId),
        role: partySession?.party ? partySession.role : undefined,
        party: partySession?.party,
        connected: partySession?.connected,
      })
    }
    updateContext()
    return partySession?.subscribe((event) => {
      if (event.type !== "state") updateContext()
    })
  }, [partySession, profileId, progressMetadata, videoId])

  useEffect(() => {
    if (!partySession) return
    const applyState = () => {
      const state = partySession.state
      const current = latestSnapshot.current
      if (
        !partySession.connected ||
        partySession.role !== "guest" ||
        !state ||
        !current?.firstFrameReady ||
        partySession.media?.videoId !== videoId
      )
        return
      const position = partySession.positionAt(state)
      if (Math.abs(current.position - position) > 0.75)
        void nativePlayerCommand(["seek", position, "absolute+exact"])
      if (current.paused === state.playing)
        void nativePlayerCommand(["set", "pause", !state.playing])
      if ((current.rate ?? 1) !== state.rate) void nativePlayerCommand(["set", "speed", state.rate])
    }
    const unsubscribe = partySession.subscribe((event) => {
      if (event.type === "joined" || event.type === "state") applyState()
      if (
        (event.type === "disconnected" || event.type === "host-disconnected") &&
        partySession.role === "guest"
      )
        void nativePlayerCommand(["set", "pause", true])
      if (event.type === "media") onRemoteMedia?.(event.media ?? undefined)
    })
    const timer = window.setInterval(applyState, 1000)
    partySession.connect()
    return () => {
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [onRemoteMedia, partySession, videoId])

  useEffect(() => {
    if (!partySession || partySession.role !== "host") return
    const timer = window.setInterval(() => {
      const current = latestSnapshot.current
      if (!current || current.duration <= 0) return
      partySession.publishState({
        position: current.position,
        duration: current.duration,
        playing: !current.paused && !current.loading,
        rate: current.rate ?? 1,
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [partySession])

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
    if (!snapshot?.ended || endedHandled.current || !mediaDurationObserved.current) return
    endedHandled.current = true
    const duration = snapshot.duration || lastPlayback.current.duration
    if (!nextTransitionRequested.current) {
      nextTransitionRequested.current = true
      resetOverlay()
      void Promise.resolve(
        onEnded?.(partySession?.role !== "guest" && !nextTransitionSuppressed.current),
      ).catch((cause: unknown) => {
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

  useEffect(() => {
    const playing = Boolean(
      snapshot?.running &&
      snapshot.firstFrameReady &&
      !snapshot.paused &&
      !snapshot.ended &&
      !error,
    )
    void setNativePlayerPlaying(playing).catch(() => undefined)
  }, [error, snapshot?.ended, snapshot?.firstFrameReady, snapshot?.paused, snapshot?.running])

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
    if (!snapshot || partySession?.role === "guest") return
    void nativePlayerCommand(["cycle", "pause"])
    if (partySession?.role === "host")
      partySession.publishCommand(snapshot.paused ? "play" : "pause")
    setSnapshot((current) => (current ? { ...current, paused: !current.paused } : current))
    showControls()
  }, [partySession, showControls, snapshot])

  const closeTrackMenu = useCallback(() => {
    setActiveMenu(undefined)
  }, [])

  const toggleTrackMenu = useCallback((menu: TrackMenuName) => {
    setActiveMenu((current) => (current === menu ? undefined : menu))
  }, [])

  const seekRelative = useCallback(
    (seconds: number) => {
      if (!snapshot || partySession?.role === "guest") return
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
    [partySession?.role, showControls, snapshot],
  )

  const commitSeek = useCallback(() => {
    window.clearTimeout(seekCommitTimer.current)
    seekCommitTimer.current = undefined
    const position = seekDraft.current
    seekDraft.current = undefined
    seekActive.current = false
    if (position === undefined || partySession?.role === "guest") return
    void nativePlayerCommand(["seek", position, "absolute+exact"])
    if (partySession?.role === "host") partySession.publishCommand("seek", position)
  }, [partySession])

  const previewSeek = useCallback(
    (position: number) => {
      if (partySession?.role === "guest") return
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
      if (property === "sid") {
        preferredSubtitleApplied.current = true
        subtitleSelectionGeneration.current += 1
      }
      if (property === "aid") preferredAudioApplied.current = true
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
    Boolean(episodeDrawerOpen) ||
    !snapshot
  const electronNativePlayer = window.__CONDUIT_ELECTRON__ !== undefined
  const expandedControls = fullscreen || spaciousViewport
  const loadingOverlayVisible = isDesktopInitialLoading(snapshot, error)
  const bufferingOverlayVisible = isDesktopBuffering(snapshot, error)
  const activeSkip =
    partySession?.role !== "guest" && snapshot && preferences.skipSegments
      ? activeSkipSegment(snapshot.position, skipSegments)
      : undefined
  const upNextVisible = Boolean(
    partySession?.role !== "guest" &&
    snapshot &&
    upNext &&
    shouldShowUpNext(snapshot.position, snapshot.duration, skipSegments),
  )

  useEffect(() => {
    document.documentElement.classList.toggle("player-cursor-hidden", !chromeVisible)
    return () => document.documentElement.classList.remove("player-cursor-hidden")
  }, [chromeVisible])

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
              className={`mt-1 truncate text-zinc-400 ${expandedControls ? "text-sm" : "text-xs"}`}
              title={nativePlaybackDescription(snapshot)}
            >
              {nativePlaybackDescription(snapshot)}
            </p>
          ) : undefined
        }
        actions={
          <>
            {queue && (
              <button
                className="grid size-10 shrink-0 place-items-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                type="button"
                aria-label="Queue"
                title="Queue"
                data-native-overlay
                data-player-drawer-toggle
                onClick={(event) => {
                  event.stopPropagation()
                  setEpisodeDrawerOpen((open) => (open ? false : "queue"))
                }}
              >
                <QueueIcon count={queue.controls.items.length} size={18} />
              </button>
            )}
            {onWatchParty && (
              <WatchPartyButton onClick={onWatchParty} active={Boolean(partySession)} />
            )}
          </>
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
        <>
          {preferences.skipButtonPlacement === "left" && activeSkip && (
            <SkipSegmentButton
              segment={activeSkip}
              placement="left"
              revealKey={chromeVisible}
              onSkip={() => {
                void nativePlayerCommand(["seek", activeSkip.end, "absolute", "exact"])
                setSnapshot((current) =>
                  current ? { ...current, position: activeSkip.end } : current,
                )
                resetOverlay()
              }}
            />
          )}
          <div className="pointer-events-none absolute bottom-36 right-4 z-20 flex flex-col items-end gap-3 sm:right-6">
            {preferences.skipButtonPlacement === "right" && activeSkip && (
              <SkipSegmentButton
                segment={activeSkip}
                placement="right"
                contained
                revealKey={chromeVisible}
                onSkip={() => {
                  void nativePlayerCommand(["seek", activeSkip.end, "absolute", "exact"])
                  setSnapshot((current) =>
                    current ? { ...current, position: activeSkip.end } : current,
                  )
                  resetOverlay()
                }}
              />
            )}
            <NextEpisodePrompt
              upNext={upNext}
              position={snapshot.position}
              duration={snapshot.duration || lastPlayback.current.duration}
              paused={snapshot.paused}
              autoplay={preferences.autoplay}
              visible={upNextVisible}
              contained
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
          </div>
        </>
      )}
      <PlayerEpisodeDrawer
        open={episodeDrawerOpen}
        handleVisible={chromeVisible}
        context={seriesContext}
        queue={queue && { ...queue, onPlay: playQueued }}
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
      <QueueNotice className="absolute left-6 top-16" />

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
                preferredSubtitleApplied.current = true
                const generation = ++subtitleSelectionGeneration.current
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
                      "auto",
                      subtitle.display,
                      subtitle.language,
                    ])
                  }
                  if (generation !== subtitleSelectionGeneration.current) return
                  if (!existing) {
                    const loaded = (await nativePlayerSnapshot()).tracks.find(
                      (track) => track.external && track.title === subtitle.display,
                    )
                    if (!loaded || generation !== subtitleSelectionGeneration.current) return
                    await nativePlayerCommand(["set", "sid", loaded.id])
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
                preferredSubtitleApplied.current = true
                subtitleSelectionGeneration.current += 1
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
              title={showRemainingTime ? "Click to show end time" : "Click to show time remaining"}
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
                label={nextControlLabel(upNext)}
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
  return trackDisplayName(track, `${fallback} ${track.id}`)
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
  const results = await subtitleLookupResults(
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
