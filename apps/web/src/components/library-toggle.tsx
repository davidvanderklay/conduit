import { useEffect, useRef, useState } from "react"
import { Check, Plus } from "lucide-react"
import type { CatalogItem, MetaItem } from "../lib/core"
import { useLibraryToggle } from "../lib/library"
import { Button } from "./ui/button"
import { cn } from "../lib/utils"

export function LibraryToggle({
  profileId,
  item,
  compact = false,
  revealLabel = false,
}: {
  profileId: string
  item: CatalogItem | MetaItem
  compact?: boolean
  revealLabel?: boolean
}) {
  const library = useLibraryToggle(profileId, item)
  const [feedback, setFeedback] = useState<"added" | "removed">()
  const feedbackTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(feedbackTimer.current), [])

  if (!library.supported) return null

  const handleToggle = async () => {
    const removing = library.saved
    try {
      await library.toggleAsync()
      setFeedback(removing ? "removed" : "added")
      window.clearTimeout(feedbackTimer.current)
      feedbackTimer.current = window.setTimeout(() => setFeedback(undefined), 2_500)
    } catch {
      // The hook exposes the mutation error through the button title.
    }
  }

  return (
    <div className="relative">
      <Button
        type="button"
        size={compact || revealLabel ? "icon" : "default"}
        variant="secondary"
        className={cn(
          library.saved
            ? "border border-rose-900/70 bg-rose-950/40 text-rose-300 hover:bg-rose-950/60"
            : "border border-amber-400/60 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20",
          revealLabel &&
            "group/library w-10 overflow-hidden whitespace-nowrap px-0 transition-[width,padding] duration-200 [&>svg]:shrink-0 hover:w-44 hover:px-3 focus-visible:w-44 focus-visible:px-3",
        )}
        disabled={library.loading}
        aria-label={library.saved ? `Remove ${item.name} from library` : `Add ${item.name} to library`}
        aria-pressed={library.saved}
        title={library.error?.message}
        onClick={(event) => {
          event.stopPropagation()
          void handleToggle()
        }}
      >
        {library.saved ? <Check size={16} /> : <Plus size={16} />}
        {!compact && !revealLabel && (library.saved ? "Remove from library" : "Add to library")}
        {revealLabel && (
          <span className="max-w-0 overflow-hidden opacity-0 transition-all duration-200 group-hover/library:max-w-32 group-hover/library:opacity-100 group-focus-visible/library:max-w-32 group-focus-visible/library:opacity-100">
            {library.saved ? "Remove from library" : "Add to library"}
          </span>
        )}
      </Button>
      {feedback && (
        <p
          role="status"
          className="pointer-events-none absolute left-0 top-full z-20 mt-2 whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 shadow-xl shadow-black/40"
        >
          {feedback === "removed" ? "Removed from library" : "Added to library"}
        </p>
      )}
    </div>
  )
}
