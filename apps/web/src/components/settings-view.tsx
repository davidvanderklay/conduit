import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BadgeInfo,
  Check,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  Eye,
  Film,
  Gauge,
  Heart,
  KeyRound,
  Link2,
  LogOut,
  Palette,
  PlayCircle,
  Puzzle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  UserRound,
  Pencil,
  Plus,
  X,
  type LucideIcon,
} from "lucide-react"
import { api, type Profile } from "../lib/api"
import { API_URL, authClient } from "../lib/auth"
import { isDesktop, prepareNativeTextSave } from "../lib/desktop"
import {
  readPreferences,
  writePreferences,
  type DevicePreferences,
} from "../lib/preferences"
import { serverDisplayName as formatServerDisplayName } from "../lib/server"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import type { AppSection } from "./app-sidebar"
import { PROFILE_COLORS, ProfileAvatar, ProfileColorPicker } from "./profile-switcher"

type SettingsPage =
  | "profile"
  | "account"
  | "appearance"
  | "content"
  | "playback"
  | "integrations"
  | "data"
  | "about"
  | "advanced"

interface SettingsEntry {
  id: SettingsPage
  group: "Account" | "General" | "About" | "Advanced"
  title: string
  description: string
  keywords: string
  icon: LucideIcon
}

const settingsEntries: SettingsEntry[] = [
  { id: "profile", group: "Account", title: "Profile", description: "Identity and viewing profile", keywords: "name kids household", icon: UserRound },
  { id: "account", group: "Account", title: "Account & security", description: "Sign-in, password, and recovery", keywords: "login oauth codes sign out", icon: ShieldCheck },
  { id: "appearance", group: "General", title: "Appearance & layout", description: "Theme, motion, and display", keywords: "amoled black animation language", icon: Palette },
  { id: "content", group: "General", title: "Content & discovery", description: "Add-ons, catalogs, and search", keywords: "sources stremio home", icon: Puzzle },
  { id: "playback", group: "General", title: "Playback", description: "Player, subtitles, and behavior", keywords: "audio language autoplay volume resume stream source auto select", icon: PlayCircle },
  { id: "integrations", group: "General", title: "Integrations", description: "Connected media services", keywords: "trakt debrid metadata", icon: Link2 },
  { id: "data", group: "General", title: "Your data", description: "Import, export, and portability", keywords: "backup transfer json library history", icon: Database },
  { id: "about", group: "About", title: "About conduit", description: "Project, privacy, and licenses", keywords: "contributors supporters attribution version", icon: BadgeInfo },
  { id: "advanced", group: "Advanced", title: "Advanced settings", description: "Performance and diagnostics", keywords: "cache hardware read ahead debug server", icon: SlidersHorizontal },
]

const groups: SettingsEntry["group"][] = ["Account", "General", "About", "Advanced"]

function serverDisplayName(): string {
  return formatServerDisplayName(API_URL)
}

