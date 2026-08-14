import type { NativePlayerSnapshot } from "./desktop"

type PlaybackStateSnapshot = Pick<NativePlayerSnapshot, "firstFrameReady" | "loading">

export function isDesktopInitialLoading(
  snapshot: PlaybackStateSnapshot | undefined,
  error?: unknown,
): boolean {
  return !error && !snapshot?.firstFrameReady
}

export function isDesktopBuffering(
  snapshot: PlaybackStateSnapshot | undefined,
  error?: unknown,
): boolean {
  return !error && Boolean(snapshot?.firstFrameReady && snapshot.loading)
}

export function shouldShowDesktopPlayPause(
  snapshot: PlaybackStateSnapshot | undefined,
  seeking: boolean,
  error?: unknown,
): boolean {
  return Boolean(
    snapshot &&
      !error &&
      snapshot.firstFrameReady &&
      !snapshot.loading &&
      !seeking,
  )
}
