import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  Captions,
  ChevronLeft,
  Minus,
  Languages,
  Maximize,
  Minimize,
  Pause,
  Play,
  Plus,
  Scaling,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import { audioTrackDisplay } from "../lib/audio-track-display"
import type { PlayerArtwork } from "../lib/api"
import type { Video } from "../lib/core"
import {
  nativePlayerCommand,
  nativePlayerSnapshot,
  setNativePlayerPlaying,
  toggleNativeFullscreen,
  type PlayerOverlayMedia,
  type NativePlayerSnapshot,
  type NativeTrack,
} from "../lib/desktop"
import { isDesktopBuffering, isDesktopInitialLoading } from "../lib/desktop-player-state"
import {
  VIDEO_SCALE_OPTIONS,
  mpvVideoScaleCommands,
  nextVideoScale,
  type VideoScale,
} from "../lib/video-scale"
import {
  groupSubtitles,
  normalizeSubtitleLanguage,
  subtitleLanguageName,
  type SubtitleLanguageGroup,
} from "../lib/subtitle-groups"
import { readPreferences, writePreferences } from "../lib/preferences"
import {
  DesktopPlayerBufferingOverlay,
  DesktopPlayerOpeningOverlay,
} from "./desktop-player-overlays"
import { PlayerEpisodeDrawer } from "./player-series"

type TrackMenuName = "audio" | "subtitles"

