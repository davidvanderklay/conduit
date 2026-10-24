import { useEffect, useRef } from "react"
import { SEEK_SECONDS } from "./player-shortcuts"

export interface MediaSessionControls {
  play: () => void
  pause: () => void
  seekBy: (seconds: number) => void
  /** Omit when there is nothing to skip to so the OS hides its next button. */
  next?: () => void
}

/**
 * Publishes now-playing metadata and routes OS media keys and media overlays
 * (MPRIS, Windows media controls, macOS Now Playing) to the player.
 *
 * Chromium only hands media keys to a page that is playing an HTML media
 * element. The desktop player renders through mpv, so it sets `anchor` to play
 * a silent looping clip that keeps the session active.
 */
export function usePlayerMediaSession({
  title,
  artist,
  artwork,
  playing,
  controls,
  anchor = false,
}: {
  title: string
  artist?: string
  artwork?: string
  playing: boolean
  controls: MediaSessionControls
  anchor?: boolean
}) {
  const latestControls = useRef(controls)
  latestControls.current = controls
  const hasNext = controls.next !== undefined
  const supported = typeof navigator !== "undefined" && "mediaSession" in navigator

  useEffect(() => {
    if (!supported) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      artwork: artwork ? [{ src: artwork }] : [],
    })
    return () => {
      navigator.mediaSession.metadata = null
    }
  }, [artist, artwork, supported, title])

  useEffect(() => {
    if (!supported) return
    navigator.mediaSession.playbackState = playing ? "playing" : "paused"
  }, [playing, supported])

  useEffect(() => {
    if (!supported) return
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => latestControls.current.play(),
      pause: () => latestControls.current.pause(),
      seekbackward: (details) =>
        latestControls.current.seekBy(-(details.seekOffset ?? SEEK_SECONDS)),
      seekforward: (details) => latestControls.current.seekBy(details.seekOffset ?? SEEK_SECONDS),
      ...(hasNext ? { nexttrack: () => latestControls.current.next?.() } : {}),
    }
    const actions = Object.keys(handlers) as MediaSessionAction[]
    for (const action of actions) setActionHandler(action, handlers[action] ?? null)
    return () => {
      for (const action of actions) setActionHandler(action, null)
      navigator.mediaSession.playbackState = "none"
    }
  }, [hasNext, supported])

  const anchorAudio = useRef<HTMLAudioElement | undefined>(undefined)
  useEffect(() => {
    if (!anchor || !supported) return
    const url = URL.createObjectURL(silentClip())
    const audio = new Audio(url)
    audio.loop = true
    anchorAudio.current = audio
    return () => {
      anchorAudio.current = undefined
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
      URL.revokeObjectURL(url)
    }
  }, [anchor, supported])

  useEffect(() => {
    const audio = anchorAudio.current
    if (!audio) return
    // Pausing the anchor keeps the session (and the OS play button) alive.
    if (playing) void audio.play().catch(() => undefined)
    else audio.pause()
  }, [anchor, playing, supported])
}

function setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    navigator.mediaSession.setActionHandler(action, handler)
  } catch {
    // Browsers throw for actions they do not support.
  }
}

/**
 * Six seconds of 8 kHz mono silence as a WAV. Chromium treats clips shorter
 * than five seconds as transient sounds that never receive media keys.
 */
function silentClip(): Blob {
  const sampleRate = 8000
  const samples = sampleRate * 6
  const header = new DataView(new ArrayBuffer(44))
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => header.setUint8(offset + index, char.charCodeAt(0)))
  text(0, "RIFF")
  header.setUint32(4, 36 + samples, true)
  text(8, "WAVE")
  text(12, "fmt ")
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, 1, true) // mono
  header.setUint32(24, sampleRate, true)
  header.setUint32(28, sampleRate, true) // byte rate
  header.setUint16(32, 1, true) // block align
  header.setUint16(34, 8, true) // bits per sample
  text(36, "data")
  header.setUint32(40, samples, true)
  // Unsigned 8-bit PCM is silent at its midpoint.
  return new Blob([header, new Uint8Array(samples).fill(128)], { type: "audio/wav" })
}
