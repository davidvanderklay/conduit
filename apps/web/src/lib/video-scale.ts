export type VideoScale = "fit" | "crop" | "stretch"

export const VIDEO_SCALE_OPTIONS: Array<{ value: VideoScale; label: string }> = [
  { value: "fit", label: "Fit" },
  { value: "crop", label: "Crop" },
  { value: "stretch", label: "Stretch" },
]

export function videoObjectFit(scale: VideoScale): React.CSSProperties["objectFit"] {
  return scale === "crop" ? "cover" : scale === "stretch" ? "fill" : "contain"
}

/**
 * Keeps a subtitle's preferred position inside the visible frame when crop
 * scales a video that is taller than the player viewport.
 */
export function subtitlePositionForVideoScale(
  position: number,
  scale: VideoScale,
  video: { width: number; height: number },
  viewport: { width: number; height: number },
): number {
  const safePosition = Math.max(0, Math.min(100, position))
  if (
    scale !== "crop" ||
    video.width <= 0 ||
    video.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return safePosition
  }

  const videoAspect = video.width / video.height
  const viewportAspect = viewport.width / viewport.height
  if (videoAspect >= viewportAspect) return safePosition

  const displayedHeight = viewport.width / videoAspect
  const croppedTop = (displayedHeight - viewport.height) / 2
  return Math.max(
    0,
    Math.min(100, (((safePosition / 100) * viewport.height + croppedTop) / displayedHeight) * 100),
  )
}

export function nextVideoScale(scale: VideoScale): VideoScale {
  return scale === "fit" ? "crop" : scale === "crop" ? "stretch" : "fit"
}

export function mpvVideoScaleCommands(
  scale: VideoScale,
  viewport: { width: number; height: number },
): unknown[][] {
  const viewportAspect = `${Math.max(1, viewport.width)}:${Math.max(1, viewport.height)}`
  return [
    ["set", "video-unscaled", "no"],
    ["set", "keepaspect", "yes"],
    ["set", "video-aspect-override", scale === "stretch" ? viewportAspect : "no"],
    ["set", "video-zoom", 0],
    ["set", "panscan", scale === "crop" ? 1 : 0],
  ]
}
