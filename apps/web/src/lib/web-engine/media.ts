/** Media events the web player listens to on either the `<video>` element or the WebCodecs engine. */
export const PLAYBACK_MEDIA_EVENTS = [
  "play",
  "pause",
  "playing",
  "waiting",
  "error",
  "timeupdate",
  "progress",
  "ended",
  "durationchange",
  "loadedmetadata",
  "canplay",
  "volumechange",
] as const

export type PlaybackMediaEvent = (typeof PLAYBACK_MEDIA_EVENTS)[number]

/**
 * The playback surface the web player drives. `HTMLVideoElement` satisfies it
 * structurally, and `WebMediaEngine` implements it for sources the browser
 * cannot play natively.
 */
export interface PlaybackMedia {
  currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly readyState: number
  readonly videoWidth: number
  readonly videoHeight: number
  readonly buffered: Pick<TimeRanges, "length" | "start" | "end">
  readonly error: { readonly code: number; readonly message: string } | null
  playbackRate: number
  volume: number
  muted: boolean
  play(): Promise<void>
  pause(): void
  addEventListener(type: PlaybackMediaEvent, listener: (event: Event) => void): void
  removeEventListener(type: PlaybackMediaEvent, listener: (event: Event) => void): void
}
