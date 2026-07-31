import { useCallback, useEffect, useRef, useState } from "react"
import {
  Captions,
  Expand,
  LoaderCircle,
  Pause,
  PictureInPicture,
  Play,
  Settings2,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react"
import type Hls from "hls.js"
import type { InstalledAddon, ProgressMetadata } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import { loadSubtitles, type Subtitle, type Video } from "../lib/core"
import { isDesktop } from "../lib/desktop"
import { readPreferences, writePreferences } from "../lib/preferences"
import { playerHeading, type PlayerHeading } from "../lib/player-title"
import { videoObjectFit, type VideoScale } from "../lib/video-scale"
import { usePlaybackProgress } from "../lib/progress"
import { DesktopPlayer } from "./desktop-player"
import {
  NextEpisodePrompt,
  PlayerEpisodeDrawer,
  type PlayerSeriesContext,
} from "./player-series"
import { VideoScaleControl } from "./video-scale-control"
import { SubtitlePicker } from "./subtitle-picker"

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
  kind: "hls" | "native"
}

export function Player({
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
  if (isDesktop()) {
    return (
      <DesktopPlayer
        url={url}
        type={type}
        videoId={videoId}
        profileId={profileId}
        progressMetadata={progressMetadata}
        addons={addons}
        seriesContext={seriesContext}
        nextEpisode={nextEpisode}
        nextEpisodeLabel={nextEpisodeLabel}
        onSelectEpisode={onSelectEpisode}
        onNextEpisode={onNextEpisode}
        onEnded={onEnded}
        onClose={onClose}
      />
    )
  }
  return (
    <WebPlayer
      url={url}
      type={type}
      videoId={videoId}
      profileId={profileId}
      progressMetadata={progressMetadata}
      addons={addons}
      seriesContext={seriesContext}
      nextEpisode={nextEpisode}
      nextEpisodeLabel={nextEpisodeLabel}
      onSelectEpisode={onSelectEpisode}
      onNextEpisode={onNextEpisode}
      onEnded={onEnded}
      onClose={onClose}
    />
  )
}

function WebPlayer({
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
  const heading = playerHeading(progressMetadata)
  const shellRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const subtitleObjectUrl = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(preferences.volume / 100)
  const [muted, setMuted] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [subtitles, setSubtitles] = useState<PlayerSubtitle[]>([])
  const [selectedSubtitle, setSelectedSubtitle] = useState("off")
  const [subtitleError, setSubtitleError] = useState<string>()
  const [subtitleLoading, setSubtitleLoading] = useState(true)
  const [subtitlePosition, setSubtitlePosition] = useState(preferences.subtitlePosition)
  const [audioChoices, setAudioChoices] = useState<AudioChoice[]>([])
  const [selectedAudio, setSelectedAudio] = useState<number>()
  const [videoScale, setVideoScale] = useState<VideoScale>("fit")
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState(false)
  const nextTransitionSuppressed = useRef(false)
  const nextTransitionRequested = useRef(false)
  const { progress, save: saveProgress } = usePlaybackProgress(
    profileId,
    videoId,
    progressMetadata,
  )
  const resumed = useRef(false)

  useEffect(() => {
    const video = videoRef.current
    if (resumed.current || !video || !duration || !progress.isSuccess) return
    resumed.current = true
    if (!progress.data || progress.data.watched) return
    const saved = progress.data.positionMs / 1000
    if (saved > 0 && saved < duration - 5) {
      video.currentTime = saved
      setCurrentTime(saved)
    }
  }, [duration, progress.data, progress.isSuccess])

  const refreshNativeTracks = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const embedded = Array.from(video.textTracks).map((track, index) => ({
      id: `embedded-${index}`,
      key: `embedded-${index}`,
      url: "",
      lang: track.language,
      display: track.label || languageName(track.language) || `Embedded ${index + 1}`,
      embedded: true,
    }))
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
    let cancelled = false
    setSubtitleLoading(true)
    setSubtitleError(undefined)
    const candidates = addonsForResource(addons, "subtitles", type, videoId)
    void Promise.allSettled(
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
      setSubtitleLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [addons, type, videoId])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = preferences.volume / 100
    video.autoplay = preferences.autoplay
    let cancelled = false
    let hls: Hls | undefined
    setWaiting(true)

    if (isHls(url)) {
      void import("hls.js").then(({ default: HlsPlayer }) => {
        if (cancelled) return
        if (HlsPlayer.isSupported()) {
          hls = new HlsPlayer()
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
          hls.loadSource(url)
          hls.attachMedia(video)
        } else {
          video.src = url
        }
      })
    } else {
      video.src = url
    }

    return () => {
      cancelled = true
      hls?.destroy()
      hlsRef.current = null
      video.removeAttribute("src")
      video.load()
    }
  }, [preferences.autoplay, preferences.volume, url])

  useEffect(() => {
    return () => {
      if (subtitleObjectUrl.current) URL.revokeObjectURL(subtitleObjectUrl.current)
    }
  }, [])

  const chooseSubtitle = async (key: string, cuePosition = subtitlePosition) => {
    const video = videoRef.current
    if (!video) return
    setSelectedSubtitle(key)
    setSubtitleError(undefined)
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
        applyTextTrackPosition(textTrack, cuePosition)
      }
      return
    }
    try {
      const response = await fetch(subtitle.url)
      if (!response.ok) throw new Error(`Subtitle request returned HTTP ${response.status}`)
      const body = await response.text()
      const vtt = positionWebVtt(toWebVtt(body), cuePosition)
      const objectUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }))
      subtitleObjectUrl.current = objectUrl
      const track = document.createElement("track")
      track.kind = "subtitles"
      track.label = subtitle.display
      track.srclang = subtitle.lang ?? subtitle.language ?? "und"
      track.src = objectUrl
      track.default = true
      video.append(track)
      track.addEventListener("load", () => {
        track.track.mode = "showing"
      })
    } catch (error) {
      setSelectedSubtitle("off")
      setSubtitleError(
        error instanceof Error
          ? `${error.message}. The subtitle host may not allow browser access.`
          : "Could not load subtitles.",
      )
    }
  }

  const chooseAudio = (choice: AudioChoice) => {
    const video = videoRef.current
    if (!video) return
    if (choice.kind === "hls" && hlsRef.current) {
      hlsRef.current.audioTrack = choice.id
    } else {
      getNativeAudioTracks(video).forEach((track, index) => {
        track.enabled = index === choice.id
      })
    }
    setSelectedAudio(choice.id)
  }

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
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
    active: selectedSubtitle === subtitle.key,
  }))

  const changeSubtitlePosition = (value: number) => {
    setSubtitlePosition(value)
    writePreferences({ ...readPreferences(), subtitlePosition: value })
    if (selectedSubtitle !== "off") void chooseSubtitle(selectedSubtitle, value)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black p-0 sm:p-4">
      <div className="w-full max-w-7xl">
        <div className="mb-3 flex min-h-11 items-center gap-3 px-4 sm:px-0">
          <button
            className="grid size-10 shrink-0 place-items-center rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white"
            onClick={onClose}
            aria-label="Back to details"
          >
            <Play className="rotate-180 fill-current" size={22} />
          </button>
          <PlayerHeadingText heading={heading} />
          <div className="ml-auto">
            <VideoScaleControl value={videoScale} onChange={setVideoScale} />
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
            autoPlay
            playsInline
            onClick={togglePlayback}
            onPlay={() => setPlaying(true)}
            onPause={(event) => {
              setPlaying(false)
              if (resumed.current) {
                void saveProgress(
                  event.currentTarget.currentTime,
                  event.currentTarget.duration,
                  true,
                )
              }
            }}
            onPlaying={() => setWaiting(false)}
            onWaiting={() => setWaiting(true)}
            onTimeUpdate={(event) => {
              setCurrentTime(event.currentTarget.currentTime)
              if (resumed.current) {
                void saveProgress(event.currentTarget.currentTime, event.currentTarget.duration)
              }
            }}
            onEnded={(event) => {
              setPlaying(false)
              if (!nextTransitionRequested.current) {
                nextTransitionRequested.current = true
                void Promise.resolve(
                  onEnded?.(!nextTransitionSuppressed.current),
                ).catch(() => undefined)
              }
              void saveProgress(
                event.currentTarget.duration,
                event.currentTarget.duration,
                true,
              )
                .catch(() => undefined)
            }}
            onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
            onLoadedMetadata={() => {
              refreshNativeTracks()
            }}
            onVolumeChange={(event) => {
              setVolume(event.currentTarget.volume)
              setMuted(event.currentTarget.muted)
            }}
          />
          {waiting && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <LoaderCircle className="animate-spin text-white" size={42} />
            </div>
          )}
          {!episodeDrawerOpen && (
            <NextEpisodePrompt
              seriesName={seriesContext?.name ?? progressMetadata.name}
              episode={nextEpisode}
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
            onOpenChange={setEpisodeDrawerOpen}
            onSelect={(video) => {
              if (nextTransitionRequested.current) return
              nextTransitionRequested.current = true
              void onSelectEpisode?.(video)
            }}
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pb-4 pt-16 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <input
              className="mb-3 h-1 w-full cursor-pointer accent-amber-400"
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              aria-label="Seek"
              onChange={(event) => {
                if (videoRef.current) videoRef.current.currentTime = Number(event.target.value)
              }}
            />
            <div className="flex items-center gap-3">
              <Control label={playing ? "Pause" : "Play"} onClick={togglePlayback}>
                {playing ? <Pause size={21} /> : <Play size={21} />}
              </Control>
              {onNextEpisode && (
                <Control
                  label={`Next episode${nextEpisodeLabel ? `: ${nextEpisodeLabel}` : ""}`}
                  onClick={() => {
                    if (nextTransitionRequested.current) return
                    nextTransitionRequested.current = true
                    void onNextEpisode()
                  }}
                >
                  <SkipForward size={21} />
                </Control>
              )}
              <Control
                label={muted ? "Unmute" : "Mute"}
                onClick={() => {
                  if (videoRef.current) videoRef.current.muted = !videoRef.current.muted
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
                  if (videoRef.current) {
                    videoRef.current.volume = Number(event.target.value)
                    videoRef.current.muted = false
                  }
                }}
              />
              <span className="text-xs tabular-nums text-zinc-300">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <div className="flex-1" />
              <span className="hidden max-w-40 truncate text-xs text-zinc-400 md:block">
                {selectedSubtitleLabel === "Off" ? "" : selectedSubtitleLabel}
              </span>
              <Control label="Track settings" onClick={() => setShowSettings((value) => !value)}>
                <Settings2 size={21} />
              </Control>
              <Control
                label="Picture in picture"
                onClick={() => void videoRef.current?.requestPictureInPicture?.()}
              >
                <PictureInPicture size={21} />
              </Control>
              <Control label="Fullscreen" onClick={toggleFullscreen}>
                <Expand size={21} />
              </Control>
            </div>
          </div>

          {showSettings && (
            <div className="absolute bottom-16 right-4 max-h-[70%] w-[46rem] max-w-[calc(100%-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-zinc-700 bg-zinc-950/95 p-4 shadow-2xl">
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

function PlayerHeadingText({ heading }: { heading: PlayerHeading }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-display font-semibold">{heading.primary}</p>
      {heading.secondary && (
        <p className="truncate text-xs text-zinc-400">{heading.secondary}</p>
      )}
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
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`block w-full rounded-lg px-2 py-2 text-left text-sm ${
        active ? "bg-amber-400 text-zinc-950" : "text-zinc-300 hover:bg-zinc-800"
      }`}
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

function isHls(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".m3u8")
  } catch {
    return false
  }
}
