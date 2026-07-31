import { Play } from "lucide-react"
import type { WatchProgress } from "../lib/api"

export function isMeaningfullyInProgress(
  progress: Pick<WatchProgress, "positionMs" | "durationMs" | "watched"> | undefined,
): boolean {
  if (!progress || progress.watched || progress.durationMs <= 0) return false
  const percent = progress.positionMs / progress.durationMs
  return progress.positionMs >= 30_000 && percent < 0.9
}

export function PosterResumeButton({
  title,
  progress,
  onResume,
}: {
  title: string
  progress?: Pick<WatchProgress, "positionMs" | "durationMs" | "watched">
  onResume: () => void
}) {
  if (!isMeaningfullyInProgress(progress)) return null
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <button
        type="button"
        aria-label={`Resume ${title}`}
        title={`Resume ${title}`}
        className="pointer-events-auto grid size-12 place-items-center rounded-full bg-zinc-950/65 text-white shadow-xl shadow-black/40 ring-2 ring-white/80 backdrop-blur-sm transition hover:scale-105 hover:border-emerald-400 hover:bg-emerald-500 hover:ring-emerald-400 focus-visible:scale-105 focus-visible:bg-emerald-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/60 sm:size-14"
        onClick={(event) => {
          event.stopPropagation()
          onResume()
        }}
      >
        <Play className="ml-0.5 fill-current" size={23} />
      </button>
    </div>
  )
}
