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
}: {
  profileId: string
  item: CatalogItem | MetaItem
  compact?: boolean
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
        size={compact ? "icon" : "default"}
        variant="secondary"
        className={cn(library.saved && "text-amber-300")}
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
        {!compact && (library.saved ? "Remove from library" : "Add to library")}
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
