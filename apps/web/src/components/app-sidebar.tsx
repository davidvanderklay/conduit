import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import {
  CalendarDays,
  Compass,
  Home,
  Library,
  Puzzle,
  Settings,
  type LucideIcon,
} from "lucide-react"

export type AppSection = "home" | "discover" | "library" | "history" | "calendar" | "addons" | "settings"

const items: Array<{ id: AppSection; label: string; icon: LucideIcon; primary?: boolean }> = [
  { id: "home", label: "Home", icon: Home, primary: true },
  { id: "discover", label: "Discover", icon: Compass, primary: true },
  { id: "library", label: "Library", icon: Library, primary: true },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "addons", label: "Add-ons", icon: Puzzle },
  { id: "settings", label: "Settings", icon: Settings },
]

export function AppSidebar({
  active,
  onNavigate,
}: {
  active: AppSection
  onNavigate: (section: AppSection) => void
}) {
  const nav = useRef<HTMLElement>(null)
  const armTimer = useRef<number | undefined>(undefined)
  const armed = useRef(false)
  const suppressClick = useRef(false)
  const previewRef = useRef<AppSection | undefined>(undefined)
  const [preview, setPreview] = useState<AppSection>()

  const updatePreview = (section: AppSection | undefined) => {
    previewRef.current = section
    setPreview(section)
  }

  const resetScrub = () => {
    window.clearTimeout(armTimer.current)
    armed.current = false
    updatePreview(undefined)
  }
  const sectionAt = (x: number, y: number): AppSection | undefined => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-section]")
    if (!target || !nav.current?.contains(target)) return undefined
    return target.dataset.section as AppSection | undefined
  }
  const startScrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (window.matchMedia("(min-width: 768px)").matches) return
    const pointerId = event.pointerId
    const { clientX, clientY } = event
    armTimer.current = window.setTimeout(() => {
      nav.current?.setPointerCapture(pointerId)
      armed.current = true
      updatePreview(sectionAt(clientX, clientY) ?? active)
    }, 360)
  }
  const moveScrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (!armed.current) return
    const next = sectionAt(event.clientX, event.clientY)
    if (next) updatePreview(next)
  }
  const finishScrub = () => {
    if (armed.current && previewRef.current) {
      suppressClick.current = true
      onNavigate(previewRef.current)
      window.setTimeout(() => { suppressClick.current = false }, 0)
    }
    resetScrub()
  }

  return (
    <aside className="app-sidebar app-chrome fixed bottom-3 left-3 right-3 z-30 rounded-3xl border border-white/15 bg-zinc-900/65 shadow-2xl shadow-black/60 backdrop-blur-2xl md:bottom-auto md:left-0 md:right-auto md:top-16 md:h-[calc(100vh-4rem)] md:w-16 md:rounded-none md:border-b-0 md:border-l-0 md:border-t-0 md:border-r md:border-zinc-800 md:bg-zinc-950/85">
      <nav
        ref={nav}
        className="mx-auto flex h-16 max-w-lg touch-none items-center justify-around px-2 md:h-full md:touch-auto md:flex-col md:justify-start md:gap-2 md:py-4"
        aria-label="Main navigation"
        onPointerDown={startScrub}
        onPointerMove={moveScrub}
        onPointerUp={finishScrub}
        onPointerCancel={resetScrub}
        onContextMenu={(event) => {
          if (!window.matchMedia("(min-width: 768px)").matches) event.preventDefault()
        }}
      >
        {items.map((item) => {
          const Icon = item.icon
          const selected = (preview ?? active) === item.id
          return (
            <button
              key={item.id}
              data-section={item.id}
              className={`group relative size-11 place-items-center rounded-xl transition ${item.primary ? "grid" : "hidden md:grid"} ${
                selected
                  ? "bg-amber-400/15 text-amber-300"
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
              aria-label={item.label}
              aria-current={selected ? "page" : undefined}
              onClick={() => {
                if (!suppressClick.current) onNavigate(item.id)
              }}
            >
              <Icon size={20} strokeWidth={selected ? 2.4 : 2} />
              <span className="pointer-events-none absolute bottom-[calc(100%+0.4rem)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-100 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 md:bottom-auto md:left-[calc(100%+0.6rem)] md:translate-x-0">
                {item.label}
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
