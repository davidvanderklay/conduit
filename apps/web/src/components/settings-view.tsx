import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Database, Download, Monitor, Save, Upload, UserRound } from "lucide-react"
import { api, type Profile } from "../lib/api"
import { isDesktop, prepareNativeTextSave } from "../lib/desktop"
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
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [importData, setImportData] = useState<Record<string, unknown> | null>(null)
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge")
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [dataError, setDataError] = useState("")
  const [dataBusy, setDataBusy] = useState(false)
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
        <div className="grid min-w-0 gap-6">
          <SettingsCard icon={UserRound} title="Profile" scope="Synced">
            <form
              className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
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

          <SettingsCard icon={Database} title="Your data" scope="Portable">
            <p className="text-sm leading-6 text-zinc-400">
              Move this profile between Conduit servers. Exports include the profile, library,
              watch history and add-on order.
            </p>
            <label className="mt-4 flex items-start gap-2 text-sm text-zinc-400">
              <input
                className="mt-1"
                type="checkbox"
                checked={includeSecrets}
                onChange={(event) => setIncludeSecrets(event.target.checked)}
              />
              <span>
                Include add-on URLs for a complete transfer
                <span className="mt-1 block text-xs text-amber-300">
                  URLs can contain credentials. Store and share this file securely.
                </span>
              </span>
            </label>
            <Button
              className="mt-4"
              variant="secondary"
              disabled={dataBusy}
              onClick={async () => {
                setDataBusy(true)
                setDataError("")
                try {
                  const save = await prepareJsonSave(`conduit-${safeFilename(profile.name)}.json`)
                  if (!save) return
                  const data = await api<Record<string, unknown>>(
                    `/v1/profiles/${profile.id}/export?includeSecrets=${includeSecrets}`,
                  )
                  data.preferences = preferences
                  await save(data)
                } catch (error) {
                  setDataError(error instanceof Error ? error.message : "Export failed")
                } finally {
                  setDataBusy(false)
                }
              }}
            >
              <Download size={15} /> Export profile
            </Button>

            <div className="my-5 border-t border-zinc-800" />
            <label className="block text-sm text-zinc-400">
              Import a Conduit JSON file
              <Input
                className="mt-2 file:mr-3 file:border-0 file:bg-transparent file:text-zinc-300"
                type="file"
                accept="application/json,.json"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  setDataBusy(true)
                  setDataError("")
                  setImportPreview(null)
                  try {
                    if (file.size > 10 * 1024 * 1024) throw new Error("Import exceeds the 10 MiB limit")
                    const data = JSON.parse(await file.text()) as Record<string, unknown>
                    const preview = await api<ImportPreview>(
                      `/v1/profiles/${profile.id}/import/preview`,
                      { method: "POST", body: JSON.stringify(data) },
                    )
                    setImportData(data)
                    setImportPreview(preview)
                  } catch (error) {
                    setImportData(null)
                    setDataError(error instanceof Error ? error.message : "Invalid import")
                  } finally {
                    setDataBusy(false)
                  }
                }}
              />
            </label>
            {importPreview && (
              <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
                <p className="font-medium">{importPreview.profile.name}</p>
                <p className="mt-1 text-zinc-500">
                  {importPreview.counts.library} library · {importPreview.counts.progress} history ·{" "}
                  {importPreview.importableAddons}/{importPreview.counts.addons} add-ons importable
                </p>
                {importPreview.warnings.map((warning) => (
                  <p className="mt-2 text-amber-300" key={warning}>{warning}</p>
                ))}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <select
                    className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm"
                    value={importMode}
                    onChange={(event) => setImportMode(event.target.value as "merge" | "replace")}
                  >
                    <option value="merge">Merge with existing data</option>
                    <option value="replace">Replace existing data</option>
                  </select>
                  <Button
                    variant={importMode === "replace" ? "destructive" : "default"}
                    disabled={dataBusy}
                    onClick={async () => {
                      if (!importData) return
                      setDataBusy(true)
                      setDataError("")
                      try {
                        await api(`/v1/profiles/${profile.id}/import`, {
                          method: "POST",
                          body: JSON.stringify({ mode: importMode, data: importData }),
                        })
                        if (isRecord(importData.preferences)) {
                          const next = importedPreferences(preferences, importData.preferences)
                          setPreferences(next)
                          writePreferences(next)
                        }
                        await queryClient.invalidateQueries()
                        setImportPreview(null)
                        setImportData(null)
                      } catch (error) {
                        setDataError(error instanceof Error ? error.message : "Import failed")
                      } finally {
                        setDataBusy(false)
                      }
                    }}
                  >
                    <Upload size={15} /> Import {importMode === "replace" ? "and replace" : "and merge"}
                  </Button>
                </div>
              </div>
            )}
            {dataError && <p className="mt-3 text-sm text-red-400">{dataError}</p>}
          </SettingsCard>
        </div>

        <div className="grid min-w-0 gap-6">
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
      </div>
    </ViewShell>
  )
}

interface ImportPreview {
  profile: { name: string; isKids: boolean }
  counts: { library: number; progress: number; addons: number }
  importableAddons: number
  warnings: string[]
}

type JsonSaver = (data: unknown) => Promise<void>

interface SaveFileHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>
    close(): Promise<void>
  }>
}

async function prepareJsonSave(filename: string): Promise<JsonSaver | null> {
  if (isDesktop()) {
    const save = await prepareNativeTextSave(filename)
    return save ? async (data) => save(JSON.stringify(data, null, 2)) : null
  }

  const picker = (
    window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string
        types: Array<{ description: string; accept: Record<string, string[]> }>
      }) => Promise<SaveFileHandle>
    }
  ).showSaveFilePicker

  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName: filename,
        types: [{ description: "Conduit profile export", accept: { "application/json": [".json"] } }],
      })
      return async (data) => {
        const writable = await handle.createWritable()
        await writable.write(jsonBlob(data))
        await writable.close()
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null
      throw error
    }
  }

  return async (data) => {
    const url = URL.createObjectURL(jsonBlob(data))
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }
}

function jsonBlob(data: unknown) {
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
}

function safeFilename(value: string) {
  return value.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "profile"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function importedPreferences(
  current: DevicePreferences,
  value: Record<string, unknown>,
): DevicePreferences {
  return {
    audioLanguage: typeof value.audioLanguage === "string" ? value.audioLanguage : current.audioLanguage,
    subtitleLanguage: typeof value.subtitleLanguage === "string" ? value.subtitleLanguage : current.subtitleLanguage,
    subtitleSize: boundedNumber(value.subtitleSize, current.subtitleSize, 75, 200),
    autoplay: typeof value.autoplay === "boolean" ? value.autoplay : current.autoplay,
    volume: boundedNumber(value.volume, current.volume, 0, 100),
    hardwareAcceleration: typeof value.hardwareAcceleration === "boolean" ? value.hardwareAcceleration : current.hardwareAcceleration,
    resumeBehavior: ["ask", "always", "restart"].includes(String(value.resumeBehavior))
      ? value.resumeBehavior as DevicePreferences["resumeBehavior"]
      : current.resumeBehavior,
    theme: ["dark", "system"].includes(String(value.theme))
      ? value.theme as DevicePreferences["theme"]
      : current.theme,
    reducedMotion: typeof value.reducedMotion === "boolean" ? value.reducedMotion : current.reducedMotion,
  }
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback
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
