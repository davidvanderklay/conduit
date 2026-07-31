import { useEffect, useRef, useState } from "react"
import { Scaling } from "lucide-react"
import {
  VIDEO_SCALE_OPTIONS,
  nextVideoScale,
  type VideoScale,
} from "../lib/video-scale"

export function VideoScaleControl({
  value,
  expanded = false,
  indicatorPlacement = "below",
  onIndicatorHidden,
  onChange,
}: {
  value: VideoScale
  expanded?: boolean
  indicatorPlacement?: "above" | "below"
  onIndicatorHidden?: () => void
  onChange: (value: VideoScale) => void
}) {
  const [indicator, setIndicator] = useState<VideoScale>()
  const hideTimer = useRef<number | undefined>(undefined)
  const selected = VIDEO_SCALE_OPTIONS.find((option) => option.value === value)!

  useEffect(() => {
    return () => window.clearTimeout(hideTimer.current)
  }, [])

  return (
    <div className="pointer-events-auto relative shrink-0">
      <button
        className={`grid place-items-center rounded-full bg-black/60 text-zinc-200 hover:bg-white/15 ${
          expanded ? "size-13 [&_svg]:size-7" : "size-10"
        }`}
        type="button"
        aria-label={`Video scale: ${selected.label}`}
        title={`Video scale: ${selected.label}`}
        onClick={() => {
          const next = nextVideoScale(value)
          onChange(next)
          setIndicator(next)
          window.clearTimeout(hideTimer.current)
          hideTimer.current = window.setTimeout(() => {
            setIndicator(undefined)
            onIndicatorHidden?.()
          }, 1400)
        }}
      >
        <Scaling size={20} />
      </button>
      {indicator && (
        <div
          className={`pointer-events-none absolute right-0 whitespace-nowrap rounded-full bg-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-100 shadow-2xl ring-1 ring-white/10 ${
            indicatorPlacement === "above"
              ? "bottom-[calc(100%+0.75rem)]"
              : "top-[calc(100%+0.75rem)]"
          }`}
          role="status"
        >
          Video scale: {VIDEO_SCALE_OPTIONS.find((option) => option.value === indicator)!.label}
        </div>
      )}
    </div>
  )
}
