import { useEffect, useRef, useState, type ReactNode } from "react"
import { MoreVertical } from "lucide-react"

export interface PosterAction {
  label: string
  icon: ReactNode
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}

export function PosterActionMenu({
  title,
  actions,
}: {
  title: string
  actions: PosterAction[]
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismissKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", dismiss, true)
    window.addEventListener("keydown", dismissKeyboard)
    return () => {
      document.removeEventListener("pointerdown", dismiss, true)
      window.removeEventListener("keydown", dismissKeyboard)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={`Actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid size-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100 focus-visible:bg-zinc-800 focus-visible:text-zinc-100"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        <MoreVertical size={17} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-10 right-0 z-40 w-52 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl shadow-black/60"
        >
          {actions.map((action) => (
            <button
              type="button"
              role="menuitem"
              key={action.label}
              disabled={action.disabled}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition disabled:opacity-50 ${
                action.destructive
                  ? "text-red-300 hover:bg-red-500/10"
                  : "text-zinc-200 hover:bg-zinc-800"
              }`}
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
                action.onSelect()
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
