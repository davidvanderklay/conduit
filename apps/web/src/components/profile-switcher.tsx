import { useEffect, useRef, useState } from "react"
import { Baby, Check, ChevronDown } from "lucide-react"
import type { Profile } from "../lib/api"

export function ProfileSwitcher({
  profiles,
  activeProfile,
  onSelect,
}: {
  profiles: Profile[]
  activeProfile: Profile
  onSelect: (profileId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    const dismissKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }

    document.addEventListener("pointerdown", dismissOutside, true)
    window.addEventListener("keydown", dismissKeyboard)
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true)
      window.removeEventListener("keydown", dismissKeyboard)
    }
  }, [open])

  const choose = (profileId: string) => {
    onSelect(profileId)
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        className="group flex h-11 min-w-12 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-2 text-left text-white shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        aria-label={`Switch profile, current profile ${activeProfile.name}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ProfileAvatar profile={activeProfile} className="size-8" />
        <span className="hidden min-w-0 sm:block">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            Watching as
          </span>
          <span className="block max-w-28 truncate text-sm font-semibold text-zinc-100">
            {activeProfile.name}
          </span>
        </span>
        <ChevronDown
          className={`hidden shrink-0 text-zinc-500 transition-transform sm:block ${
            open ? "rotate-180" : ""
          }`}
          size={16}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-72 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-2 text-white shadow-[0_24px_70px_rgba(0,0,0,0.7)]"
          role="listbox"
          aria-label="Profiles"
        >
          <div className="px-3 pb-2 pt-2">
            <p className="font-display text-sm font-semibold text-zinc-100">Switch profile</p>
            <p className="mt-0.5 text-xs text-zinc-500">Choose whose space to open.</p>
          </div>
          <div className="space-y-1">
            {profiles.map((profile) => {
              const selected = profile.id === activeProfile.id
              return (
                <button
                  key={profile.id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                    selected
                      ? "border-amber-400/25 bg-amber-400/10"
                      : "border-transparent hover:border-zinc-800 hover:bg-zinc-900"
                  }`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(profile.id)}
                >
                  <ProfileAvatar profile={profile} className="size-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-100">
                      {profile.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
                      {profile.isKids ? (
                        <>
                          <Baby size={12} /> Kids profile
                        </>
                      ) : (
                        "Personal profile"
                      )}
                    </span>
                  </span>
                  <span
                    className={`grid size-6 place-items-center rounded-full ${
                      selected ? "bg-amber-400 text-zinc-950" : "text-transparent"
                    }`}
                  >
                    <Check size={14} strokeWidth={3} />
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function ProfileAvatar({ profile, className }: { profile: Profile; className: string }) {
  return (
    <span
      className={`${className} grid shrink-0 place-items-center rounded-full border border-white/10 text-sm font-bold text-white shadow-inner`}
      style={{ background: avatarGradient(profile.id) }}
      aria-hidden="true"
    >
      {profile.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}

function avatarGradient(profileId: string): string {
  const gradients = [
    "linear-gradient(135deg, #f59e0b, #c2410c)",
    "linear-gradient(135deg, #8b5cf6, #4f46e5)",
    "linear-gradient(135deg, #06b6d4, #0369a1)",
    "linear-gradient(135deg, #ec4899, #9d174d)",
    "linear-gradient(135deg, #22c55e, #047857)",
  ]
  const hash = [...profileId].reduce((value, character) => value + character.charCodeAt(0), 0)
  return gradients[hash % gradients.length]!
}
