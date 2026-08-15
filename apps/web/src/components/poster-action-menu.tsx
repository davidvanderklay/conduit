import { useEffect, useRef, useState, type ReactNode } from "react"
import { MoreVertical } from "lucide-react"
import { createPortal } from "react-dom"

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
  const [menuPosition, setMenuPosition] = useState({ top: 8, left: 8 })
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
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

  useEffect(() => {
    if (!open) return
    const reposition = () => {
      const rootRect = root.current?.getBoundingClientRect()
      const menuWidth = menu.current?.offsetWidth
      const menuHeight = menu.current?.offsetHeight
      if (!rootRect || !menuWidth || !menuHeight) return
      const gap = 8
      const roomAbove = rootRect.top - gap
      const roomBelow = window.innerHeight - rootRect.bottom - gap
      const above = roomAbove >= menuHeight || roomAbove >= roomBelow
      const preferredTop = above
        ? rootRect.top - menuHeight - gap
        : rootRect.bottom + gap
      const maxTop = Math.max(gap, window.innerHeight - menuHeight - gap)
      const top = Math.min(Math.max(gap, preferredTop), maxTop)
      const left = Math.min(
        Math.max(gap, rootRect.right - menuWidth),
        Math.max(gap, window.innerWidth - menuWidth - gap),
      )
      setMenuPosition({ top, left })
    }
    reposition()
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    return () => {
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
    }
  }, [actions.length, open])

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
          if (!open) {
            const rect = root.current?.getBoundingClientRect()
            if (rect) setMenuPosition({ top: rect.bottom + 8, left: rect.right - 208 })
          }
          setOpen((current) => !current)
        }}
      >
        <MoreVertical size={17} />
      </button>
      {open && createPortal(
        <div
          ref={menu}
          role="menu"
          style={{ top: menuPosition.top, left: menuPosition.left }}
          className="fixed z-50 max-h-[min(70vh,18rem)] w-52 overflow-y-auto overflow-x-hidden rounded-xl border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl shadow-black/60"
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
        </div>,
        document.body,
      )}
    </div>
  )
}