export function SettingsView({ profile, profiles, householdId, onSelectProfile, onNavigate, onSignedOut }: { profile: Profile; profiles: Profile[]; householdId: string; onSelectProfile: (profileId: string) => void; onNavigate: (section: AppSection) => void; onSignedOut: () => void }) {
  const [page, setPage] = useState<SettingsPage>("profile")
  const [query, setQuery] = useState("")
  const [preferences, setPreferences] = useState<DevicePreferences>(readPreferences)
  const [saved, setSaved] = useState(false)

  const update = <K extends keyof DevicePreferences>(key: K, value: DevicePreferences[K]) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    writePreferences(next)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1200)
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle
      ? settingsEntries.filter((entry) =>
          `${entry.group} ${entry.title} ${entry.description} ${entry.keywords}`.toLowerCase().includes(needle),
        )
      : settingsEntries
  }, [query])
  const active = settingsEntries.find((entry) => entry.id === page)!

  return (
    <main className="w-full px-4 py-7 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
      <div className="mb-7 flex items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">Profile & device</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-zinc-500">Personalize conduit and manage your account from one place.</p>
        </div>
        {saved && <span className="hidden items-center gap-2 rounded-full border border-emerald-900/70 bg-emerald-950/50 px-3 py-1.5 text-xs text-emerald-300 sm:flex"><Check size={13} /> Saved on this device</span>}
      </div>

      <div className="grid min-h-[calc(100vh-11rem)] gap-7 sm:grid-cols-[16rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="border-b border-zinc-800 pb-5 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-5 lg:pr-7">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
            <input
              className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/80 pl-10 pr-9 text-sm outline-none transition focus:border-amber-400/70 focus:ring-2 focus:ring-amber-400/10"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
            />
            {query && <button className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-white" onClick={() => setQuery("")} aria-label="Clear settings search"><X size={14} /></button>}
          </div>

          <nav className="mt-4 pr-1" aria-label="Settings categories">
            {groups.map((group) => {
              const entries = filtered.filter((entry) => entry.group === group)
              if (!entries.length) return null
              return <div className="mb-5" key={group}>
                <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">{group}</p>
                <div className="space-y-1">
                  {entries.map((entry) => <SettingsNavItem key={entry.id} entry={entry} active={page === entry.id} onClick={() => setPage(entry.id)} />)}
                </div>
              </div>
            })}
            {!filtered.length && <p className="px-3 py-8 text-center text-sm text-zinc-600">No settings match “{query}”.</p>}
          </nav>
        </aside>

        <section className="min-w-0">
          <header className="pb-7">
            <div className="flex items-center gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-amber-400/15 bg-amber-400/10 text-amber-300"><active.icon size={21} /></div>
              <div><h2 className="font-display text-xl font-semibold sm:text-2xl">{active.title}</h2><p className="mt-1 text-sm text-zinc-500">{active.description}</p></div>
            </div>
          </header>
          <div className="w-full">
            {page === "profile" && <ProfileSettings profile={profile} profiles={profiles} householdId={householdId} onSelectProfile={onSelectProfile} />}
            {page === "account" && <AccountSettings onSignedOut={onSignedOut} />}
            {page === "appearance" && <AppearanceSettings preferences={preferences} update={update} />}
            {page === "content" && <ContentSettings onAddons={() => onNavigate("addons")} />}
            {page === "playback" && <PlaybackSettings preferences={preferences} update={update} />}
            {page === "integrations" && <IntegrationsSettings />}
            {page === "data" && <DataSettings profile={profile} preferences={preferences} onPreferences={setPreferences} />}
            {page === "about" && <AboutSettings />}
            {page === "advanced" && <AdvancedSettings preferences={preferences} update={update} profile={profile} />}
          </div>
        </section>
      </div>
    </main>
  )
}

function SettingsNavItem({ entry, active, onClick }: { entry: SettingsEntry; active: boolean; onClick: () => void }) {
  const Icon = entry.icon
  return <button className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? "bg-amber-400/12 text-zinc-100 ring-1 ring-inset ring-amber-400/10" : "text-zinc-400 hover:bg-white/[.045] hover:text-zinc-100"}`} onClick={onClick} aria-current={active ? "page" : undefined}>
    <Icon className={active ? "text-amber-300" : "text-zinc-600 group-hover:text-zinc-400"} size={17} />
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.title}</span><span className="mt-0.5 block truncate text-[11px] text-zinc-600">{entry.description}</span></span>
    <ChevronRight className={active ? "text-amber-400/70" : "text-zinc-700"} size={15} />
  </button>
}

function ProfileSettings({ profile, profiles, householdId, onSelectProfile }: { profile: Profile; profiles: Profile[]; householdId: string; onSelectProfile: (profileId: string) => void }) {
  const [editing, setEditing] = useState<Profile | null>(profile)
  return <div className="space-y-7">
    <SettingsGroup title="PROFILES" description="Create a new space or choose one to customize.">
      <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {profiles.map((candidate) => (
          <button key={candidate.id} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${editing?.id === candidate.id ? "border-amber-400/40 bg-amber-400/10" : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"}`} onClick={() => setEditing(candidate)}>
            <ProfileAvatar profile={candidate} className="size-11" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{candidate.name}</span><span className="mt-1 block text-xs text-zinc-500">{candidate.isKids ? "Kids profile" : candidate.usesPrimaryAddons ? "Uses primary add-ons" : "Personal profile"}</span></span>
            <Pencil size={14} className="text-zinc-600" />
          </button>
        ))}
        <button className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-700 p-3 text-left text-zinc-400 transition hover:border-amber-400/40 hover:bg-amber-400/5 hover:text-white" onClick={() => setEditing(null)}><span className="grid size-11 place-items-center rounded-full bg-zinc-800"><Plus size={18} /></span><span><span className="block text-sm font-semibold">Add profile</span><span className="mt-1 block text-xs text-zinc-600">Create another space</span></span></button>
      </div>
    </SettingsGroup>
    <ProfileEditorForm key={editing?.id ?? "new"} editing={editing} profiles={profiles} householdId={householdId} onSelectProfile={onSelectProfile} />
  </div>
}

