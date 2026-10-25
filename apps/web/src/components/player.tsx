import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import {
  Captions,
  Expand,
  LoaderCircle,
  Pause,
  PictureInPicture,
  Play,
  Settings2,
  SkipForward,
  UsersRound,
  Volume2,
  VolumeX,
} from "lucide-react"
import type Hls from "hls.js"
import type { InstalledAddon, PlaybackSource, PlayerArtwork, ProgressMetadata } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import { loadSubtitles, type Subtitle, type Video } from "../lib/core"
import { isDesktop } from "../lib/desktop"
import { readPreferences, writePreferences } from "../lib/preferences"
import { playbackBufferState } from "../lib/playback-buffer"
import { browserPlaybackError } from "../lib/playback-compatibility"
import { playerHeading, type PlayerHeading } from "../lib/player-title"
import { AUTO_SELECTION_STARTUP_TIMEOUT_MS } from "../lib/stream-selection"
import { subtitlePositionForVideoScale, videoObjectFit, type VideoScale } from "../lib/video-scale"
import { usePlaybackProgress } from "../lib/progress"
import { usePlayerMediaSession } from "../lib/media-session"
import {
  playerShortcut,
  steppedSpeed,
  steppedVolume,
  type PlayerShortcut,
} from "../lib/player-shortcuts"
import { PlayerFlash, usePlayerFlash } from "./player-flash"
import type { WebMediaEngine, WebSource } from "../lib/web-engine/engine"
import { MatroskaSubtitles, attachMatroskaSubtitles } from "../lib/web-engine/matroska-subtitles"
import {
  PLAYBACK_MEDIA_EVENTS,
  type PlaybackMedia,
  type PlaybackMediaEvent,
} from "../lib/web-engine/media"
import {
  choosePlaybackRoute,
  engineCanPlay,
  webEngineSupported,
  webGpuAvailable,
  type PlaybackRoute,
} from "../lib/web-engine/route"
import { DesktopPlayer } from "./desktop-player"
import {
  NextEpisodePrompt,
  PlayerEpisodeDrawer,
  nextControlLabel,
  type PlayerDrawerOpen,
  type PlayerQueue,
  type PlayerSeriesContext,
} from "./player-series"
import type { PlayerUpNext } from "../lib/queue"
import { QueueIcon, QueueNotice } from "./queue"
import { VideoScaleControl } from "./video-scale-control"
import { preferredSubtitle, subtitleLookupResults } from "../lib/subtitle-selection"
import { SubtitlePicker } from "./subtitle-picker"
import { partyPositionAt, type WatchPartySession, type WatchPartyMedia } from "../lib/watch-party"

interface PlayerSubtitle extends Subtitle {
  key: string
  display: string
  addonName?: string
  embedded?: boolean
}

interface AudioChoice {
  id: number
  label: string
  language?: string
  kind: "hls" | "native" | "engine"
  disabled?: boolean
}

/** How long the engine may spend reading a source's headers before `<video>` takes over. */
const PROBE_TIMEOUT_MS = 10_000

