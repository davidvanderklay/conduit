import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Monitor, Save, UserRound } from "lucide-react"
import { api, type Profile } from "../lib/api"
import {
  readPreferences,
  writePreferences,
  type DevicePreferences,
} from "../lib/preferences"
import { ViewShell } from "./addons-view"
import { Button } from "./ui/button"
import { Card } from "./ui/card"
import { Input } from "./ui/input"

export function SettingsView({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient()
  const [preferences, setPreferences] = useState<DevicePreferences>(readPreferences)
  const [saved, setSaved] = useState(false)
  const updateProfile = useMutation({
    mutationFn: (values: { name: string; isKids: boolean }) =>
      api(`/v1/profiles/${profile.id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
  })

  const update = <K extends keyof DevicePreferences>(key: K, value: DevicePreferences[K]) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    writePreferences(next)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1200)
  }

  return (
    <ViewShell
      eyebrow="Profile & device"
      title="Settings"
      description="Profile changes synchronize with your household. Playback and appearance preferences stay on this device."
    >
      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <SettingsCard icon={UserRound} title="Profile" scope="Synced">
          <form
            className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              updateProfile.mutate({
                name: String(data.get("name")),
                isKids: data.get("isKids") === "on",
              })
            }}
          >
            <label className="text-sm text-zinc-400">
              Display name
              <Input className="mt-2" name="name" defaultValue={profile.name} required />
            </label>
            <label className="flex h-11 items-center gap-2 text-sm text-zinc-400">
              <input type="checkbox" name="isKids" defaultChecked={profile.isKids} />
              Kids profile
            </label>
            <Button disabled={updateProfile.isPending}><Save size={15} /> Save</Button>
          </form>
          {updateProfile.error && <p className="mt-3 text-sm text-red-400">{updateProfile.error.message}</p>}
        </SettingsCard>

        <SettingsCard icon={Monitor} title="Playback & appearance" scope="This device">
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectSetting label="Preferred audio" value={preferences.audioLanguage} onChange={(value) => update("audioLanguage", value)} />
            <SelectSetting label="Preferred subtitles" value={preferences.subtitleLanguage} onChange={(value) => update("subtitleLanguage", value)} />
            <SelectSetting label="Resume behavior" value={preferences.resumeBehavior} options={[["ask", "Ask every time"], ["always", "Always resume"], ["restart", "Start over"]]} onChange={(value) => update("resumeBehavior", value as DevicePreferences["resumeBehavior"])} />
            <SelectSetting label="Theme" value={preferences.theme} options={[["dark", "Dark"], ["system", "System"]]} onChange={(value) => update("theme", value as DevicePreferences["theme"])} />
            <RangeSetting label={`Default volume · ${preferences.volume}%`} value={preferences.volume} min={0} max={100} onChange={(value) => update("volume", value)} />
            <RangeSetting label={`Subtitle size · ${preferences.subtitleSize}%`} value={preferences.subtitleSize} min={75} max={200} onChange={(value) => update("subtitleSize", value)} />
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Toggle label="Autoplay next episode" checked={preferences.autoplay} onChange={(value) => update("autoplay", value)} />
            <Toggle label="Hardware acceleration" checked={preferences.hardwareAcceleration} onChange={(value) => update("hardwareAcceleration", value)} />
            <Toggle label="Reduced motion" checked={preferences.reducedMotion} onChange={(value) => update("reducedMotion", value)} />
          </div>
          {saved && <p className="mt-4 text-xs text-emerald-300">Saved on this device</p>}
        </SettingsCard>

        <SettingsCard icon={Monitor} title="About" scope="Device">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-zinc-600">Application</dt><dd className="mt-1">Conduit</dd></div>
            <div><dt className="text-zinc-600">Client</dt><dd className="mt-1">{navigator.userAgent.includes("Tauri") ? "Desktop" : "Web"}</dd></div>
          </dl>
        </SettingsCard>
      </div>
    </ViewShell>
  )
}

function SettingsCard({ icon: Icon, title, scope, children }: { icon: typeof Monitor; title: string; scope: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-lg bg-zinc-800 text-zinc-300"><Icon size={18} /></div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <span className="ml-auto rounded-full border border-zinc-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{scope}</span>
      </div>
      {children}
    </Card>
  )
}

function SelectSetting({ label, value, onChange, options = [["auto", "Automatic"], ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["ja", "Japanese"]] }: { label: string; value: string; onChange: (value: string) => void; options?: string[][] }) {
  return <label className="text-sm text-zinc-400">{label}<select className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-zinc-100 outline-none focus:border-amber-400" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([option, name]) => <option value={option} key={option}>{name}</option>)}</select></label>
}

function RangeSetting({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="text-sm text-zinc-400">{label}<input className="mt-4 w-full accent-amber-400" type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center justify-between rounded-xl border border-zinc-800 p-3 text-sm text-zinc-300">{label}<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>
}
