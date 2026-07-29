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
  if (!library.supported) return null

  return (
    <Button
      type="button"
      size={compact || revealLabel ? "icon" : "default"}
      variant={library.saved ? "secondary" : "default"}
      className={cn(
        revealLabel &&
          "group/library w-10 overflow-hidden whitespace-nowrap px-0 transition-[width,padding] duration-200 [&>svg]:shrink-0 hover:w-44 hover:px-3 focus-visible:w-44 focus-visible:px-3",
      )}
      disabled={library.loading}
      aria-label={library.saved ? `Remove ${item.name} from library` : `Add ${item.name} to library`}
      title={library.error?.message}
      onClick={(event) => {
        event.stopPropagation()
        library.toggle()
      }}
    >
      {library.saved ? <Check size={16} /> : <Plus size={16} />}
      {!compact && !revealLabel && (library.saved ? "In library" : "Add to library")}
      {revealLabel && (
        <span className="max-w-0 overflow-hidden opacity-0 transition-all duration-200 group-hover/library:max-w-32 group-hover/library:opacity-100 group-focus-visible/library:max-w-32 group-focus-visible/library:opacity-100">
          {library.saved ? "In library" : "Add to library"}
        </span>
      )}
    </Button>
  )
}
