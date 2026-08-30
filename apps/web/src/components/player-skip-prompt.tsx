import { useEffect, useState } from "react"
import type { SkipButtonPlacement } from "../lib/preferences"
import { skipSegmentLabel, type SkipSegment } from "../lib/skip-segments"

export function SkipSegmentButton({
  segment,
  placement,
  contained = false,
  revealKey,
  onSkip,
}: {
  segment: SkipSegment
  placement: SkipButtonPlacement
  contained?: boolean
  revealKey?: unknown
  onSkip: () => void
}) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 10_000)
    return () => window.clearTimeout(timer)
  }, [revealKey, segment.end, segment.start, segment.type])

  if (!visible) return null

  return (
    <button
      type="button"
      className={`${contained ? "relative" : `absolute bottom-24 ${placement === "left" ? "left-4 sm:left-6" : "right-4 sm:right-6"}`} pointer-events-auto z-20 h-11 border border-white/25 bg-black/90 px-5 text-sm font-semibold text-white shadow-xl shadow-black/60 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400`}
      data-native-overlay
      data-overlay-interactive
      onClick={onSkip}
    >
      {skipSegmentLabel(segment.type)}
    </button>
  )
}
