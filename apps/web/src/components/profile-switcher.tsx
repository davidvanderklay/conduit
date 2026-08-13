import { useEffect, useRef, useState, type FormEvent } from "react"
import { Baby, Check, ChevronDown, LogOut, Palette, Plus, Puzzle, Settings, X } from "lucide-react"
import type { AppSection } from "./app-sidebar"
import type { Profile } from "../lib/api"
import { Button } from "./ui/button"
import { Input } from "./ui/input"

export function ProfileSwitcher({
  profiles,
  activeProfile,
  onSelect,
  onCreate,
  userName = "",
  onNavigate = () => undefined,
  onSignOut = () => undefined,
}: {
  profiles: Profile[]
  activeProfile: Profile
  onSelect: (profileId: string) => void
  onCreate?: (values: CreateProfileValues) => Promise<void>
  userName?: string
  onNavigate?: (section: AppSection) => void
  onSignOut?: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showAllProfiles, setShowAllProfiles] = useState(false)
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
  const compactProfiles = [
    activeProfile,
    ...profiles.filter((profile) => profile.id !== activeProfile.id),
  ].slice(0, 4)
  const visibleProfiles = showAllProfiles ? profiles : compactProfiles
  const hiddenProfileCount = Math.max(0, profiles.length - compactProfiles.length)

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        className="group flex h-11 min-w-12 items-center gap-2 rounded-[18px] border border-zinc-800 bg-zinc-950 px-2 text-left text-white shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
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
          className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-72 overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-950/95 p-2 text-white shadow-[0_24px_70px_rgba(0,0,0,0.7)]"
          role="listbox"
          aria-label="Profiles"
        >
          <div className="px-3 pb-2 pt-2">
            <p className="font-display text-sm font-semibold text-zinc-100">Switch profile</p>
            <p className="mt-0.5 text-xs text-zinc-500">Choose whose space to open.</p>
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto overscroll-contain">
            {visibleProfiles.map((profile) => {
              const selected = profile.id === activeProfile.id
              return (
                <button
                  key={profile.id}
                  type="button"
                    className={`flex w-full items-center gap-3 rounded-2xl border px-2.5 py-2 text-left transition-colors ${
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
          {hiddenProfileCount > 0 && (
            <button
              type="button"
              className="mt-1 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
              onClick={() => setShowAllProfiles((current) => !current)}
            >
              {showAllProfiles ? "Show fewer profiles" : `Show ${hiddenProfileCount} more profile${hiddenProfileCount === 1 ? "" : "s"}`}
            </button>
          )}
          {onCreate && (
            <button
              type="button"
              className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-dashed border-zinc-800 px-2.5 py-2.5 text-left text-zinc-400 transition-colors hover:border-amber-400/40 hover:bg-amber-400/5 hover:text-zinc-100"
              onClick={() => {
                setOpen(false)
                setCreating(true)
              }}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-zinc-900">
                <Plus size={18} />
              </span>
              <span>
                <span className="block text-sm font-semibold">Add profile</span>
                <span className="mt-0.5 block text-xs text-zinc-600">Create another space</span>
              </span>
            </button>
          )}
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <p className="truncate px-3 py-1 text-xs text-zinc-600">{userName}</p>
            <MenuAction icon={Settings} label="Settings" onClick={() => { onNavigate("settings"); setOpen(false) }} />
            <MenuAction icon={Puzzle} label="Add-ons" onClick={() => { onNavigate("addons"); setOpen(false) }} />
            <MenuAction icon={LogOut} label="Log out" onClick={onSignOut} />
          </div>
        </div>
      )}
      {creating && onCreate && (
        <CreateProfileDialog
          sourceProfile={activeProfile}
          onClose={() => {
            setCreating(false)
            trigger.current?.focus()
          }}
          onCreate={onCreate}
        />
      )}
    </div>
  )
}

function CreateProfileDialog({
  sourceProfile,
  onClose,
  onCreate,
}: {
  sourceProfile: Profile
  onClose: () => void
  onCreate: (values: CreateProfileValues) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [isKids, setIsKids] = useState(false)
  const [copyAddons, setCopyAddons] = useState(true)
  const [usesPrimaryAddons, setUsesPrimaryAddons] = useState(false)
  const [avatarColor, setAvatarColor] = useState(PROFILE_COLORS[0]!)
  const [avatarUrl, setAvatarUrl] = useState("")
  const [avatarMode, setAvatarMode] = useState<"color" | "image">("color")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose()
    }
    window.addEventListener("keydown", dismiss)
    return () => window.removeEventListener("keydown", dismiss)
  }, [onClose, pending])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      await onCreate({
        name: name.trim(),
        isKids,
        copyAddons: copyAddons && !usesPrimaryAddons,
        usesPrimaryAddons,
        avatarColor: avatarMode === "color" ? avatarColor : null,
        avatarUrl: avatarMode === "image" ? avatarUrl.trim() || null : null,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create profile")
    } finally {
      setPending(false)
    }
  }

  const previewProfile: Profile = {
    id: name.trim() || "new-profile",
    name: name.trim() || "New profile",
    isKids,
    avatarColor: avatarMode === "color" ? avatarColor : null,
    avatarUrl: avatarMode === "image" ? avatarUrl.trim() || null : null,
    usesPrimaryAddons,
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-[0_30px_100px_rgba(0,0,0,0.8)] sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-profile-title"
      >
        <div className="flex items-start gap-4">
          <ProfileAvatar profile={previewProfile} className="size-14 text-lg" />
          <div className="min-w-0 flex-1">
            <h2 id="create-profile-title" className="font-display text-xl font-semibold">
              Add a profile
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Give someone their own library, watch history, and preferences.
            </p>
          </div>
          <button
            type="button"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900 hover:text-white"
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <form className="mt-6 space-y-5" onSubmit={submit}>
          <label className="block text-sm font-medium text-zinc-300">
            Profile name
            <Input
              className="mt-2"
              autoFocus
              maxLength={80}
              placeholder="Who’s watching?"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>

          <div className="space-y-2">
            <ProfileOption
              title="Kids profile"
              description="Marks this as a child-friendly space."
              checked={isKids}
              onChange={setIsKids}
            />
            <ProfileOption
              title={`Copy add-ons from ${sourceProfile.name}`}
              description="Start with the same installed sources. They can be changed independently later."
              checked={copyAddons}
              onChange={setCopyAddons}
            />
            <ProfileOption
              title="Use primary add-ons"
              description="Share the primary profile's live add-on setup."
              checked={usesPrimaryAddons}
              onChange={(value) => {
                setUsesPrimaryAddons(value)
                if (value) setCopyAddons(false)
              }}
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-zinc-300">Avatar</p>
            <div className="mb-4 inline-flex rounded-xl border border-zinc-800 bg-zinc-900 p-1">
              <button type="button" className={`rounded-lg px-3 py-2 text-sm ${avatarMode === "color" ? "bg-zinc-700 text-white" : "text-zinc-500"}`} onClick={() => setAvatarMode("color")}>Profile color</button>
              <button type="button" className={`rounded-lg px-3 py-2 text-sm ${avatarMode === "image" ? "bg-zinc-700 text-white" : "text-zinc-500"}`} onClick={() => setAvatarMode("image")}>Custom image</button>
            </div>
            {avatarMode === "color" ? <ProfileColorPicker value={avatarColor} onChange={setAvatarColor} /> : <Input type="url" placeholder="https://example.com/avatar.png" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} />}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-zinc-800 pt-5">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={pending || name.trim().length === 0}>
              <Plus size={16} />
              {pending ? "Creating…" : "Create profile"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProfileOption({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-200">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span>
      </span>
      <input
        className="peer sr-only"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-zinc-700 transition-colors peer-checked:bg-amber-400 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-300">
        <span
          className={`absolute top-1 size-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </label>
  )
}

function MenuAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Settings
  label: string
  onClick: () => void | Promise<void>
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white"
      onClick={onClick}
    >
      <Icon size={17} />
      {label}
    </button>
  )
}

export function ProfileAvatar({ profile, className }: { profile: Profile; className: string }) {
  return (
    <span
      className={`${className} relative grid aspect-square shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 text-sm font-bold text-white`}
      style={{ background: profile.avatarUrl ? "#18181b" : profile.avatarColor ?? avatarGradient(profile.id) }}
      aria-hidden="true"
    >
      {profile.avatarUrl ? (
        <img className="absolute inset-0 block size-full object-cover" src={profile.avatarUrl} alt="" />
      ) : (
        profile.name.trim().charAt(0).toUpperCase() || "?"
      )}
    </span>
  )
}

export function ProfileColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const isPreset = PROFILE_COLORS.some((color) => color.toLowerCase() === value.toLowerCase())
  return <div><div className="flex flex-wrap items-center gap-3">{PROFILE_COLORS.map((color) => <button key={color} type="button" className={`size-9 rounded-full transition ${color.toLowerCase() === value.toLowerCase() ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-950" : "hover:scale-110"}`} style={{ backgroundColor: color }} aria-label={`Use profile color ${color}`} onClick={() => onChange(color)} />)}<label className={`group relative grid size-9 cursor-pointer place-items-center rounded-full border transition ${!isPreset ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-950" : "border-zinc-700 hover:border-amber-400/70"}`} style={{ backgroundColor: value }}><Palette size={14} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" /><span className="sr-only">Choose custom profile color</span><input className="absolute inset-0 size-full cursor-pointer opacity-0" type="color" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} aria-label="Choose custom profile color" /></label><span className="text-xs tabular-nums text-zinc-500">{value.toUpperCase()} · {!isPreset ? "Custom" : "Choose custom"}</span></div></div>
}

export interface CreateProfileValues {
  name: string
  isKids: boolean
  copyAddons: boolean
  usesPrimaryAddons: boolean
  avatarColor: string | null
  avatarUrl: string | null
}

export const PROFILE_COLORS = [
  "#FFC107", "#FF8F00", "#E53935", "#8E24AA",
  "#3949AB", "#039BE5", "#00897B", "#43A047",
]

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