export function Player({
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
  if (isDesktop()) {
    return (
      <DesktopPlayer
        accountId={accountId}
        url={url}
        type={type}
        videoId={videoId}
        profileId={profileId}
        playbackSource={playbackSource}
        progressMetadata={progressMetadata}
        artwork={artwork}
        addons={addons}
        seriesContext={partySession?.role === "guest" ? undefined : seriesContext}
        upNext={partySession?.role === "guest" ? undefined : upNext}
        queue={partySession?.role === "guest" ? undefined : queue}
        onSelectEpisode={partySession?.role === "guest" ? undefined : onSelectEpisode}
        onNextEpisode={partySession?.role === "guest" ? undefined : onNextEpisode}
        onEnded={onEnded}
        autoRecoveryAttempt={autoRecoveryAttempt}
        onAutoRecoveryStarted={onAutoRecoveryStarted}
        onAutoRecoveryFailed={onAutoRecoveryFailed}
        onClose={onClose}
        partySession={partySession}
        onWatchParty={onWatchParty}
        onRemoteMedia={onRemoteMedia}
      />
    )
  }
  return (
    <WebPlayer
      accountId={accountId}
      url={url}
      type={type}
      videoId={videoId}
      profileId={profileId}
      playbackSource={playbackSource}
      progressMetadata={progressMetadata}
      artwork={artwork}
      addons={addons}
      seriesContext={partySession?.role === "guest" ? undefined : seriesContext}
      upNext={partySession?.role === "guest" ? undefined : upNext}
      queue={partySession?.role === "guest" ? undefined : queue}
      onSelectEpisode={partySession?.role === "guest" ? undefined : onSelectEpisode}
      onNextEpisode={partySession?.role === "guest" ? undefined : onNextEpisode}
      onEnded={onEnded}
      autoRecoveryAttempt={autoRecoveryAttempt}
      onAutoRecoveryStarted={onAutoRecoveryStarted}
      onAutoRecoveryFailed={onAutoRecoveryFailed}
      onClose={onClose}
      partySession={partySession}
      onWatchParty={onWatchParty}
      onRemoteMedia={onRemoteMedia}
    />
  )
}

function WebPlayer({
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
  const heading = playerHeading(progressMetadata)
  const shellRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The element or engine currently playing. Playback controls go through it, while
  // text tracks and hls.js stay on the `<video>` element.
  const mediaRef = useRef<PlaybackMedia | null>(null)
  const engineRef = useRef<WebMediaEngine | null>(null)
  const [media, setMedia] = useState<PlaybackMedia>()
  const [route, setRoute] = useState<PlaybackRoute>("native")
  // Starts the other route once if the first one fails before playback begins.
  const fallbackRef = useRef<(() => void) | undefined>(undefined)
  const hlsRef = useRef<Hls | null>(null)
  const subtitleObjectUrl = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [playbackError, setPlaybackError] = useState<string>()
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [volume, setVolume] = useState(preferences.volume / 100)
  const [muted, setMuted] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [subtitles, setSubtitles] = useState<PlayerSubtitle[]>([])
  const [selectedSubtitle, setSelectedSubtitle] = useState("off")
  const [subtitleError, setSubtitleError] = useState<string>()
  const [subtitleLoading, setSubtitleLoading] = useState(true)
  const [subtitleMetadataReady, setSubtitleMetadataReady] = useState(false)
  const subtitleSelectionGeneration = useRef(0)
  const manualSubtitleSelection = useRef(false)
  const lastAutomaticSubtitle = useRef<string | null | undefined>(undefined)
  const embeddedDiscoveryReady = useRef(false)
  const addonLookupReady = useRef(false)
  const externalSubtitleTrack = useRef<HTMLTrackElement | null>(null)
  const addonTextTracks = useRef(new WeakSet<TextTrack>())
  const [subtitlePosition, setSubtitlePosition] = useState(preferences.subtitlePosition)
  const [audioChoices, setAudioChoices] = useState<AudioChoice[]>([])
  const [selectedAudio, setSelectedAudio] = useState<number>()
  const [videoScale, setVideoScale] = useState<VideoScale>("fit")
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState<PlayerDrawerOpen>(false)
  const nextTransitionSuppressed = useRef(false)
  const nextTransitionRequested = useRef(false)
  const [playbackStarted, setPlaybackStarted] = useState(false)
  const applyingPartyUpdate = useRef(false)
  const lastSubtitle = useRef<string | undefined>(undefined)
  const [flashMessage, flash] = usePlayerFlash()
  const { progress, save: saveProgress } = usePlaybackProgress(
    profileId,
    videoId,
    progressMetadata,
    playbackStarted ? playbackSource : undefined,
    accountId,
  )
  const resumed = useRef(false)
  const autoRecoveryStarted = useRef(false)
  const autoRecoveryFailureReported = useRef(false)
  const autoRecoveryAttemptRef = useRef(autoRecoveryAttempt)
  const onAutoRecoveryStartedRef = useRef(onAutoRecoveryStarted)
  const onAutoRecoveryFailedRef = useRef(onAutoRecoveryFailed)
  autoRecoveryAttemptRef.current = autoRecoveryAttempt
  onAutoRecoveryStartedRef.current = onAutoRecoveryStarted
  onAutoRecoveryFailedRef.current = onAutoRecoveryFailed

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

  const markAutoRecoveryStarted = useCallback(() => {
    if (!autoRecoveryAttemptRef.current || autoRecoveryStarted.current) return
    autoRecoveryStarted.current = true
    onAutoRecoveryStartedRef.current?.()
  }, [])

  const currentSubtitlePosition = useCallback(
    (position: number) => {
      const video = mediaRef.current
      const shell = shellRef.current
      if (!video || !shell) return position
      const bounds = shell.getBoundingClientRect()
      return subtitlePositionForVideoScale(
        position,
        videoScale,
        { width: video.videoWidth, height: video.videoHeight },
        { width: bounds.width, height: bounds.height },
      )
    },
    [videoScale],
  )

  const repositionVisibleSubtitles = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const position = currentSubtitlePosition(subtitlePosition)
    Array.from(video.textTracks)
      .filter((track) => track.mode === "showing")
      .forEach((track) => applyTextTrackPosition(track, position))
  }, [currentSubtitlePosition, subtitlePosition])

  useEffect(() => {
    repositionVisibleSubtitles()
    window.addEventListener("resize", repositionVisibleSubtitles)
    return () => window.removeEventListener("resize", repositionVisibleSubtitles)
  }, [repositionVisibleSubtitles])

  const close = () => {
    const video = mediaRef.current
    if (video && resumed.current) {
      void saveProgress(video.currentTime, video.duration, true).catch(() => undefined)
    }
    onClose()
  }

  useEffect(() => {
    if (!partySession) return
    const video = media
    const applyRemoteState = (state: Parameters<typeof partyPositionAt>[0]) => {
      if (!video || partySession.role !== "guest") return
      if (video.readyState < 1) return
      applyingPartyUpdate.current = true
      const nextPosition = partySession.positionAt(state)
      if (Math.abs(video.currentTime - nextPosition) > 0.75) video.currentTime = nextPosition
      video.playbackRate = state.rate
      if (state.playing && video.paused) void video.play().catch(() => undefined)
      if (!state.playing && !video.paused) video.pause()
      window.setTimeout(() => {
        applyingPartyUpdate.current = false
      }, 0)
    }
    const unsubscribe = partySession.subscribe((event) => {
      if (event.type === "joined" && event.state) applyRemoteState(event.state)
      if (event.type === "state") applyRemoteState(event.state)
      if (
        (event.type === "disconnected" || event.type === "host-disconnected") &&
        partySession.role === "guest"
      )
        video?.pause()
      if (event.type === "media") onRemoteMedia?.(event.media ?? undefined)
    })
    const applyLatest = () => {
      partySession.sendReady(Boolean(video && video.readyState >= 3))
      if (partySession.state) applyRemoteState(partySession.state)
    }
    video?.addEventListener("loadedmetadata", applyLatest)
    video?.addEventListener("canplay", applyLatest)
    partySession.connect()
    return () => {
      unsubscribe()
      video?.removeEventListener("loadedmetadata", applyLatest)
      video?.removeEventListener("canplay", applyLatest)
    }
  }, [media, onRemoteMedia, partySession])

  useEffect(() => {
    if (!partySession || partySession.role !== "host") return
    const publish = () => {
      const video = mediaRef.current
      if (!video || !Number.isFinite(video.duration)) return
      partySession.publishState({
        position: video.currentTime,
        duration: video.duration,
        playing: !video.paused && video.readyState >= 3,
        rate: video.playbackRate,
      })
    }
    const timer = window.setInterval(publish, 1000)
    return () => window.clearInterval(timer)
  }, [partySession])

  useEffect(() => {
    const video = mediaRef.current
    if (resumed.current || !video || !duration || !progress.isSuccess) return
    resumed.current = true
    if (partySession?.role === "guest" || !progress.data || progress.data.watched) return
    const saved = progress.data.positionMs / 1000
    if (saved > 0 && saved < duration - 5) {
      video.currentTime = saved
      setCurrentTime(saved)
    }
  }, [duration, progress.data, progress.isSuccess])

  const refreshNativeTracks = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const embedded = Array.from(video.textTracks).flatMap((track, index) =>
      addonTextTracks.current.has(track)
        ? []
        : [
            {
              id: `embedded-${index}`,
              key: `embedded-${index}`,
              url: "",
              lang: track.language,
              display: track.label || languageName(track.language) || `Embedded ${index + 1}`,
              embedded: true,
            },
          ],
    )
    if (video.readyState >= 1) {
      embeddedDiscoveryReady.current = true
      setSubtitleMetadataReady(true)
    }
    setSubtitles((current) => [...current.filter((subtitle) => !subtitle.embedded), ...embedded])

    const tracks = getNativeAudioTracks(video)
    if (tracks.length) {
      const choices = tracks.map((track, index) => ({
        id: index,
        label: track.label || languageName(track.language) || `Audio ${index + 1}`,
        language: track.language,
        kind: "native" as const,
      }))
      setAudioChoices(choices)
      setSelectedAudio(
        Math.max(
          0,
          tracks.findIndex((track) => track.enabled),
        ),
      )
    }
  }, [])

  useEffect(() => {
    const tracks = videoRef.current?.textTracks
    tracks?.addEventListener("addtrack", refreshNativeTracks)
    return () => tracks?.removeEventListener("addtrack", refreshNativeTracks)
  }, [refreshNativeTracks])

  useEffect(() => {
    let cancelled = false
    addonLookupReady.current = false
    setSubtitleLoading(true)
    setSubtitleError(undefined)
    const candidates = addonsForResource(addons, "subtitles", type, videoId)
    void subtitleLookupResults(
      candidates.map(async (addon) => ({
        addon,
        subtitles: await loadSubtitles(addon.manifestUrl, type, videoId),
      })),
    ).then((results) => {
      if (cancelled) return
      const found = results.flatMap((result) => {
        if (result.status === "rejected") return []
        return result.value.subtitles
          .filter((subtitle) => subtitle.url)
          .map((subtitle, index) => {
            const language =
              subtitle.lang ??
              subtitle.language ??
              subtitle.languageCode ??
              subtitle.locale ??
              subtitle.label
            return {
              ...subtitle,
              key: `${result.value.addon.id}:${subtitle.id || index}`,
              display: `${languageName(language) || language || "Unknown"} · ${result.value.addon.manifest.name}`,
              addonName: result.value.addon.manifest.name,
            }
          })
      })
      setSubtitles((current) => [...found, ...current.filter((subtitle) => subtitle.embedded)])
      const failed = results.filter((result) => result.status === "rejected").length
      if (failed) {
        setSubtitleError(
          found.length
            ? `${failed} subtitle provider${failed === 1 ? "" : "s"} could not be loaded. Other results are still available.`
            : "Subtitle providers could not be loaded.",
        )
      } else if (!found.length && candidates.length) {
        setSubtitleError("No add-on subtitles were returned.")
      }
      addonLookupReady.current = true
      setSubtitleLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [addons, type, videoId])

  const subtitleLine = useEffectEvent(() => currentSubtitlePosition(subtitlePosition))

  const handleMediaEvent = useEffectEvent((type: PlaybackMediaEvent, target: PlaybackMedia) => {
    switch (type) {
      case "play":
        setPlaying(true)
        setPlaybackStarted(true)
        markAutoRecoveryStarted()
        if (partySession?.role === "host" && !applyingPartyUpdate.current)
          partySession.publishCommand("play")
        break
      case "pause":
        setPlaying(false)
        if (partySession?.role === "host" && !applyingPartyUpdate.current)
          partySession.publishCommand("pause")
        if (resumed.current) void saveProgress(target.currentTime, target.duration, true)
        break
      case "playing":
        fallbackRef.current = undefined
        setWaiting(false)
        setPlaybackStarted(true)
        markAutoRecoveryStarted()
        break
      case "error": {
        const fallback = fallbackRef.current
        fallbackRef.current = undefined
        if (fallback) {
          fallback()
          break
        }
        setWaiting(false)
        reportAutoRecoveryFailure()
        setPlaybackError(browserPlaybackError(target.error?.code))
        break
      }
      case "waiting":
        setWaiting(true)
        break
      case "timeupdate":
        setCurrentTime(target.currentTime)
        setBufferedEnd(playbackBufferState(target.buffered, target.currentTime).end)
        if (resumed.current) void saveProgress(target.currentTime, target.duration)
        break
      case "progress":
        setBufferedEnd(playbackBufferState(target.buffered, target.currentTime).end)
        break
      case "ended":
        setPlaying(false)
        if (!nextTransitionRequested.current) {
          nextTransitionRequested.current = true
          void Promise.resolve(
            onEnded?.(partySession?.role !== "guest" && !nextTransitionSuppressed.current),
          ).catch(() => undefined)
        }
        void saveProgress(target.duration, target.duration, true).catch(() => undefined)
        break
      case "durationchange":
        setDuration(target.duration || 0)
        break
      case "loadedmetadata":
        if (target === videoRef.current) refreshNativeTracks()
        repositionVisibleSubtitles()
        break
      case "volumechange":
        setVolume(target.volume)
        setMuted(target.muted)
        break
      case "canplay":
        break
    }
  })

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    video.volume = preferences.volume / 100
    video.autoplay = preferences.autoplay
    let cancelled = false
    let hls: Hls | undefined
    let source: WebSource | undefined
    let engine: WebMediaEngine | undefined
    let detach = () => {}
    let detachSubtitles = () => {}
    // Embedded Matroska subtitles found after probing, which engine playback waits on briefly.
    let embeddedSubtitles: Promise<unknown> = Promise.resolve()
    setWaiting(true)
    setPlaybackError(undefined)
    setAudioChoices([])
    manualSubtitleSelection.current = false
    lastAutomaticSubtitle.current = undefined
    embeddedDiscoveryReady.current = false
    subtitleSelectionGeneration.current += 1
    setSubtitleMetadataReady(false)
    setSelectedSubtitle("off")
    setSubtitles((current) => current.filter((subtitle) => !subtitle.embedded))

    const attach = (target: PlaybackMedia) => {
      detach()
      const listeners = PLAYBACK_MEDIA_EVENTS.map((type) => {
        const listener = () => handleMediaEvent(type, target)
        target.addEventListener(type, listener)
        return () => target.removeEventListener(type, listener)
      })
      detach = () => listeners.forEach((remove) => remove())
      mediaRef.current = target
      setMedia(target)
    }

    const playNative = () => {
      setRoute("native")
      attach(video)
      if (!isHls(url)) {
        video.src = url
        return
      }
      void import("hls.js").then(({ default: HlsPlayer }) => {
        if (cancelled) return
        if (HlsPlayer.isSupported()) {
          hls = new HlsPlayer({
            maxBufferLength: preferences.readAheadSeconds,
            maxMaxBufferLength: Math.max(60, preferences.readAheadSeconds * 2),
            backBufferLength: Math.max(30, preferences.readAheadSeconds),
            maxBufferSize: 60 * 1024 * 1024,
          })
          hlsRef.current = hls
          hls.on(HlsPlayer.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
            setAudioChoices(
              data.audioTracks.map((track, index) => ({
                id: index,
                label: track.name || languageName(track.lang) || `Audio ${index + 1}`,
                language: track.lang,
                kind: "hls",
              })),
            )
            setSelectedAudio(hls?.audioTrack ?? 0)
          })
          hls.on(HlsPlayer.Events.AUDIO_TRACK_SWITCHED, (_, data) => setSelectedAudio(data.id))
          hls.on(HlsPlayer.Events.ERROR, (_, data) => {
            if (data.fatal) {
              reportAutoRecoveryFailure()
              setPlaybackError(browserPlaybackError())
            }
          })
          hls.loadSource(url)
          hls.attachMedia(video)
        } else {
          video.src = url
        }
      })
    }

    const playEngine = async (opened: WebSource) => {
      const { WebMediaEngine } = await import("../lib/web-engine/engine")
      if (cancelled) return
      engine = new WebMediaEngine(opened, canvas, { volume: preferences.volume / 100 })
      engineRef.current = engine
      setRoute("engine")
      attach(engine)
      await engine.load({ autoplay: preferences.autoplay })
      if (cancelled || engine.error) return
      const selected = engine.selectedAudioTrack
      setAudioChoices(
        engine.audioTracks.map((track, index) => ({
          id: index,
          label: `${track.name || (track.language !== "und" && languageName(track.language)) || `Audio ${index + 1}`}${
            track.decodable ? "" : " (unsupported in browser)"
          }`,
          language: track.language,
          kind: "engine",
          disabled: !track.decodable,
        })),
      )
      setSelectedAudio(selected && engine.audioTracks.indexOf(selected))
      // Embedded tracks come only from the Matroska reader, so selection waits for it briefly.
      await Promise.race([
        embeddedSubtitles,
        new Promise((resolve) => window.setTimeout(resolve, 3000)),
      ])
      if (cancelled) return
      embeddedDiscoveryReady.current = true
      setSubtitleMetadataReady(true)
    }

    const startEngine = (opened: WebSource) => {
      void playEngine(opened).catch(() => {
        if (!cancelled) playNative()
      })
    }

    if (isHls(url) || !webEngineSupported()) {
      playNative()
    } else {
      void probeSource(url).then(async (opened) => {
        if (cancelled) {
          opened?.input.dispose()
          return
        }
        if (!opened) {
          playNative()
          return
        }
        source = opened
        if (/matroska|webm/.test(opened.probe.containerMimeType)) {
          embeddedSubtitles = MatroskaSubtitles.open(url)
            .then((subtitles) => {
              if (cancelled || !subtitles) return
              detachSubtitles = attachMatroskaSubtitles(subtitles, video, {
                currentTime: () => mediaRef.current?.currentTime ?? 0,
                linePosition: subtitleLine,
              })
            })
            .catch(() => undefined)
        }
        const webgpu = await webGpuAvailable()
        if (cancelled) return
        const route = choosePlaybackRoute(opened.probe, {
          canPlayType: (mimeType) => video.canPlayType(mimeType) !== "",
          webgpu,
        })
        if (route === "engine") {
          fallbackRef.current = () => {
            engine?.destroy()
            engine = undefined
            engineRef.current = null
            playNative()
          }
          startEngine(opened)
          return
        }
        if (engineCanPlay(opened.probe)) {
          fallbackRef.current = () => {
            video.removeAttribute("src")
            video.load()
            startEngine(opened)
          }
        }
        playNative()
      })
    }

    return () => {
      cancelled = true
      detach()
      fallbackRef.current = undefined
      hls?.destroy()
      hlsRef.current = null
      if (engine) engine.destroy()
      else source?.input.dispose()
      detachSubtitles()
      engineRef.current = null
      mediaRef.current = null
      video.removeAttribute("src")
      video.load()
    }
  }, [
    preferences.autoplay,
    preferences.readAheadSeconds,
    preferences.volume,
    markAutoRecoveryStarted,
    reportAutoRecoveryFailure,
    url,
  ])

  useEffect(() => {
    return () => {
      subtitleSelectionGeneration.current += 1
      externalSubtitleTrack.current?.remove()
      externalSubtitleTrack.current = null
      if (subtitleObjectUrl.current) URL.revokeObjectURL(subtitleObjectUrl.current)
    }
  }, [])

  const chooseSubtitle = useCallback(
    async (key: string, cuePosition = subtitlePosition, automatic = false) => {
      if (!automatic) manualSubtitleSelection.current = true
      const generation = ++subtitleSelectionGeneration.current
      const video = videoRef.current
      if (!video) return
      setSelectedSubtitle(key)
      setSubtitleError(undefined)
      externalSubtitleTrack.current?.remove()
      externalSubtitleTrack.current = null
      Array.from(video.textTracks).forEach((track) => {
        track.mode = "disabled"
      })
      if (subtitleObjectUrl.current) {
        URL.revokeObjectURL(subtitleObjectUrl.current)
        subtitleObjectUrl.current = null
      }
      if (key === "off") return
      const subtitle = subtitles.find((candidate) => candidate.key === key)
      if (!subtitle) return
      if (subtitle.embedded) {
        const index = Number(key.replace("embedded-", ""))
        const textTrack = video.textTracks[index]
        if (textTrack) {
          textTrack.mode = "showing"
          applyTextTrackPosition(textTrack, currentSubtitlePosition(cuePosition))
        }
        return
      }
      try {
        const response = await fetch(subtitle.url)
        if (!response.ok) throw new Error(`Subtitle request returned HTTP ${response.status}`)
        const body = await response.text()
        if (generation !== subtitleSelectionGeneration.current) return
        const effectivePosition = currentSubtitlePosition(cuePosition)
        const vtt = positionWebVtt(toWebVtt(body), effectivePosition)
        const objectUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }))
        subtitleObjectUrl.current = objectUrl
        const track = document.createElement("track")
        track.kind = "subtitles"
        track.label = subtitle.display
        track.srclang = subtitle.lang ?? subtitle.language ?? "und"
        track.src = objectUrl
        track.default = false
        externalSubtitleTrack.current = track
        video.append(track)
        addonTextTracks.current.add(track.track)
        // Hidden starts cue loading without displaying a track before the request is current.
        track.track.mode = "hidden"
        track.addEventListener("load", () => {
          if (generation !== subtitleSelectionGeneration.current) return
          applyTextTrackPosition(track.track, effectivePosition)
          track.track.mode = "showing"
        })
      } catch (error) {
        if (generation !== subtitleSelectionGeneration.current) return
        setSelectedSubtitle("off")
        setSubtitleError(
          error instanceof Error
            ? `${error.message}. The subtitle host may not allow browser access.`
            : "Could not load subtitles.",
        )
      }
    },
    [currentSubtitlePosition, subtitlePosition, subtitles],
  )

  useEffect(() => {
    if (manualSubtitleSelection.current) return
    const selected = preferredSubtitle({
      candidates: subtitles.map((track) => ({
        track: track.key,
        language: track.lang ?? track.language,
        title: track.display,
        embedded: Boolean(track.embedded),
      })),
      primary: preferences.subtitleLanguage,
      secondary: preferences.secondarySubtitleLanguage,
      embeddedReady: embeddedDiscoveryReady.current && subtitleMetadataReady,
      addonsReady: addonLookupReady.current && !subtitleLoading,
    })
    if (selected === undefined || selected === lastAutomaticSubtitle.current) return
    lastAutomaticSubtitle.current = selected
    void chooseSubtitle(selected ?? "off", subtitlePosition, true)
  }, [
    chooseSubtitle,
    preferences.subtitleLanguage,
    preferences.secondarySubtitleLanguage,
    subtitleMetadataReady,
    subtitleLoading,
    subtitlePosition,
    subtitles,
  ])

  const chooseAudio = (choice: AudioChoice) => {
    const video = videoRef.current
    if (!video || choice.disabled) return
    const engineTrack = engineRef.current?.audioTracks[choice.id]
    if (choice.kind === "engine" && engineTrack) {
      engineRef.current?.selectAudioTrack(engineTrack)
    } else if (choice.kind === "hls" && hlsRef.current) {
      hlsRef.current.audioTrack = choice.id
    } else {
      getNativeAudioTracks(video).forEach((track, index) => {
        track.enabled = index === choice.id
      })
    }
    setSelectedAudio(choice.id)
  }

  // Party guests follow the host, but may resume when the host is playing.
  const play = () => {
    if (partySession?.role === "guest" && !partySession.state?.playing) return
    void mediaRef.current?.play().catch(() => undefined)
  }

  const pause = () => {
    if (partySession?.role !== "guest") mediaRef.current?.pause()
  }

  const togglePlayback = () => {
    if (mediaRef.current?.paused) play()
    else pause()
  }

  const seekBy = (seconds: number) => {
    const video = mediaRef.current
    if (!video || partySession?.role === "guest") return
    const position = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + seconds))
    video.currentTime = position
    if (partySession?.role === "host") partySession.publishCommand("seek", position)
  }

  const playNext = () => {
    if (!onNextEpisode || nextTransitionRequested.current) return
    nextTransitionRequested.current = true
    void onNextEpisode()
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) void shellRef.current?.requestFullscreen()
    else void document.exitFullscreen()
  }

  const selectedSubtitleLabel =
    subtitles.find((subtitle) => subtitle.key === selectedSubtitle)?.display ?? "Off"
  const subtitleItems = subtitles.map((subtitle) => ({
    key: subtitle.key,
    language: subtitle.lang ?? subtitle.language ?? subtitle.display,
    title: subtitle.embedded
      ? subtitle.display
      : subtitle.label || languageName(subtitle.lang ?? subtitle.language) || "Subtitle",
    detail: subtitle.embedded ? "Embedded" : subtitle.addonName || "Add-on subtitle",
    embedded: subtitle.embedded,
    active: selectedSubtitle === subtitle.key,
  }))

  const changeSubtitlePosition = (value: number) => {
    setSubtitlePosition(value)
    writePreferences({ ...readPreferences(), subtitlePosition: value })
    if (selectedSubtitle !== "off") void chooseSubtitle(selectedSubtitle, value)
  }

  const runShortcut = (shortcut: PlayerShortcut) => {
    const video = mediaRef.current
    if (!video) return
    switch (shortcut.type) {
      case "toggle-playback":
        togglePlayback()
        return
      case "seek":
        if (partySession?.role === "guest") return
        seekBy(shortcut.seconds)
        flash(`${shortcut.seconds > 0 ? "+" : "-"}${Math.abs(shortcut.seconds)}s`)
        return
      case "volume": {
        const volume = steppedVolume(video.muted ? 0 : video.volume * 100, shortcut.delta)
        video.volume = volume / 100
        video.muted = false
        flash(`Volume ${volume}%`)
        return
      }
      case "mute":
        video.muted = !video.muted
        flash(video.muted ? "Muted" : "Unmuted")
        return
      case "fullscreen":
        toggleFullscreen()
        return
      case "toggle-subtitles": {
        if (selectedSubtitle !== "off") {
          lastSubtitle.current = selectedSubtitle
          void chooseSubtitle("off")
          flash("Subtitles off")
          return
        }
        // Nothing to restore yet, so let the viewer pick.
        const subtitle = subtitles.find((candidate) => candidate.key === lastSubtitle.current)
        if (!subtitle) {
          setShowSettings(true)
          return
        }
        void chooseSubtitle(subtitle.key)
        flash(subtitle.display)
        return
      }
      case "menu":
        // Audio and subtitles share one settings panel here.
        setShowSettings((open) => !open)
        return
      case "speed": {
        if (partySession?.role === "guest") return
        video.playbackRate = steppedSpeed(video.playbackRate, shortcut.delta)
        flash(`${video.playbackRate}×`)
        return
      }
      case "next":
        playNext()
        return
    }
  }
  const latestRunShortcut = useRef(runShortcut)
  latestRunShortcut.current = runShortcut

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && showSettings) {
        event.preventDefault()
        setShowSettings(false)
        return
      }
      const shortcut = playerShortcut(event)
      if (!shortcut) return
      event.preventDefault()
      latestRunShortcut.current(shortcut)
    }
    window.addEventListener("keydown", handleKeyboard)
    return () => window.removeEventListener("keydown", handleKeyboard)
  }, [showSettings])

  usePlayerMediaSession({
    title: heading.primary,
    artist: heading.secondary,
    artwork: artwork?.poster,
    playing,
    controls: {
      play,
      pause,
      seekBy,
      next: onNextEpisode ? playNext : undefined,
    },
  })

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black p-0 sm:p-4">
      <div className="w-full max-w-7xl">
        <div className="mb-3 flex min-h-11 items-center gap-3 px-4 sm:px-0">
          <button
            className="grid size-10 shrink-0 place-items-center rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white"
            onClick={close}
            aria-label="Back to details"
          >
            <Play className="rotate-180 fill-current" size={22} />
          </button>
          <PlayerHeadingText heading={heading} />
          <div className="ml-auto flex items-center gap-1">
            {queue && (
              <button
                className="grid size-10 place-items-center rounded-full text-zinc-200 transition-colors hover:bg-white/15"
                type="button"
                aria-label="Queue"
                title="Queue"
                data-player-drawer-toggle
                onClick={() => setEpisodeDrawerOpen((open) => (open ? false : "queue"))}
              >
                <QueueIcon count={queue.controls.items.length} />
              </button>
            )}
            {onWatchParty && (
              <PartyPlayerButton onClick={onWatchParty} active={partySession != null} />
            )}
            <button
              className="grid size-10 place-items-center rounded-full bg-black/60 text-zinc-200 hover:bg-white/15"
              type="button"
              aria-label="Fullscreen"
              title="Fullscreen"
              onClick={toggleFullscreen}
            >
              <Expand size={21} />
            </button>
          </div>
        </div>
        <div
          ref={shellRef}
          className="group relative aspect-video max-h-[85vh] w-full overflow-hidden bg-black"
          onDoubleClick={toggleFullscreen}
        >
          <video
            ref={videoRef}
            className="h-full w-full"
            style={{ objectFit: videoObjectFit(videoScale) }}
            hidden={route === "engine"}
            autoPlay
            playsInline
            onClick={togglePlayback}
          />
          <canvas
            key={url}
            ref={canvasRef}
            className="h-full w-full"
            style={{ objectFit: videoObjectFit(videoScale) }}
            hidden={route !== "engine"}
            onClick={togglePlayback}
          />
          {route === "engine" && media && (
            <EngineSubtitles
              media={media}
              videoRef={videoRef}
              position={() => currentSubtitlePosition(subtitlePosition)}
            />
          )}
          {playbackError ? (
            <div className="absolute inset-0 grid place-items-center p-5">
              <div className="w-full max-w-lg rounded-xl border border-red-950 bg-zinc-950/95 p-6">
                <p className="font-medium text-red-400">Could not play this stream</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{playbackError}</p>
              </div>
            </div>
          ) : (
            waiting && (
              <div
                className="pointer-events-none absolute inset-0 grid place-items-center bg-black/65"
                role="status"
                aria-label="Video loading"
              >
                <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-black/80 px-4 py-3 shadow-xl shadow-black/40">
                  <LoaderCircle className="animate-spin text-amber-300" size={28} />
                  <PlayerHeadingText heading={heading} />
                </div>
              </div>
            )
          )}
          {!episodeDrawerOpen && partySession?.role !== "guest" && (
            <NextEpisodePrompt
              upNext={upNext}
              position={currentTime}
              duration={duration}
              paused={!playing}
              autoplay={preferences.autoplay}
              onDismiss={() => {
                nextTransitionSuppressed.current = true
              }}
              onWatchNow={() => {
                if (nextTransitionRequested.current) return
                nextTransitionRequested.current = true
                void saveProgress(duration, duration, true)
                void onNextEpisode?.()
              }}
            />
          )}
          <PlayerEpisodeDrawer
            open={episodeDrawerOpen}
            context={seriesContext}
            queue={
              queue && {
                ...queue,
                onPlay: (item) => {
                  if (nextTransitionRequested.current) return
                  nextTransitionRequested.current = true
                  queue.onPlay(item)
                },
              }
            }
            onOpenChange={setEpisodeDrawerOpen}
            onSelect={(video) => {
              if (nextTransitionRequested.current) return
              nextTransitionRequested.current = true
              void onSelectEpisode?.(video)
            }}
          />
          <QueueNotice className="absolute left-6 top-16" />
          <PlayerFlash message={flashMessage} />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pb-4 pt-16 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <input
              className="web-player-seek mb-3 block w-full cursor-pointer"
              style={
                {
                  "--player-progress": `${
                    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
                  }%`,
                  "--player-buffered": `${
                    duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0
                  }%`,
                } as React.CSSProperties
              }
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              aria-label="Seek"
              onChange={(event) => {
                if (partySession?.role === "guest") return
                const position = Number(event.target.value)
                if (mediaRef.current) mediaRef.current.currentTime = position
                if (partySession?.role === "host") partySession.publishCommand("seek", position)
              }}
            />
            <div className="flex items-center gap-3">
              <Control label={playing ? "Pause" : "Play"} onClick={togglePlayback}>
                {playing ? <Pause size={21} /> : <Play size={21} />}
              </Control>
              {onNextEpisode && (
                <Control label={nextControlLabel(upNext)} onClick={playNext}>
                  <SkipForward size={21} />
                </Control>
              )}
              <Control
                label={muted ? "Unmute" : "Mute"}
                onClick={() => {
                  if (mediaRef.current) mediaRef.current.muted = !mediaRef.current.muted
                }}
              >
                {muted || volume === 0 ? <VolumeX size={21} /> : <Volume2 size={21} />}
              </Control>
              <input
                className="hidden h-1 w-24 accent-amber-400 sm:block"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="Volume"
                onChange={(event) => {
                  if (mediaRef.current) {
                    mediaRef.current.volume = Number(event.target.value)
                    mediaRef.current.muted = false
                  }
                }}
              />
              <span className="text-xs tabular-nums text-zinc-300">
                {duration > 0
                  ? `${formatTime(currentTime)} / ${formatTime(duration)}`
                  : "--:--:-- / --:--:--"}
              </span>
              <div className="flex-1" />
              <span className="hidden max-w-40 truncate text-xs text-zinc-400 md:block">
                {selectedSubtitleLabel === "Off" ? "" : selectedSubtitleLabel}
              </span>
              <Control label="Track settings" onClick={() => setShowSettings((value) => !value)}>
                <Settings2 size={21} />
              </Control>
              {route === "native" && (
                <Control
                  label="Picture in picture"
                  onClick={() => void videoRef.current?.requestPictureInPicture?.()}
                >
                  <PictureInPicture size={21} />
                </Control>
              )}
              <VideoScaleControl
                value={videoScale}
                indicatorPlacement="above"
                onChange={setVideoScale}
              />
            </div>
          </div>

          {showSettings && (
            <div className="absolute bottom-20 right-4 max-h-[70%] w-[46rem] max-w-[calc(100%-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-zinc-700 bg-zinc-950/95 p-4 shadow-2xl">
              <div className="mb-3 flex items-center gap-2">
                <Captions size={16} />
                <h3 className="font-display text-sm font-semibold">Subtitles</h3>
              </div>
              <SubtitlePicker
                items={subtitleItems}
                preferredLanguage={preferences.subtitleLanguage}
                off={selectedSubtitle === "off"}
                loading={subtitleLoading}
                error={subtitleError}
                position={subtitlePosition}
                onPositionChange={changeSubtitlePosition}
                onOff={() => void chooseSubtitle("off")}
                onSelect={(key) => void chooseSubtitle(key)}
              />
              <TrackSection icon={<Volume2 size={16} />} title="Audio">
                {audioChoices.length ? (
                  audioChoices.map((choice) => (
                    <TrackOption
                      key={`${choice.kind}-${choice.id}`}
                      active={selectedAudio === choice.id}
                      disabled={choice.disabled}
                      label={choice.label}
                      onClick={() => chooseAudio(choice)}
                    />
                  ))
                ) : (
                  <div className="rounded-lg bg-zinc-900 px-3 py-2">
                    <p className="text-sm text-zinc-300">Automatic</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      The browser is choosing the default audio track and does not expose track
                      switching for this source. This does not mean the video has no audio.
                    </p>
                  </div>
                )}
              </TrackSection>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Control({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className="rounded-lg p-1.5 text-zinc-200 hover:bg-white/15 hover:text-white"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function PartyPlayerButton({ onClick, active }: { onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      aria-label="Watch together"
      title="Watch together"
      className={`grid size-10 place-items-center rounded-full transition-colors hover:bg-white/15 ${active ? "text-amber-300" : "text-zinc-200"}`}
      onClick={onClick}
    >
      <UsersRound size={21} />
    </button>
  )
}

function PlayerHeadingText({ heading }: { heading: PlayerHeading }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-display font-semibold">{heading.primary}</p>
      {heading.secondary && <p className="truncate text-xs text-zinc-400">{heading.secondary}</p>}
    </div>
  )
}

function TrackSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-1 flex items-center gap-2 px-2 text-sm font-medium">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function TrackOption({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`block w-full rounded-lg px-2 py-2 text-left text-sm disabled:text-zinc-600 ${
        active ? "bg-amber-400 text-zinc-950" : "text-zinc-300 enabled:hover:bg-zinc-800"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

interface NativeAudioTrack {
  label: string
  language: string
  enabled: boolean
}

function getNativeAudioTracks(video: HTMLVideoElement): NativeAudioTrack[] {
  return Array.from(
    (
      video as HTMLVideoElement & {
        audioTracks?: ArrayLike<NativeAudioTrack>
      }
    ).audioTracks ?? [],
  )
}

function toWebVtt(source: string): string {
  const normalized = source.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "")
  if (/^\s*WEBVTT\b/.test(normalized)) return normalized
  return `WEBVTT\n\n${normalized
    .replace(/^\d+\s*$/gm, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`
}

function positionWebVtt(source: string, position: number): string {
  return source.replace(
    /^(\d{2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d{2}:\d{2}(?::\d{2})?\.\d{3})(.*)$/gm,
    (_, timing: string, settings: string) =>
      `${timing}${/\bline:/.test(settings) ? settings : `${settings} line:${position}%`}`,
  )
}

function applyTextTrackPosition(track: TextTrack, position: number): void {
  for (const cue of Array.from(track.cues ?? [])) {
    if (!("line" in cue) || !("snapToLines" in cue)) continue
    const positionedCue = cue as TextTrackCue & { line: number | "auto"; snapToLines: boolean }
    positionedCue.snapToLines = false
    positionedCue.line = position
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

/**
 * Opens a source for the WebCodecs engine. Resolves undefined when the host
 * blocks cross-origin reads or does not answer in time, so `<video>` plays it.
 */
async function probeSource(url: string): Promise<WebSource | undefined> {
  const { openWebSource } = await import("../lib/web-engine/engine")
  const opening = openWebSource(url)
  const timeout = new Promise<undefined>((resolve) => window.setTimeout(resolve, PROBE_TIMEOUT_MS))
  const source = await Promise.race([opening.catch(() => undefined), timeout])
  if (!source)
    void opening.then(
      (late) => late.input.dispose(),
      () => undefined,
    )
  return source
}

/**
 * Draws the showing text track's cues over the engine's canvas. The browser
 * only renders cues on a `<video>` that is playing, and the engine bypasses it.
 */
function EngineSubtitles({
  media,
  videoRef,
  position,
}: {
  media: PlaybackMedia
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** The cue line in percent from the top, adjusted for the current video scale. */
  position: () => number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const linePosition = useEffectEvent(position)
  useEffect(() => {
    let shown: TextTrackCue[] = []
    const timer = window.setInterval(() => {
      const element = ref.current
      const video = videoRef.current
      if (!element || !video) return
      const line = linePosition()
      // Anchors the box by the same fraction it sits at, so it never leaves the frame.
      element.style.top = `${line}%`
      element.style.transform = `translateY(-${line}%)`
      const track = Array.from(video.textTracks).find((candidate) => candidate.mode === "showing")
      const time = media.currentTime
      const active = Array.from(track?.cues ?? []).filter(
        (cue) => cue.startTime <= time && cue.endTime > time,
      )
      if (active.length === shown.length && active.every((cue, index) => cue === shown[index]))
        return
      shown = active
      element.replaceChildren(
        ...active.map((cue) => {
          const row = document.createElement("div")
          if (cue instanceof VTTCue) row.append(cue.getCueAsHTML())
          return row
        }),
      )
    }, 100)
    return () => window.clearInterval(timer)
  }, [media, videoRef])
  return (
    <div
      ref={ref}
      className="engine-subtitles pointer-events-none absolute inset-x-0 px-[5%] text-center leading-snug text-white"
    />
  )
}

function isHls(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".m3u8")
  } catch {
    return false
  }
}
