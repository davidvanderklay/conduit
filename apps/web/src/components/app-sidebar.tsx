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

const items: Array<{ id: AppSection; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "library", label: "Library", icon: Library },
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
  return (
    <aside className="app-chrome fixed bottom-0 left-0 right-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-xl md:bottom-auto md:right-auto md:top-16 md:h-[calc(100vh-4rem)] md:w-16 md:border-r md:border-t-0">
      <nav
        className="mx-auto flex h-16 max-w-lg items-center justify-around px-2 md:h-full md:flex-col md:justify-start md:gap-2 md:py-4"
        aria-label="Main navigation"
      >
        {items.map((item) => {
          const Icon = item.icon
          const selected = active === item.id
          return (
            <button
              key={item.id}
              className={`group relative grid size-11 place-items-center rounded-xl transition ${
                selected
                  ? "bg-amber-400/15 text-amber-300"
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
              aria-label={item.label}
              aria-current={selected ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
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
