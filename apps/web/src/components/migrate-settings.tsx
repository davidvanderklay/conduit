import { useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeft, Download, LogOut } from "lucide-react"
import { api, type Profile } from "../lib/api"
import { cn } from "../lib/utils"
import { Button } from "./ui/button"
import { Input } from "./ui/input"

type Source = "stremio" | "nuvio"

type MigrationSession =
  | { source: "stremio"; authKey: string }
  | { source: "nuvio"; backendUrl: string; publishableKey: string; accessToken: string }

interface MigrationAccount {
  session: MigrationSession
  email?: string
  profiles: Array<{ id: string; name: string }>
}

interface MigrationSnapshot {
  data: {
    library: unknown[]
    progress: Array<{ continueWatching?: boolean }>
    addons: unknown[]
  }
  counts: Record<Category, number>
  warnings: string[]
}

type Category = "library" | "continueWatching" | "watched" | "addons"

const categories: Array<[Category, string]> = [
  ["library", "Library"],
  ["continueWatching", "Continue Watching"],
  ["watched", "Watched"],
  ["addons", "Add-ons"],
]

/**
 * Settings > Your data > Migrate. Signs in to Stremio or Nuvio through the
 * conduit server, reads one source profile, and imports it additively so
 * nothing already in this profile is overwritten.
 */