function ProfileEditorForm({ editing, profiles, householdId, onSelectProfile }: { editing: Profile | null; profiles: Profile[]; householdId: string; onSelectProfile: (profileId: string) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(editing?.name ?? "")
  const [isKids, setIsKids] = useState(editing?.isKids ?? false)
  const [usesPrimaryAddons, setUsesPrimaryAddons] = useState(editing?.usesPrimaryAddons ?? false)
  const [avatarColor, setAvatarColor] = useState(editing?.avatarColor ?? PROFILE_COLORS[0]!)
  const [avatarUrl, setAvatarUrl] = useState(editing?.avatarUrl ?? "")
  const [avatarMode, setAvatarMode] = useState<"color" | "image">(editing?.avatarUrl ? "image" : "color")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const primary = profiles[0]
  const canUsePrimary = !editing || editing.id !== primary?.id
  const preview: Profile = { id: editing?.id ?? "new", name: name.trim() || "New profile", isKids, usesPrimaryAddons, avatarColor: avatarMode === "color" ? avatarColor : null, avatarUrl: avatarMode === "image" ? avatarUrl.trim() || null : null }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanUrl = avatarMode === "image" ? avatarUrl.trim() : ""
    if (cleanUrl && !/^https?:\/\//i.test(cleanUrl)) { setError("Avatar URL must begin with http:// or https://"); return }
    setPending(true); setError("")
    try {
      const body = { name: name.trim(), isKids, usesPrimaryAddons: canUsePrimary && usesPrimaryAddons, avatarColor: avatarMode === "color" ? avatarColor : null, avatarUrl: cleanUrl || null }
      const result = editing
        ? await api<{ profile: Profile }>(`/v1/profiles/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<{ profile: Profile }>(`/v1/households/${householdId}/profiles`, { method: "POST", body: JSON.stringify({ ...body, avatarColor: avatarMode === "color" ? avatarColor : undefined, avatarUrl: cleanUrl || undefined }) })
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] })
      if (!editing) onSelectProfile(result.profile.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save profile") } finally { setPending(false) }
  }

  return <SettingsGroup title={editing ? "EDIT PROFILE" : "ADD PROFILE"} description="Profile appearance and add-on behavior sync across devices.">
    <form className="grid gap-6 p-5 lg:grid-cols-[15rem_minmax(0,1fr)] 2xl:grid-cols-[18rem_minmax(0,1fr)]" onSubmit={save}>
      <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950/50 p-6 text-center"><ProfileAvatar profile={preview} className="size-28 text-3xl" /><p className="mt-4 max-w-full truncate font-display text-xl font-semibold">{preview.name}</p><p className="mt-1 text-xs text-zinc-500">{isKids ? "Kids profile" : "Personal profile"}</p></div>
      <div className="space-y-5">
        <label className="block text-sm font-medium text-zinc-300">Profile name<Input className="mt-2 max-w-2xl" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <div className="grid gap-3 xl:grid-cols-2"><ProfileOptionCard title="Kids profile" description="Use a child-friendly viewing profile." checked={isKids} onChange={setIsKids} />{canUsePrimary && <ProfileOptionCard title="Use primary add-ons" description={`Share ${primary?.name ?? "the primary profile"}'s live add-on setup.`} checked={usesPrimaryAddons} onChange={setUsesPrimaryAddons} />}</div>
        <div><p className="text-sm font-medium text-zinc-300">Avatar</p><div className="mt-2 inline-flex rounded-xl border border-zinc-800 bg-zinc-950 p-1"><button type="button" className={`rounded-lg px-3 py-2 text-sm ${avatarMode === "color" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-white"}`} onClick={() => setAvatarMode("color")}>Profile color</button><button type="button" className={`rounded-lg px-3 py-2 text-sm ${avatarMode === "image" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-white"}`} onClick={() => setAvatarMode("image")}>Custom image</button></div></div>
        {avatarMode === "color" ? <ProfileColorPicker value={avatarColor} onChange={setAvatarColor} /> : <label className="block text-sm font-medium text-zinc-300">Custom image URL<Input className="mt-2 max-w-2xl" type="url" placeholder="https://example.com/avatar.png" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} /></label>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button disabled={pending || !name.trim()}>{pending ? "Saving…" : editing ? "Save changes" : "Create profile"}</Button>
      </div>
    </form>
  </SettingsGroup>
}

function ProfileOptionCard({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"><span><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span></span><input className="size-4 accent-amber-400" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label> }

function AppearanceSettings({ preferences, update }: PreferencePageProps) {
  return <div className="grid items-start gap-7 2xl:grid-cols-2">
    <SettingsGroup title="THEME"><SettingRow icon={Palette} title="Theme" description="Choose how conduit follows your desktop appearance"><Select value={preferences.theme} onChange={(value) => update("theme", value as DevicePreferences["theme"])} options={[["dark", "conduit dark"], ["system", "System default"]]} /></SettingRow><Divider /><SettingToggle label="AMOLED black" description="Use pure black backgrounds throughout the app." checked={preferences.amoledBlack} onChange={(value) => update("amoledBlack", value)} /></SettingsGroup>
    <SettingsGroup title="DISPLAY"><SettingToggle label="Reduce animations" description="Use simpler transitions and less interface motion." checked={preferences.reducedMotion} onChange={(value) => update("reducedMotion", value)} /><Divider /><SettingRow icon={Eye} title="App language" description="conduit currently follows your system language"><span className="text-sm text-zinc-500">System default</span></SettingRow></SettingsGroup>
  </div>
}

function PlaybackSettings({ preferences, update }: PreferencePageProps) {
  return <div className="grid items-start gap-7 2xl:grid-cols-2">
    <div className="space-y-7"><SettingsGroup title="PLAYER"><SettingRow icon={PlayCircle} title="Resume behavior" description="What to do when opening something partially watched"><Select value={preferences.resumeBehavior} onChange={(value) => update("resumeBehavior", value as DevicePreferences["resumeBehavior"])} options={[["ask", "Ask every time"], ["always", "Always resume"], ["restart", "Start over"]]} /></SettingRow><Divider /><SettingToggle label="Auto-select saved streams" description="Reuse the last selected stream when it is available." checked={preferences.autoSelectSavedStreams} onChange={(value) => update("autoSelectSavedStreams", value)} /><Divider /><RangeRow label="Default volume" description="Starting player volume" value={preferences.volume} min={0} max={100} suffix="%" onChange={(value) => update("volume", value)} /></SettingsGroup><SettingsGroup title="AUTOPLAY"><SettingToggle label="Autoplay next episode" description="Continue after the next-episode prompt." checked={preferences.autoplay} onChange={(value) => update("autoplay", value)} /></SettingsGroup></div>
    <SettingsGroup title="AUDIO & SUBTITLES"><SettingRow icon={Film} title="Preferred audio language" description="Automatically select a matching audio track"><LanguageSelect value={preferences.audioLanguage} onChange={(value) => update("audioLanguage", value)} /></SettingRow><Divider /><SettingRow icon={Film} title="Preferred subtitle language" description="Automatically select matching subtitles"><LanguageSelect value={preferences.subtitleLanguage} onChange={(value) => update("subtitleLanguage", value)} /></SettingRow><Divider /><SettingToggle label="Subtitle outline" description="Add a dark edge for readability on bright scenes." checked={preferences.subtitleOutline} onChange={(value) => update("subtitleOutline", value)} /><Divider /><RangeRow label="Subtitle size" description="Scale subtitles relative to their authored size" value={preferences.subtitleSize} min={75} max={200} suffix="%" onChange={(value) => update("subtitleSize", value)} /><Divider /><RangeRow label="Subtitle position" description="Vertical position within the player" value={preferences.subtitlePosition} min={10} max={100} suffix="%" onChange={(value) => update("subtitlePosition", value)} /></SettingsGroup>
  </div>
}

function ContentSettings({ onAddons }: { onAddons: () => void }) {
  return <div className="grid gap-7 2xl:grid-cols-2"><SettingsGroup title="SOURCES"><button className="flex w-full items-center gap-4 p-5 text-left transition hover:bg-white/[.035]" onClick={onAddons}><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-400"><Puzzle size={17} /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium text-zinc-200">Add-ons</p><p className="mt-1 text-xs leading-5 text-zinc-500">Install, order, and manage Stremio add-ons.</p></div><ChevronRight className="text-zinc-600" size={17} /></button></SettingsGroup><SettingsGroup title="DISCOVERY"><InfoAction icon={Search} title="Catalog customization" description="Catalog ordering and home customization are coming next." muted /></SettingsGroup></div>
}

function IntegrationsSettings() {
  return <SettingsGroup title="CONNECTED SERVICES"><InfoAction icon={Link2} title="Stremio add-ons" description="conduit uses the add-ons installed for your active profile directly." /><Divider /><InfoAction icon={Gauge} title="Trakt, debrid, and metadata services" description="These will appear here once secure credential storage and synchronization are implemented." muted /></SettingsGroup>
}

function AboutSettings() {
  return <div className="space-y-7"><SettingsGroup title="ABOUT"><InfoAction icon={Heart} title="Supporters & contributors" description="conduit is open source and built by its community." href="https://github.com/davidvanderklay/conduit" /><Divider /><InfoAction icon={ShieldCheck} title="Privacy policy" description="Your account, profile, library, and viewing data stay on the server you choose." href="https://github.com/davidvanderklay/conduit#data-and-privacy-model" /><Divider /><InfoAction icon={BadgeInfo} title="Licenses & attribution" description="conduit is MIT licensed and includes open-source software listed in THIRD_PARTY_NOTICES.md." href="https://github.com/davidvanderklay/conduit/blob/main/THIRD_PARTY_NOTICES.md" /></SettingsGroup><SettingsGroup title="APPLICATION"><div className="grid gap-4 p-5 text-sm sm:grid-cols-2"><Stat label="Application" value="conduit" /><Stat label="Client" value={isDesktop() ? "Desktop" : "Web"} /></div></SettingsGroup></div>
}

function AdvancedSettings({ preferences, update, profile }: PreferencePageProps & { profile: Profile }) {
  return <div className="space-y-7"><SettingsGroup title="STARTUP"><SettingToggle label="Remember last profile" description="Return to the profile last used on this device." checked={preferences.rememberLastProfile} onChange={(value) => update("rememberLastProfile", value)} /></SettingsGroup><SettingsGroup title="PERFORMANCE"><SettingToggle label="Desktop hardware acceleration" description="Use the GPU decoder exposed by libmpv when available." checked={preferences.hardwareAcceleration} onChange={(value) => update("hardwareAcceleration", value)} /><Divider /><RangeRow label="Network read-ahead" description="Bounded temporary memory for smoother playback" value={preferences.readAheadSeconds} min={10} max={120} step={10} suffix="s" onChange={(value) => update("readAheadSeconds", value)} /></SettingsGroup><SettingsGroup title="CACHE"><InfoAction icon={Database} title="Continue Watching cache" description="Viewing progress comes directly from your server; there is no separate local cache to clear." muted /></SettingsGroup><SettingsGroup title="DIAGNOSTICS"><SettingToggle label="Debug logging" description="Collect additional local diagnostic information." checked={preferences.debugLogging} onChange={(value) => update("debugLogging", value)} /><Divider /><div className="grid gap-4 p-5 text-sm sm:grid-cols-2"><Stat label="Client" value={isDesktop() ? "Desktop" : "Web"} /><Stat label="Profile" value={profile.name} /><Stat label="Server" value={serverDisplayName()} /><Stat label="Debug logging" value={preferences.debugLogging ? "Enabled" : "Disabled"} /></div></SettingsGroup></div>
}

interface PreferencePageProps { preferences: DevicePreferences; update: <K extends keyof DevicePreferences>(key: K, value: DevicePreferences[K]) => void }

function AccountSettings({ onSignedOut }: { onSignedOut: () => void }) {
  const [password, setPassword] = useState("")
  const [codes, setCodes] = useState<string[]>([])
  const [message, setMessage] = useState("")
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api<{ passwordEnabled: boolean; linkedProviders: string[]; configuredProviderName: string | null }>("/v1/auth/methods") })
  const generateCodes = async () => { if (!window.confirm("Replace any existing recovery codes with a new set?")) return; try { const result = await api<{ codes: string[] }>("/v1/auth/recovery-codes", { method: "POST" }); setCodes(result.codes) } catch (error) { setMessage(error instanceof Error ? error.message : "Could not generate codes") } }
  return <div className="space-y-7"><SettingsGroup title="STATUS"><div className="flex items-center gap-4 p-5"><div className="grid size-10 place-items-center rounded-full bg-emerald-400/10 text-emerald-300"><ShieldCheck size={19} /></div><div><p className="font-medium">Signed in</p><p className="mt-1 text-sm text-zinc-500">Server: {serverDisplayName()}</p></div></div></SettingsGroup><SettingsGroup title="SECURITY"><div className="p-5"><div className="flex flex-wrap gap-2 text-xs"><Pill enabled={Boolean(methods.data?.passwordEnabled)}>Password {methods.data?.passwordEnabled ? "enabled" : "disabled"}</Pill>{methods.data?.linkedProviders.map((provider) => <Pill enabled key={provider}>{provider} connected</Pill>)}</div>{methods.data && !methods.data.passwordEnabled && <form className="mt-5 flex max-w-xl gap-2" onSubmit={async (event) => { event.preventDefault(); await api("/v1/auth/password-mode", { method: "PUT", body: JSON.stringify({ enabled: true, password }) }); setPassword(""); await methods.refetch() }}><Input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New local password" required /><Button>Enable</Button></form>}{methods.data?.passwordEnabled && methods.data.linkedProviders.length > 0 && <Button className="mt-5" variant="destructive" onClick={async () => { if (!window.confirm("Disable local password login?")) return; await api("/v1/auth/password-mode", { method: "PUT", body: JSON.stringify({ enabled: false }) }); await methods.refetch() }}>Disable password</Button>}</div><Divider /><div className="p-5"><p className="font-medium">Recovery codes</p><p className="mt-1 text-sm text-zinc-500">Each code works once. Generating a new set invalidates the old one.</p>{codes.length > 0 && <pre className="mt-4 whitespace-pre-wrap rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-xs leading-6 text-amber-200">{codes.join("\n")}</pre>}<Button className="mt-4" variant="secondary" onClick={() => void generateCodes()}><KeyRound size={15} /> Generate new codes</Button>{message && <p className="mt-3 text-sm text-red-400">{message}</p>}</div></SettingsGroup><SettingsGroup title="SESSION"><div className="p-5"><Button variant="destructive" onClick={async () => { const result = await authClient.signOut(); if (!result.error) onSignedOut() }}><LogOut size={15} /> Sign out</Button></div></SettingsGroup></div>
}

function DataSettings({ profile, preferences, onPreferences }: { profile: Profile; preferences: DevicePreferences; onPreferences: (value: DevicePreferences) => void }) {
  const queryClient = useQueryClient()
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [importData, setImportData] = useState<Record<string, unknown> | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mode, setMode] = useState<"merge" | "replace">("merge")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [importFilename, setImportFilename] = useState("")
  const chooseImport = async (file: File) => {
    setImportFilename(file.name)
    setBusy(true)
    setError("")
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Import exceeds the 10 MiB limit")
      const data = JSON.parse(await file.text()) as Record<string, unknown>
      const result = await api<ImportPreview>(`/v1/profiles/${profile.id}/import/preview`, { method: "POST", body: JSON.stringify(data) })
      setImportData(data)
      setPreview(result)
    } catch (cause) {
      setImportData(null)
      setPreview(null)
      setError(cause instanceof Error ? cause.message : "Invalid import")
    } finally {
      setBusy(false)
    }
  }
  return <div className="space-y-7">
    <SettingsGroup title="EXPORT" description="Move this profile between conduit servers.">
      <div className="p-5"><p className="text-sm leading-6 text-zinc-400">Exports include the profile, library, watch history, add-on order, and device preferences.</p><label className="mt-4 flex max-w-2xl items-start gap-3 text-sm text-zinc-400"><input className="mt-1 accent-amber-400" type="checkbox" checked={includeSecrets} onChange={(event) => setIncludeSecrets(event.target.checked)} /><span>Include add-on URLs<span className="mt-1 block text-xs text-amber-300">URLs can contain credentials. Store this file securely.</span></span></label><Button className="mt-5" variant="secondary" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const save = await prepareJsonSave(`conduit-${safeFilename(profile.name)}.json`); if (!save) return; const data = await api<Record<string, unknown>>(`/v1/profiles/${profile.id}/export?includeSecrets=${includeSecrets}`); data.preferences = preferences; await save(data) } catch (cause) { setError(cause instanceof Error ? cause.message : "Export failed") } finally { setBusy(false) } }}><Download size={15} /> Export profile</Button></div>
    </SettingsGroup>
    <SettingsGroup title="IMPORT" description="Preview changes before applying them.">
      <div className="p-5">
        <label className="flex max-w-3xl cursor-pointer items-center gap-4 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/50 p-4 transition hover:border-amber-400/50 hover:bg-amber-400/[.03]">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-zinc-800 text-zinc-300"><Upload size={19} /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-zinc-200">{importFilename || "Choose a conduit export"}</span><span className="mt-1 block text-xs text-zinc-500">JSON files up to 10 MiB · changes are previewed first</span></span>
          <span className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200">Browse</span>
          <input className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseImport(file) }} />
        </label>
        {preview && <div className="mt-5 max-w-3xl rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm"><p className="font-medium">{preview.profile.name}</p><p className="mt-1 text-zinc-500">{preview.counts.library} library · {preview.counts.progress} history · {preview.importableAddons}/{preview.counts.addons} add-ons importable</p>{preview.warnings.map((warning) => <p className="mt-2 text-amber-300" key={warning}>{warning}</p>)}<div className="mt-4 flex flex-wrap gap-3"><Select value={mode} onChange={(value) => setMode(value as "merge" | "replace")} options={[["merge", "Merge with existing"], ["replace", "Replace existing"]]} /><Button variant={mode === "replace" ? "destructive" : "default"} disabled={busy} onClick={async () => { if (!importData) return; setBusy(true); try { await api(`/v1/profiles/${profile.id}/import`, { method: "POST", body: JSON.stringify({ mode, data: importData }) }); if (isRecord(importData.preferences)) { const next = importedPreferences(preferences, importData.preferences); onPreferences(next); writePreferences(next) } await queryClient.invalidateQueries(); setPreview(null); setImportData(null); setImportFilename("") } catch (cause) { setError(cause instanceof Error ? cause.message : "Import failed") } finally { setBusy(false) } }}><Upload size={15} /> Import profile</Button></div></div>}
      </div>
    </SettingsGroup>
    {error && <p className="text-sm text-red-400">{error}</p>}
  </div>
}

function SettingsGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) { return <div><div className="mb-2 px-1"><h3 className="text-[11px] font-bold uppercase tracking-[0.17em] text-amber-400/80">{title}</h3>{description && <p className="mt-1 text-xs text-zinc-600">{description}</p>}</div><div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">{children}</div></div> }
function Divider() { return <div className="mx-5 border-t border-zinc-800/80" /> }
function SettingRow({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) { return <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"><div className="flex min-w-0 flex-1 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-800/80 text-zinc-400"><Icon size={17} /></div><div><p className="text-sm font-medium text-zinc-200">{title}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p></div></div><div className="shrink-0 sm:max-w-xs">{children}</div></div> }
function SettingToggle({ label, description, checked, onChange, defaultChecked, name }: { label: string; description: string; checked?: boolean; onChange?: (value: boolean) => void; defaultChecked?: boolean; name?: string }) {
  const [localChecked, setLocalChecked] = useState(defaultChecked ?? false)
  const enabled = checked ?? localChecked
  return <label className="flex cursor-pointer items-center justify-between gap-6 p-5"><span><span className="block text-sm font-medium text-zinc-200">{label}</span><span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span></span><span className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? "bg-amber-400" : "bg-zinc-700"}`}><input className="peer sr-only" type="checkbox" name={name} checked={enabled} onChange={(event) => { setLocalChecked(event.target.checked); onChange?.(event.target.checked) }} /><span className={`absolute top-1 size-4 rounded-full bg-white shadow transition-all ${enabled ? "left-6" : "left-1"}`} /></span></label>
}
function RangeRow({ label, description, value, min, max, step, suffix, onChange }: { label: string; description: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void }) { return <div className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-zinc-200">{label}</p><p className="mt-1 text-xs text-zinc-500">{description}</p></div><span className="rounded-lg bg-zinc-800 px-2.5 py-1 text-xs font-semibold tabular-nums text-zinc-300">{value}{suffix}</span></div><input className="mt-4 w-full accent-amber-400" type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} /></div> }
function Select({ value, options, onChange }: { value: string; options: string[][]; onChange: (value: string) => void }) { return <select className="h-10 min-w-44 rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200 outline-none focus:border-amber-400" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select> }
function LanguageSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <Select value={value} onChange={onChange} options={[["auto", "System default"], ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["ja", "Japanese"], ["ko", "Korean"]]} /> }
function InfoAction({ icon: Icon, title, description, href, muted }: { icon: LucideIcon; title: string; description: string; href?: string; muted?: boolean }) { const content = <><div className={`grid size-9 shrink-0 place-items-center rounded-lg ${muted ? "bg-zinc-800/40 text-zinc-600" : "bg-zinc-800 text-zinc-400"}`}><Icon size={17} /></div><div className="min-w-0 flex-1"><p className={`text-sm font-medium ${muted ? "text-zinc-500" : "text-zinc-200"}`}>{title}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p></div>{href && <ExternalLink className="text-zinc-600" size={16} />}</>; return href ? <a className="flex items-center gap-4 p-5 transition hover:bg-white/[.025]" href={href} target="_blank" rel="noreferrer">{content}</a> : <div className="flex items-center gap-4 p-5">{content}</div> }
function Stat({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-zinc-600">{label}</p><p className="mt-1 truncate text-zinc-300">{value}</p></div> }
function Pill({ enabled, children }: { enabled: boolean; children: ReactNode }) { return <span className={`rounded-full px-2.5 py-1 ${enabled ? "bg-emerald-950 text-emerald-300" : "bg-zinc-800 text-zinc-500"}`}>{children}</span> }

interface ImportPreview { profile: { name: string; isKids: boolean }; counts: { library: number; progress: number; addons: number }; importableAddons: number; warnings: string[] }
type JsonSaver = (data: unknown) => Promise<void>
interface SaveFileHandle { createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }
async function prepareJsonSave(filename: string): Promise<JsonSaver | null> { if (isDesktop()) { const save = await prepareNativeTextSave(filename); return save ? async (data) => save(JSON.stringify(data, null, 2)) : null } const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<SaveFileHandle> }).showSaveFilePicker; if (picker) { try { const handle = await picker.call(window, { suggestedName: filename, types: [{ description: "conduit profile export", accept: { "application/json": [".json"] } }] }); return async (data) => { const writable = await handle.createWritable(); await writable.write(jsonBlob(data)); await writable.close() } } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return null; throw error } } return async (data) => { const url = URL.createObjectURL(jsonBlob(data)); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url) } }
function jsonBlob(data: unknown) { return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }) }
function safeFilename(value: string) { return value.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "profile" }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function importedPreferences(current: DevicePreferences, value: Record<string, unknown>): DevicePreferences { const next = { ...current }; for (const key of ["audioLanguage", "subtitleLanguage"] as const) if (typeof value[key] === "string") next[key] = value[key]; for (const [key, min, max] of [["subtitleSize", 75, 200], ["subtitlePosition", 10, 100], ["readAheadSeconds", 10, 120], ["volume", 0, 100]] as const) if (typeof value[key] === "number" && Number.isFinite(value[key])) next[key] = Math.max(min, Math.min(max, value[key])); for (const key of ["autoSelectSavedStreams", "autoplay", "hardwareAcceleration", "reducedMotion", "amoledBlack", "subtitleOutline", "rememberLastProfile", "debugLogging"] as const) if (typeof value[key] === "boolean") next[key] = value[key]; if (["ask", "always", "restart"].includes(String(value.resumeBehavior))) next.resumeBehavior = value.resumeBehavior as DevicePreferences["resumeBehavior"]; if (["dark", "system"].includes(String(value.theme))) next.theme = value.theme as DevicePreferences["theme"]; return next }
