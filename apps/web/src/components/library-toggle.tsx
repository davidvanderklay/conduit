import { Check, Plus } from "lucide-react"
import type { CatalogItem, MetaItem } from "../lib/core"
import { useLibraryToggle } from "../lib/library"
import { Button } from "./ui/button"

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
  if (!library.supported) return null

  return (
    <Button
      type="button"
      size={compact ? "icon" : "default"}
      variant={library.saved ? "secondary" : "default"}
      disabled={library.loading}
      aria-label={library.saved ? `Remove ${item.name} from library` : `Add ${item.name} to library`}
      title={library.error?.message}
      onClick={(event) => {
        event.stopPropagation()
        library.toggle()
      }}
    >
      {library.saved ? <Check size={16} /> : <Plus size={16} />}
      {!compact && (library.saved ? "In library" : "Add to library")}
    </Button>
  )
}