export function MigrateSettings({
  profile,
  onBackup,
}: {
  profile: Profile
  onBackup: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [source, setSource] = useState<Source>("stremio")
  const [useAuthKey, setUseAuthKey] = useState(false)
  const [customServer, setCustomServer] = useState(false)
  const [account, setAccount] = useState<MigrationAccount>()
  const [sourceProfileId, setSourceProfileId] = useState("")
  const [snapshot, setSnapshot] = useState<MigrationSnapshot>()
  const [include, setInclude] = useState<Record<Category, boolean>>({
    library: true,
    continueWatching: true,
    watched: true,
    addons: true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState("")

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await task()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const read = (session: MigrationSession, profileId: string) =>
    run(async () => {
      setSourceProfileId(profileId)
      setSnapshot(undefined)
      setSnapshot(
        await api<MigrationSnapshot>("/v1/migrations/read", {
          method: "POST",
          body: JSON.stringify({ session, profileId }),
        }),
      )
    })

  const connect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const field = (name: string) => String(form.get(name) ?? "").trim()
    const body =
      source === "stremio" && useAuthKey
        ? { source, authKey: field("authKey") }
        : {
            source,
            email: field("email"),
            password: String(form.get("password") ?? ""),
            ...(source === "nuvio" && customServer && field("backendUrl")
              ? { backendUrl: field("backendUrl") }
              : {}),
          }
    void run(async () => {
      const next = await api<MigrationAccount>("/v1/migrations/connect", {
        method: "POST",
        body: JSON.stringify(body),
      })
      setAccount(next)
      setResult("")
      const only = next.profiles.length === 1 ? next.profiles[0] : undefined
      if (only) await read(next.session, only.id)
    })
  }

  const disconnect = () => {
    setAccount(undefined)
    setSnapshot(undefined)
    setSourceProfileId("")
    setError("")
  }

  const migrate = () =>
    run(async () => {
      if (!snapshot) return
      const data = {
        ...snapshot.data,
        library: include.library ? snapshot.data.library : [],
        progress: snapshot.data.progress.filter((item) =>
          item.continueWatching ? include.continueWatching : include.watched,
        ),
        addons: include.addons ? snapshot.data.addons : [],
      }
      const response = await api<{ added: { library: number; progress: number; addons: number } }>(
        `/v1/profiles/${profile.id}/import`,
        { method: "POST", body: JSON.stringify({ mode: "additive", data }) },
      )
      await queryClient.invalidateQueries()
      const { added } = response
      setResult(
        `Added ${added.library} titles, ${added.progress} progress entries, and ${added.addons} add-ons. Existing items were kept.`,
      )
      setSnapshot(undefined)
      setAccount(undefined)
    })

  const selected = snapshot
    ? categories.reduce((total, [key]) => total + (include[key] ? snapshot.counts[key] : 0), 0)
    : 0

  return (
    <div className="p-5">
      {!account ? (
        <form className="max-w-3xl" onSubmit={connect}>
          <div className="flex flex-wrap items-center gap-4">
            <div
              className="inline-flex overflow-hidden rounded-lg border border-zinc-800"
              role="radiogroup"
              aria-label="Source"
            >
              {(["stremio", "nuvio"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={source === value}
                  className={cn(
                    "px-4 py-2 text-sm",
                    source === value
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                  onClick={() => setSource(value)}
                >
                  {value === "stremio" ? "Stremio" : "Nuvio"}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-300"
              onClick={() =>
                source === "stremio"
                  ? setUseAuthKey((value) => !value)
                  : setCustomServer((value) => !value)
              }
            >
              {source === "stremio"
                ? useAuthKey
                  ? "Use email and password"
                  : "Use auth key instead"
                : customServer
                  ? "Use nuvio.tv"
                  : "Use a self-hosted server"}
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            {source === "stremio" && useAuthKey ? (
              <Input name="authKey" placeholder="Stremio auth key" autoComplete="off" required />
            ) : (
              <>
                {source === "nuvio" && customServer && (
                  <Input
                    name="backendUrl"
                    type="url"
                    placeholder="https://nuvio.example.com"
                    required
                  />
                )}
                <Input name="email" type="email" placeholder="Email" autoComplete="off" required />
                <Input
                  name="password"
                  type="password"
                  placeholder="Password"
                  autoComplete="off"
                  required
                />
              </>
            )}
            <Button type="submit" variant="secondary" disabled={busy}>
              Connect
            </Button>
          </div>
          <p className="mt-3 text-xs text-zinc-600">
            Sign-in details pass through your conduit server once and are not stored. Nothing is
            changed in {source === "stremio" ? "Stremio" : "Nuvio"}.
          </p>
        </form>
      ) : (
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-zinc-300">
              Connected to {account.session.source === "stremio" ? "Stremio" : "Nuvio"}
              {account.email && (
                <>
                  {" "}
                  as <span className="text-zinc-100">{account.email}</span>
                </>
              )}
            </p>
            {account.profiles.length > 1 && (
              <select
                className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200 outline-none focus:border-amber-400"
                aria-label="Nuvio profile"
                value={sourceProfileId}
                disabled={busy}
                onChange={(event) => void read(account.session, event.target.value)}
              >
                <option value="" disabled>
                  Choose a profile
                </option>
                {account.profiles.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
              onClick={disconnect}
            >
              <LogOut size={13} /> Disconnect
            </button>
          </div>
          {busy && !snapshot && <p className="mt-4 text-sm text-zinc-500">Reading account…</p>}
          {snapshot && (
            <>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                {categories.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      className="accent-amber-400"
                      checked={include[key]}
                      onChange={(event) => setInclude({ ...include, [key]: event.target.checked })}
                    />
                    {label}
                    <span className="text-zinc-500">{snapshot.counts[key].toLocaleString()}</span>
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs text-zinc-600">
                Titles and add-ons already in this profile are skipped. Existing progress is only
                replaced by newer progress.
              </p>
              {snapshot.warnings.map((warning) => (
                <p className="mt-2 text-xs text-amber-300" key={warning}>
                  {warning}
                </p>
              ))}
              <div className="mt-4 flex flex-wrap gap-3">
                <Button disabled={busy || selected === 0} onClick={() => void migrate()}>
                  <ArrowRightLeft size={15} /> Migrate to {profile.name}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void run(onBackup)}>
                  <Download size={15} /> Download backup
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {result && <p className="mt-4 text-sm text-zinc-300">{result}</p>}
      {error && (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function errorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return "Migration failed"
  try {
    const payload = JSON.parse(cause.message) as { message?: unknown }
    if (typeof payload.message === "string") return payload.message
  } catch {
    // Fall through to the original message for non-JSON errors.
  }
  return cause.message
}
