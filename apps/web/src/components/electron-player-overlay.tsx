import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react"
import {
  Captions,
  Languages,
  Maximize,
  Minimize,
  Pause,
  Play,
  Scaling,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react"
import {
  nativePlayerCommand,
  nativePlayerSnapshot,
  toggleNativeFullscreen,
  type NativePlayerSnapshot,
  type NativeTrack,
} from "../lib/desktop"
import {
  VIDEO_SCALE_OPTIONS,
  mpvVideoScaleCommands,
  nextVideoScale,
  type VideoScale,
} from "../lib/video-scale"

export function ElectronPlayerOverlay({ initialTitle }: { initialTitle: string }) {
  const [title, setTitle] = useState(initialTitle)
  const [snapshot, setSnapshot] = useState<NativePlayerSnapshot>()
  const [fullscreen, setFullscreen] = useState(false)
  const [scale, setScale] = useState<VideoScale>("fit")
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimer = useRef<number | undefined>(undefined)
  const mouseEventsIgnored = useRef(true)

  const showControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2800)
  }, [])

  const setMousePassthrough = useCallback((ignore: boolean) => {
    const electron = window.__CONDUIT_ELECTRON__
    if (!electron || mouseEventsIgnored.current === ignore) return
    mouseEventsIgnored.current = ignore
    electron.setPlayerOverlayMouseEvents(ignore)
  }, [])

  const handleMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    showControls()
    const target = event.target
    const interactive = target instanceof Element &&
      target.closest("[data-overlay-interactive]") !== null
    setMousePassthrough(!interactive)
  }, [setMousePassthrough, showControls])

  useEffect(() => {
    document.documentElement.classList.add("electron-player-overlay")
    return () => {
      document.documentElement.classList.remove("electron-player-overlay")
      window.clearTimeout(hideTimer.current)
    }
  }, [])

  useEffect(() => {
    const electron = window.__CONDUIT_ELECTRON__
    if (!electron) return
    const unsubscribeFullscreen = electron.onFullscreenChange(setFullscreen)
    const unsubscribeTitle = electron.onPlayerOverlayTitle(setTitle)
    return () => {
      unsubscribeFullscreen()
      unsubscribeTitle()
    }
  }, [])

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
    const timer = window.setInterval(poll, 500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const command = useCallback((next: unknown[]) => {
    void nativePlayerCommand(next).catch(() => undefined)
  }, [])

  const togglePlayback = useCallback(() => {
    const paused = snapshot?.paused ?? false
    command(["set", "pause", paused ? "no" : "yes"])
    setSnapshot((current) => (current ? { ...current, paused: !paused } : current))
  }, [command, snapshot?.paused])

  const toggleFullscreen = useCallback(() => {
    void toggleNativeFullscreen().then(setFullscreen).catch(() => undefined)
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

  const audioTracks = snapshot?.tracks.filter((track) => track.type === "audio") ?? []
  const subtitleTracks = snapshot?.tracks.filter((track) => track.type === "sub") ?? []
  const selectedScale = VIDEO_SCALE_OPTIONS.find((option) => option.value === scale)?.label ?? scale
  const rootClassName =
    "native-player electron-native-player electron-player-overlay fixed inset-0 z-50 select-none " +
    (controlsVisible ? "cursor-default" : "cursor-none")

  return (
    <div
      className={rootClassName}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setMousePassthrough(true)}
      onClick={(event) => {
        if (event.target === event.currentTarget) togglePlayback()
      }}
    >
      <div
        className={
          "pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 " +
          "px-5 pb-12 pt-4 transition-opacity " +
          (controlsVisible ? "opacity-100" : "opacity-0")
        }
      >
        <div className="flex min-w-0 items-center gap-3">
          <OverlayButton label="Back to details" onClick={close}>
            <Play className="rotate-180 fill-current" size={21} />
          </OverlayButton>
          <div className="min-w-0 drop-shadow-lg">
            <h2 className="truncate font-display text-lg font-semibold text-white">{title}</h2>
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

      <div
        className={
          "pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-5 pt-24 transition-opacity " +
          (controlsVisible ? "opacity-100" : "opacity-0")
        }
      >
        <div className="w-full">
          <div className="flex items-center gap-3 text-xs tabular-nums text-zinc-300">
            <span className="min-w-12 text-right">{formatTime(snapshot?.position ?? 0)}</span>
            <input
              className="player-seek pointer-events-auto block h-2 min-w-0 flex-1 cursor-pointer"
              data-overlay-interactive
              type="range"
              min={0}
              max={snapshot?.duration || 0}
              step={0.1}
              value={Math.min(snapshot?.position ?? 0, snapshot?.duration || 0)}
              aria-label="Seek"
              onChange={(event) => command(["set", "time-pos", Number(event.target.value)])}
            />
            <span className="min-w-12">{formatTime(snapshot?.duration ?? 0)}</span>
          </div>

          <div className="pointer-events-auto mt-3 flex items-center gap-2">
            <OverlayButton label={snapshot?.paused ? "Play" : "Pause"} onClick={togglePlayback}>
              {snapshot?.paused ? <Play size={22} /> : <Pause size={22} />}
            </OverlayButton>
            <OverlayButton label="Next episode" onClick={nextEpisode}>
              <SkipForward size={21} />
            </OverlayButton>
            <OverlayButton
              label={snapshot?.volume === 0 ? "Unmute" : "Mute"}
              onClick={() => command(["set", "volume", snapshot?.volume === 0 ? 100 : 0])}
            >
              {snapshot?.volume === 0 ? <VolumeX size={21} /> : <Volume2 size={21} />}
            </OverlayButton>
            <input
              className="player-volume hidden h-4 w-24 sm:block"
              data-overlay-interactive
              type="range"
              min={0}
              max={100}
              value={snapshot?.volume ?? 100}
              aria-label="Volume"
              onChange={(event) => command(["set", "volume", Number(event.target.value)])}
            />
            <div className="flex-1" />
            <TrackSelect
              ariaLabel="Audio track"
              icon={<Languages size={21} />}
              tracks={audioTracks}
              empty="Audio"
              onChange={(id) => command(["set", "aid", id])}
            />
            <TrackSelect
              ariaLabel="Subtitle track"
              icon={<Captions size={21} />}
              tracks={subtitleTracks}
              empty="Subtitles"
              allowOff
              onChange={(id) => command(["set", "sid", id])}
            />
            <OverlayButton
              label={"Video scale: " + selectedScale}
              onClick={changeScale}
            >
              <Scaling size={21} />
            </OverlayButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function OverlayButton({
  label,
  children,
  onClick,
}: {
  label: string
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="pointer-events-auto grid size-10 shrink-0 place-items-center rounded-lg text-zinc-100 drop-shadow-[0_1px_3px_rgb(0_0_0)] hover:bg-white/15 hover:text-white"
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
  onChange,
}: {
  ariaLabel: string
  icon: ReactNode
  tracks: NativeTrack[]
  empty: string
  allowOff?: boolean
  onChange: (id: string) => void
}) {
  if (!tracks.length && !allowOff) {
    return <OverlayButton label={empty} onClick={() => undefined}>{icon}</OverlayButton>
  }
  return (
    <label className="pointer-events-auto relative grid size-10 shrink-0 place-items-center rounded-lg text-zinc-100 drop-shadow-[0_1px_3px_rgb(0_0_0)] hover:bg-white/15 hover:text-white" data-overlay-interactive>
      {icon}
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={ariaLabel}
        value={tracks.find((track) => track.selected)?.id.toString() ?? (allowOff ? "no" : "")}
        onChange={(event) => onChange(event.target.value)}
      >
        {allowOff && <option value="no">Off</option>}
        {tracks.map((track) => (
          <option key={track.id} value={track.id}>
            {track.title || track.lang || track.type + " " + track.id}
          </option>
        ))}
      </select>
    </label>
  )
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
  ].filter(Boolean).join(" · ")
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00"
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  return hours > 0
    ? hours + ":" + minutes.toString().padStart(2, "0") + ":" + remainder.toString().padStart(2, "0")
    : minutes + ":" + remainder.toString().padStart(2, "0")
}
