export type VideoScale = "fit" | "crop" | "stretch"

export const VIDEO_SCALE_OPTIONS: Array<{ value: VideoScale; label: string }> = [
  { value: "fit", label: "Fit" },
  { value: "crop", label: "Crop" },
  { value: "stretch", label: "Stretch" },
]

export function videoObjectFit(scale: VideoScale): React.CSSProperties["objectFit"] {
  return scale === "crop" ? "cover" : scale === "stretch" ? "fill" : "contain"
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