export function ElectronPlayerOverlay({ initialMedia }: { initialMedia: PlayerOverlayMedia }) {
  const [title, setTitle] = useState(initialMedia.title)
  const [artwork, setArtwork] = useState<PlayerArtwork>(initialMedia)
  const [series, setSeries] = useState(initialMedia.series)
  const [snapshot, setSnapshot] = useState<NativePlayerSnapshot>()
  const [fullscreen, setFullscreen] = useState(false)
  const [scale, setScale] = useState<VideoScale>("fit")
  const [controlsVisible, setControlsVisible] = useState(true)
  const [showRemainingTime, setShowRemainingTime] = useState(false)
  const [holdSpeedActive, setHoldSpeedActive] = useState(false)
  const [activeTrackMenu, setActiveTrackMenu] = useState<TrackMenuName>()
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState(false)
  const [selectedSubtitleCode, setSelectedSubtitleCode] = useState<string>()
  const [subtitlePosition, setSubtitlePosition] = useState(() => readPreferences().subtitlePosition)
  const hideTimer = useRef<number | undefined>(undefined)
  const holdSpeedTimer = useRef<number | undefined>(undefined)
  const holdSpeedActiveRef = useRef(false)
  const holdSpeedTriggered = useRef(false)
  const preferredSubtitleApplied = useRef(false)
  const seekDraft = useRef<number | undefined>(undefined)
  const seekCommitTimer = useRef<number | undefined>(undefined)
  const audioAnchorRef = useRef<HTMLDivElement>(null)
  const subtitleAnchorRef = useRef<HTMLDivElement>(null)

  const showControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    if (!snapshot?.firstFrameReady) return
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2800)
  }, [snapshot?.firstFrameReady])

  useEffect(() => {
    document.documentElement.classList.add("electron-player-overlay")
    return () => {
      document.documentElement.classList.remove("electron-player-overlay")
      window.clearTimeout(hideTimer.current)
    }
  }, [])

  const updateInteractiveRegions = useCallback(() => {
    const electron = window.__CONDUIT_ELECTRON__
    if (!electron || window.innerWidth <= 0 || window.innerHeight <= 0) return
    const regions = [...document.querySelectorAll<HTMLElement>("[data-overlay-interactive]")]
      .map((element) => {
        let ancestor: HTMLElement | null = element
        while (ancestor && ancestor !== document.body) {
          const style = window.getComputedStyle(ancestor)
          if (style.visibility === "hidden" || Number.parseFloat(style.opacity) <= 0.01) {
            return undefined
          }
          ancestor = ancestor.parentElement
        }
        const bounds = element.getBoundingClientRect()
        return {
          left: Math.max(0, bounds.left / window.innerWidth),
          top: Math.max(0, bounds.top / window.innerHeight),
          right: Math.min(1, bounds.right / window.innerWidth),
          bottom: Math.min(1, bounds.bottom / window.innerHeight),
        }
      })
      .filter(
        (region): region is NonNullable<typeof region> =>
          region !== undefined && region.right > region.left && region.bottom > region.top,
      )
    electron.setPlayerOverlayInteractiveRegions(regions)
  }, [])

  useLayoutEffect(() => {
    let frame = 0
    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateInteractiveRegions)
    }
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule)
    resizeObserver?.observe(document.documentElement)
    const mutationObserver =
      typeof MutationObserver === "undefined" ? undefined : new MutationObserver(schedule)
    mutationObserver?.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    })
    window.addEventListener("resize", schedule)
    schedule()
    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener("resize", schedule)
    }
  }, [activeTrackMenu, controlsVisible, episodeDrawerOpen, selectedSubtitleCode, updateInteractiveRegions])

  useEffect(() => {
    const electron = window.__CONDUIT_ELECTRON__
    if (!electron) return
    const unsubscribeFullscreen = electron.onFullscreenChange(setFullscreen)
    const unsubscribeMedia = electron.onPlayerOverlayMedia((media) => {
      setTitle(media.title)
      setArtwork(media)
      setSeries(media.series)
      setShowRemainingTime(false)
      window.clearTimeout(seekCommitTimer.current)
      seekDraft.current = undefined
    })
    const unsubscribeWake = electron.onPlayerOverlayWake
      ? electron.onPlayerOverlayWake(showControls)
      : undefined
    electron.notifyPlayerOverlayReady?.()
    return () => {
      unsubscribeFullscreen()
      unsubscribeMedia()
      unsubscribeWake?.()
    }
  }, [showControls])

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      void nativePlayerSnapshot()
        .then((next) => {
          if (!cancelled) setSnapshot(next)
        })
        .catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, 250)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (snapshot?.firstFrameReady) {
      showControls()
      return
    }
    window.clearTimeout(hideTimer.current)
    setControlsVisible(true)
  }, [showControls, snapshot?.firstFrameReady])

  useEffect(() => {
    const playing = Boolean(
      snapshot?.running && snapshot.firstFrameReady && !snapshot.paused && !snapshot.ended,
    )
    void setNativePlayerPlaying(playing).catch(() => undefined)
  }, [snapshot?.ended, snapshot?.firstFrameReady, snapshot?.paused, snapshot?.running])

  const command = useCallback((next: unknown[]) => {
    void nativePlayerCommand(next).catch(() => undefined)
  }, [])

  const commitSeek = useCallback(() => {
    window.clearTimeout(seekCommitTimer.current)
    seekCommitTimer.current = undefined
    const position = seekDraft.current
    seekDraft.current = undefined
    if (position === undefined) return
    command(["seek", position, "absolute+exact"])
  }, [command])

  const previewSeek = useCallback(
    (position: number) => {
      seekDraft.current = position
      setSnapshot((current) => (current ? { ...current, position } : current))
      window.clearTimeout(seekCommitTimer.current)
      seekCommitTimer.current = window.setTimeout(commitSeek, 180)
    },
    [commitSeek],
  )

  useEffect(
    () => () => {
      window.clearTimeout(seekCommitTimer.current)
    },
    [],
  )

  const endHoldSpeed = useCallback(() => {
    window.clearTimeout(holdSpeedTimer.current)
    holdSpeedTimer.current = undefined
    if (!holdSpeedActiveRef.current) return
    holdSpeedActiveRef.current = false
    setHoldSpeedActive(false)
    command(["set", "speed", 1])
  }, [command])

  const beginHoldSpeed = useCallback(
    (event: ReactPointerEvent) => {
      if (
        !snapshot ||
        snapshot.loading ||
        snapshot.duration <= 0 ||
        (event.pointerType === "mouse" && event.button !== 0) ||
        (event.target instanceof Element && event.target.closest("[data-overlay-interactive]"))
      )
        return
      window.clearTimeout(holdSpeedTimer.current)
      holdSpeedTriggered.current = false
      holdSpeedTimer.current = window.setTimeout(() => {
        holdSpeedTriggered.current = true
        holdSpeedActiveRef.current = true
        setHoldSpeedActive(true)
        command(["set", "speed", 2])
      }, 450)
    },
    [command, snapshot],
  )

  useEffect(
    () => () => {
      window.clearTimeout(holdSpeedTimer.current)
      if (holdSpeedActiveRef.current) {
        holdSpeedActiveRef.current = false
        command(["set", "speed", 1])
      }
    },
    [command],
  )

  const togglePlayback = useCallback(() => {
    const paused = snapshot?.paused ?? false
    command(["set", "pause", paused ? "no" : "yes"])
    setSnapshot((current) => (current ? { ...current, paused: !paused } : current))
  }, [command, snapshot?.paused])

  const toggleFullscreen = useCallback(() => {
    void toggleNativeFullscreen()
      .then(setFullscreen)
      .catch(() => undefined)
  }, [])

  const changeScale = useCallback(() => {
    const next = nextVideoScale(scale)
    setScale(next)
    for (const nextCommand of mpvVideoScaleCommands(next, {
      width: window.innerWidth,
      height: window.innerHeight,
    })) {
      command(nextCommand)
    }
  }, [command, scale])

  const close = useCallback(() => {
    void window.__CONDUIT_ELECTRON__?.invoke("player_overlay_close")
  }, [])

  const nextEpisode = useCallback(() => {
    void window.__CONDUIT_ELECTRON__?.invoke("player_overlay_next")
  }, [])

  const selectEpisode = useCallback((video: Video) => {
    setEpisodeDrawerOpen(false)
    void window.__CONDUIT_ELECTRON__?.invoke("player_overlay_episode", {
      videoId: video.id,
    })
  }, [])

  const episodeWatchAction = useCallback(async (targets: Video[], watched: boolean) => {
    const electron = window.__CONDUIT_ELECTRON__
    if (!electron) throw new Error("Desktop bridge is unavailable.")
    await electron.invoke("player_overlay_watch_action", {
      videoIds: targets.map((video) => video.id),
      watched,
    })
  }, [])

  const audioTracks = snapshot?.tracks.filter((track) => track.type === "audio") ?? []
  const subtitleTracks = snapshot?.tracks.filter((track) => track.type === "sub") ?? []
  const subtitleGroups = groupSubtitles(subtitleTracks, (track) => track.lang || track.title)
  const activeSubtitleGroup = subtitleGroups.find((group) =>
    group.tracks.some((track) => track.selected),
  )
  const selectedSubtitleGroup = subtitleGroups.find((group) => group.code === selectedSubtitleCode)

  useEffect(() => {
    if (preferredSubtitleApplied.current || !subtitleTracks.length) return
    const preferredCode = normalizeSubtitleLanguage(readPreferences().subtitleLanguage)
    const preferredGroup = subtitleGroups.find((group) => group.code === preferredCode)
    const embeddedTrack = preferredGroup?.tracks.find((track) => !track.external)
    if (!embeddedTrack) return
    preferredSubtitleApplied.current = true
    if (!embeddedTrack.selected) selectSubtitleTrack(embeddedTrack, command, setSnapshot)
  }, [command, subtitleGroups, subtitleTracks.length])

  const selectedScale = VIDEO_SCALE_OPTIONS.find((option) => option.value === scale)?.label ?? scale
  const loadingOverlayVisible = isDesktopInitialLoading(snapshot)
  const bufferingOverlayVisible = isDesktopBuffering(snapshot)
  const chromeVisible =
    controlsVisible ||
    episodeDrawerOpen ||
    Boolean(snapshot?.paused) ||
    !snapshot
  const rootClassName =
    "native-player electron-native-player electron-player-overlay fixed inset-0 z-50 select-none " +
    (chromeVisible ? "cursor-default" : "cursor-none")

  useEffect(() => {
    document.documentElement.classList.toggle("player-cursor-hidden", !chromeVisible)
    return () => document.documentElement.classList.remove("player-cursor-hidden")
  }, [chromeVisible])

  // Close track menus on any background click or Escape, matching Tauri behavior
  useEffect(() => {
    if (!activeTrackMenu) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTrackMenu(undefined)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [activeTrackMenu])

  useEffect(() => {
    if (!activeTrackMenu) return
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        (target.closest("[data-track-menu]") || target.closest("[data-track-menu-trigger]"))
      ) {
        return
      }
      const suppressClick = (click: MouseEvent) => {
        click.preventDefault()
        click.stopImmediatePropagation()
      }
      document.addEventListener("click", suppressClick, { capture: true, once: true })
      window.setTimeout(() => document.removeEventListener("click", suppressClick, true), 0)
      setActiveTrackMenu(undefined)
    }
    document.addEventListener("pointerdown", dismissOutside, true)
    return () => document.removeEventListener("pointerdown", dismissOutside, true)
  }, [activeTrackMenu])

  return (
    <div
      className={rootClassName}
      onMouseMove={showControls}
      onPointerDown={beginHoldSpeed}
      onPointerUp={endHoldSpeed}
      onPointerCancel={endHoldSpeed}
      onPointerLeave={endHoldSpeed}
      onClick={(event) => {
        if (holdSpeedTriggered.current) {
          holdSpeedTriggered.current = false
          event.preventDefault()
          return
        }
        if (event.target === event.currentTarget) togglePlayback()
      }}
    >
      {loadingOverlayVisible && <DesktopPlayerOpeningOverlay artwork={artwork} title={title} />}
      {!loadingOverlayVisible && bufferingOverlayVisible && <DesktopPlayerBufferingOverlay />}
      {/* Edge scrims keep the chrome legible without darkening the subtitle plane. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-black/85 via-black/55 to-transparent transition-opacity duration-300 ${chromeVisible ? "opacity-100" : "opacity-0"}`}
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
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black via-black/70 to-transparent transition-opacity duration-300 ${chromeVisible ? "opacity-100" : "opacity-0"}`}
        aria-hidden="true"
      />
      <div
        className={
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 " +
          "px-5 pb-12 pt-4 transition-opacity " +
          (chromeVisible ? "opacity-100" : "opacity-0")
        }
      >
        <div className="flex min-w-0 items-center gap-3">
          <OverlayButton label="Back to details" onClick={close}>
            <Play className="rotate-180 fill-current" size={21} />
          </OverlayButton>
          <div className="min-w-0 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            <h2 className="truncate font-display text-lg font-semibold text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.9)]">
              {title}
            </h2>
            {snapshot && (
              <p className="truncate text-xs text-zinc-300">
                {nativePlaybackDescription(snapshot)}
              </p>
            )}
          </div>
        </div>
        <OverlayButton
          label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </OverlayButton>
      </div>

      <PlayerEpisodeDrawer
        open={episodeDrawerOpen}
        handleVisible={chromeVisible}
        context={series ? {
          name: series.name,
          show: series.show,
          onWatchAction: episodeWatchAction,
          videos: series.videos,
          progress: series.progress,
          currentVideoId: series.currentVideoId,
        } : undefined}
        onOpenChange={setEpisodeDrawerOpen}
        onSelect={selectEpisode}
      />

      <div
        className={
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 px-5 pb-5 pt-24 transition-opacity " +
          (chromeVisible ? "opacity-100" : "opacity-0")
        }
      >
        <div className="w-full">
          <div className="flex items-center gap-4 text-base tabular-nums text-zinc-200">
            <span className="min-w-16 text-right text-lg">
              {formatTime(snapshot?.position ?? 0)}
            </span>
            <input
              className="player-seek pointer-events-auto block h-2 min-w-0 flex-1 cursor-pointer"
              data-overlay-interactive
              style={seekSliderStyle(snapshot?.position ?? 0, snapshot?.duration ?? 0)}
              type="range"
              min={0}
              max={snapshot?.duration || 0}
              step={0.1}
              value={Math.min(snapshot?.position ?? 0, snapshot?.duration || 0)}
              aria-label="Seek"
              onChange={(event) => previewSeek(Number(event.target.value))}
              onPointerUp={commitSeek}
              onPointerCancel={commitSeek}
              onKeyUp={commitSeek}
              onBlur={commitSeek}
            />
            <button
              className="min-w-16 cursor-pointer border-0 bg-transparent p-0 text-left text-lg text-zinc-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              type="button"
              aria-label={
                showRemainingTime
                  ? "Time remaining. Click to show end time."
                  : "End time. Click to show time remaining."
              }
              title={
                showRemainingTime ? "Click to show end time" : "Click to show time remaining"
              }
              onClick={() => {
                setShowRemainingTime((current) => !current)
                showControls()
              }}
            >
              {showRemainingTime
                ? `-${formatTime(
                    Math.max(0, (snapshot?.duration ?? 0) - (snapshot?.position ?? 0)),
                  )}`
                : formatTime(snapshot?.duration ?? 0)}
            </button>
          </div>

          <div className="pointer-events-auto relative mt-3 flex items-center gap-3">
            <OverlayButton
              large
              label={snapshot?.paused ? "Play" : "Pause"}
              onClick={togglePlayback}
            >
              {snapshot?.paused ? <Play size={28} /> : <Pause size={28} />}
            </OverlayButton>
            <OverlayButton large label="Next episode" onClick={nextEpisode}>
              <SkipForward size={27} />
            </OverlayButton>
            <OverlayButton
              large
              label={snapshot?.volume === 0 ? "Unmute" : "Mute"}
              onClick={() => command(["set", "volume", snapshot?.volume === 0 ? 100 : 0])}
            >
              {snapshot?.volume === 0 ? <VolumeX size={27} /> : <Volume2 size={27} />}
            </OverlayButton>
            <input
              className="player-volume hidden h-5 w-32 sm:block"
              data-overlay-interactive
              style={sliderStyle(snapshot?.volume ?? 100)}
              type="range"
              min={0}
              max={100}
              value={snapshot?.volume ?? 100}
              aria-label="Volume"
              onChange={(event) => command(["set", "volume", Number(event.target.value)])}
            />
            <div className="flex-1" />
            <div ref={audioAnchorRef} data-track-menu-trigger>
              <TrackSelect
                large
                ariaLabel="Audio track"
                icon={<Languages size={27} />}
                tracks={audioTracks}
                empty="Audio"
                active={activeTrackMenu === "audio"}
                onClick={() =>
                  setActiveTrackMenu((current) => (current === "audio" ? undefined : "audio"))
                }
              />
            </div>
            <div ref={subtitleAnchorRef} data-track-menu-trigger>
              <TrackSelect
                large
                ariaLabel="Subtitle track"
                icon={<Captions size={27} />}
                tracks={subtitleTracks}
                empty="Subtitles"
                allowOff
                active={activeTrackMenu === "subtitles"}
                onClick={() => {
                  setSelectedSubtitleCode(
                    selectedSubtitleCode ?? activeSubtitleGroup?.code ?? subtitleGroups[0]?.code,
                  )
                  setActiveTrackMenu((current) =>
                    current === "subtitles" ? undefined : "subtitles",
                  )
                }}
              />
            </div>
            <OverlayButton
              large
              label={"Video scale: " + selectedScale}
              onClick={changeScale}
            >
              <Scaling size={27} />
            </OverlayButton>
          </div>
          {activeTrackMenu === "audio" && (
            <AudioTrackMenu
              anchor={audioAnchorRef}
              tracks={audioTracks}
              onSelect={(id) => {
                command(["set", "aid", id])
                setActiveTrackMenu(undefined)
              }}
              onClose={() => setActiveTrackMenu(undefined)}
            />
          )}
          {activeTrackMenu === "subtitles" && (
            <SubtitleTrackMenu
              anchor={subtitleAnchorRef}
              groups={subtitleGroups}
              selectedCode={selectedSubtitleCode}
              selectedGroup={selectedSubtitleGroup}
              subtitlePosition={subtitlePosition}
              onSelectLanguage={(code) => {
                setSelectedSubtitleCode(code)
                const group = subtitleGroups.find((candidate) => candidate.code === code)
                const track = group && defaultSubtitleTrack(group)
                if (track) selectSubtitleTrack(track, command, setSnapshot)
              }}
              onSelectTrack={(track) => selectSubtitleTrack(track, command, setSnapshot)}
              onOff={() => {
                setSelectedSubtitleCode(undefined)
                command(["set", "sid", "no"])
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
              }}
              onSubtitlePosition={(value) => {
                setSubtitlePosition(value)
                writePreferences({ ...readPreferences(), subtitlePosition: value })
                command(["set", "sub-pos", value])
              }}
              onClose={() => setActiveTrackMenu(undefined)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function defaultSubtitleTrack(
  group: SubtitleLanguageGroup<NativeTrack>,
): NativeTrack | undefined {
  return group.tracks.find((track) => !track.external) ?? group.tracks[0]
}

function OverlayButton({
  label,
  children,
  onClick,
  active = false,
  large = false,
}: {
  label: string
  children: ReactNode
  onClick: () => void
  active?: boolean
  large?: boolean
}) {
  return (
    <button
      type="button"
      className={`pointer-events-auto grid shrink-0 place-items-center rounded-lg bg-black/40 text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.6)] drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] backdrop-blur-sm hover:bg-white/15 hover:text-white ${large ? "size-[50px]" : "size-10"} ${
        active ? "bg-white/15 text-amber-300" : ""
      }`}
      data-overlay-interactive
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function TrackSelect({
  ariaLabel,
  icon,
  tracks,
  empty,
  allowOff = false,
  active,
  onClick,
  large = false,
}: {
  ariaLabel: string
  icon: ReactNode
  tracks: NativeTrack[]
  empty: string
  allowOff?: boolean
  active: boolean
  onClick: () => void
  large?: boolean
}) {
  if (!tracks.length && !allowOff) {
    return (
      <OverlayButton large={large} label={empty} onClick={onClick} active={active}>
        {icon}
      </OverlayButton>
    )
  }
  return (
    <OverlayButton large={large} label={ariaLabel} onClick={onClick} active={active}>
      {icon}
    </OverlayButton>
  )
}

function AudioTrackMenu({
  anchor,
  tracks,
  onSelect,
  onClose,
}: {
  anchor: React.RefObject<HTMLElement | null>
  tracks: NativeTrack[]
  onSelect: (id: number) => void
  onClose: () => void
}) {
  const [position, setPosition] = useState({ bottom: 80, right: 24, maxHeight: 400 })
  useLayoutEffect(() => {
    const updatePosition = () => {
      const bounds = anchor.current?.getBoundingClientRect()
      if (!bounds) return
      setPosition({
        bottom: Math.max(16, window.innerHeight - bounds.top + 32),
        right: Math.max(12, window.innerWidth - bounds.right),
        maxHeight: Math.max(160, Math.min(window.innerHeight * 0.7, bounds.top - 24)),
      })
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [anchor])
  return (
    <div
      className="pointer-events-auto fixed z-20 w-[46rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 p-2 shadow-2xl"
      data-overlay-interactive
      data-track-menu
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      role="menu"
    >
      <TrackMenuHeader title="Audio" onClose={onClose} />
      {tracks.length ? (
        tracks.map((track) => (
          <TrackMenuRow
            key={track.id}
            track={track}
            fallback="Audio"
            audio
            onClick={() => onSelect(track.id)}
          />
        ))
      ) : (
        <p className="px-3 py-2 text-sm text-zinc-500">No selectable audio tracks.</p>
      )}
    </div>
  )
}

function SubtitleTrackMenu({
  anchor,
  groups,
  selectedCode,
  selectedGroup,
  subtitlePosition,
  onSelectLanguage,
  onSelectTrack,
  onOff,
  onSubtitlePosition,
  onClose,
}: {
  anchor: React.RefObject<HTMLElement | null>
  groups: SubtitleLanguageGroup<NativeTrack>[]
  selectedCode?: string
  selectedGroup?: SubtitleLanguageGroup<NativeTrack>
  subtitlePosition: number
  onSelectLanguage: (code: string) => void
  onSelectTrack: (track: NativeTrack) => void
  onOff: () => void
  onSubtitlePosition: (value: number) => void
  onClose: () => void
}) {
  const active = groups.some((group) => group.tracks.some((track) => track.selected))
  const adjustPosition = (amount: number) =>
    onSubtitlePosition(Math.max(10, Math.min(100, subtitlePosition + amount)))
  const [position, setPosition] = useState({ bottom: 80, right: 24, maxHeight: 400 })
  useLayoutEffect(() => {
    const updatePosition = () => {
      const bounds = anchor.current?.getBoundingClientRect()
      if (!bounds) return
      setPosition({
        bottom: Math.max(16, window.innerHeight - bounds.top + 32),
        right: Math.max(12, window.innerWidth - bounds.right),
        maxHeight: Math.max(160, Math.min(window.innerHeight * 0.7, bounds.top - 24)),
      })
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [anchor])

  return (
    <div
      className="pointer-events-auto fixed z-20 w-[min(46rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 p-2 shadow-2xl"
      data-overlay-interactive
      data-track-menu
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      role="menu"
    >
      <TrackMenuHeader title="Subtitles" onClose={onClose} />
      <div className="grid grid-cols-1 gap-3 sm:h-80 sm:min-h-0 sm:grid-cols-[minmax(8rem,0.9fr)_minmax(11rem,1.1fr)_minmax(9rem,0.8fr)]">
        <section
          className="max-h-48 min-h-0 overflow-y-auto overscroll-contain pr-1 sm:max-h-none"
          aria-label="Subtitle languages"
        >
          <TrackMenuSectionTitle>Languages</TrackMenuSectionTitle>
          <TrackMenuChoice active={!active} onClick={onOff}>
            Off
          </TrackMenuChoice>
          {groups.map((group) => (
            <TrackMenuChoice
              key={group.code}
              active={
                selectedCode === group.code ||
                (!selectedCode && group.tracks.some((track) => track.selected))
              }
              detail={group.tracks.length.toString()}
              onClick={() => onSelectLanguage(group.code)}
            >
              {group.label}
            </TrackMenuChoice>
          ))}
        </section>
        <section
          className="max-h-48 min-h-0 overflow-y-auto overscroll-contain border-zinc-800 pr-1 sm:max-h-none sm:border-l sm:pl-3"
          aria-label="Subtitle variants"
        >
          <TrackMenuSectionTitle>
            <span className="inline-flex items-center gap-1">
              <ChevronLeft className="sm:hidden" size={14} />
              Variants
            </span>
          </TrackMenuSectionTitle>
          {selectedGroup ? (
            selectedGroup.tracks.map((track) => (
              <TrackMenuRow
                key={track.id}
                track={track}
                fallback="Subtitles"
                onClick={() => onSelectTrack(track)}
              />
            ))
          ) : (
            <p className="px-2 py-2 text-sm text-zinc-500">
              Choose a language to see its variants.
            </p>
          )}
        </section>
        <section
          className="min-h-0 border-zinc-800 sm:border-l sm:pl-3"
          aria-label="Subtitle settings"
        >
          <TrackMenuSectionTitle>Settings</TrackMenuSectionTitle>
          <p className="px-2 text-xs text-zinc-500">Vertical position</p>
          <div className="mt-2 flex items-center rounded-full bg-zinc-900">
            <button
              className="pointer-events-auto grid size-10 place-items-center rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-white"
              data-overlay-interactive
              onClick={() => adjustPosition(-5)}
              aria-label="Raise subtitles"
            >
              <Minus size={16} />
            </button>
            <output className="flex-1 text-center text-sm tabular-nums">{subtitlePosition}%</output>
            <button
              className="pointer-events-auto grid size-10 place-items-center rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-white"
              data-overlay-interactive
              onClick={() => adjustPosition(5)}
              aria-label="Lower subtitles"
            >
              <Plus size={16} />
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function TrackMenuHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 pb-2 pt-1">
      <h3 className="font-display text-sm font-semibold">{title}</h3>
      <button
        className="pointer-events-auto rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
        data-overlay-interactive
        onClick={onClose}
        aria-label={`Close ${title.toLowerCase()} menu`}
      >
        <X size={15} />
      </button>
    </div>
  )
}

function TrackMenuSectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="sticky top-0 z-10 mb-2 bg-zinc-950 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </p>
  )
}

function TrackMenuChoice({
  children,
  detail,
  active,
  onClick,
}: {
  children: ReactNode
  detail?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`pointer-events-auto mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
        active ? "bg-amber-400 text-zinc-950" : "text-zinc-300 hover:bg-zinc-800"
      }`}
      data-overlay-interactive
      onClick={onClick}
      aria-pressed={active}
    >
      <span>{children}</span>
      {detail && <span className={active ? "text-zinc-800" : "text-zinc-500"}>{detail}</span>}
    </button>
  )
}

function TrackMenuRow({
  track,
  fallback,
  audio = false,
  onClick,
}: {
  track: NativeTrack
  fallback: string
  audio?: boolean
  onClick: () => void
}) {
  const display = audio ? audioTrackDisplay(track, `${fallback} ${track.id}`) : undefined
  return (
    <button
      className={`pointer-events-auto mb-1 block w-full rounded-lg px-3 py-2 text-left ${
        track.selected ? "bg-amber-400 text-zinc-950" : "text-zinc-300 hover:bg-zinc-800"
      }`}
      data-overlay-interactive
      onClick={onClick}
      aria-pressed={track.selected}
    >
      <span className="block truncate text-sm font-medium" title={display?.primary}>
        {display?.primary ?? trackName(track, fallback)}
      </span>
      <span className={`block text-xs ${track.selected ? "text-zinc-800" : "text-zinc-500"}`}>
        {display?.secondary ?? trackDetails(track)}
      </span>
    </button>
  )
}

function selectSubtitleTrack(
  track: NativeTrack,
  command: (next: unknown[]) => void,
  setSnapshot: Dispatch<SetStateAction<NativePlayerSnapshot | undefined>>,
) {
  command(["set", "sid", track.id])
  setSnapshot((current) =>
    current
      ? {
          ...current,
          tracks: current.tracks.map((candidate) =>
            candidate.type === "sub"
              ? { ...candidate, selected: candidate.id === track.id }
              : candidate,
          ),
        }
      : current,
  )
}

function trackName(track: NativeTrack, fallback: string): string {
  return (
    track.title ||
    (track.lang ? subtitleLanguageName(track.lang) : undefined) ||
    `${fallback} ${track.id}`
  )
}

function trackDetails(track: NativeTrack): string {
  return [track.codec?.toUpperCase(), track.lang, track.external ? "External" : "Embedded"]
    .filter(Boolean)
    .join(" · ")
}

function seekSliderStyle(position: number, duration: number): CSSProperties {
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0
  return {
    "--player-progress": `${progress}%`,
    "--player-buffered": `${progress}%`,
  } as CSSProperties
}

function sliderStyle(value: number): CSSProperties {
  return { "--player-volume": `${Math.min(100, Math.max(0, value))}%` } as CSSProperties
}

function nativePlaybackDescription(snapshot: NativePlayerSnapshot): string {
  const codecs = [snapshot.videoCodec, snapshot.audioCodec]
    .filter(Boolean)
    .map((codec) => codec!.toUpperCase())
    .join(" / ")
  return [
    "Direct Play",
    snapshot.container?.toUpperCase(),
    codecs,
    snapshot.hardwareDecoder ? "Hardware (" + snapshot.hardwareDecoder + ")" : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00"
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  return hours > 0
    ? hours +
        ":" +
        minutes.toString().padStart(2, "0") +
        ":" +
        remainder.toString().padStart(2, "0")
    : minutes + ":" + remainder.toString().padStart(2, "0")
}
