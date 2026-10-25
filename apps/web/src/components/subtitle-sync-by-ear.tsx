import { Ear, Eye, X } from "lucide-react"
import { useRef, useState } from "react"
import { formatSubtitleDelay, syncByEarDelay } from "../lib/title-playback"

type SyncMark = "heard" | "saw"

/**
 * Floating card that sets the subtitle delay by ear. Tapping Heard when a line
 * is spoken and Saw when its subtitle appears, in either order, shifts the
 * delay by the gap between the two playback positions. It stays open so the
 * next line can refine the result. Used by every web and desktop player.
 */
export function SubtitleSyncByEar({
  delayMs,
  onDelayChange,
  positionMs,
  onClose,
}: {
  delayMs: number
  onDelayChange: (delayMs: number) => void
  /** Read at each tap, so it should come from the player rather than a polled snapshot. */
  positionMs: () => number | Promise<number>
  onClose: () => void
}) {
  const marks = useRef<Partial<Record<SyncMark, number>>>({})
  const [pending, setPending] = useState<SyncMark>()
  const latestDelay = useRef(delayMs)
  latestDelay.current = delayMs

  const capture = async (mark: SyncMark) => {
    const position = await positionMs()
    const next: Partial<Record<SyncMark, number>> = { ...marks.current, [mark]: position }
    const { heard, saw } = next
    if (heard === undefined || saw === undefined) {
      marks.current = { [mark]: position }
      setPending(mark)
      return
    }
    marks.current = {}
    setPending(undefined)
    onDelayChange(syncByEarDelay(latestDelay.current, heard, saw))
  }

  const markClass = (mark: SyncMark) =>
    `pointer-events-auto flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium ${
      pending === mark ? "bg-amber-400 text-zinc-950" : "bg-zinc-900 text-white hover:bg-zinc-800"
    }`

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-20 z-[60] w-80 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-white/10 bg-zinc-950/95 p-3 shadow-2xl"
      role="dialog"
      aria-label="Sync subtitles by ear"
      data-native-overlay
      data-overlay-interactive
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 pl-1">
        <h3 className="flex-1 font-display text-sm font-semibold">Sync by ear</h3>
        <output className="text-sm tabular-nums text-zinc-300">
          {formatSubtitleDelay(delayMs)}
        </output>
        <button
          className="pointer-events-auto rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
          data-overlay-interactive
          onClick={onClose}
          aria-label="Close sync by ear"
        >
          <X size={15} />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className={markClass("heard")}
          data-overlay-interactive
          aria-pressed={pending === "heard"}
          onClick={() => void capture("heard")}
        >
          <Ear size={17} />
          Heard
        </button>
        <button
          className={markClass("saw")}
          data-overlay-interactive
          aria-pressed={pending === "saw"}
          onClick={() => void capture("saw")}
        >
          <Eye size={17} />
          Saw
        </button>
      </div>
      <p className="mt-2 px-1 text-xs text-zinc-400" aria-live="polite">
        {pending === "heard"
          ? "Now tap Saw when its subtitle appears."
          : pending === "saw"
            ? "Now tap Heard when the line is spoken."
            : "Tap Heard when you hear a line and Saw when its subtitle appears."}
      </p>
    </div>
  )
}
