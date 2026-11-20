import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from "lucide-react"
import { api, type InstalledAddon, type Profile } from "../lib/api"
import { loadManifest } from "../lib/core"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { PageHeader, pageClassName } from "./ui/page"
import { SwitchIndicator } from "./ui/switch"
import { Section } from "./ui/section"

export function AddonsView({
  profile,
  addons,
  onRefresh,
}: {
  profile: Profile
  addons: InstalledAddon[]
  onRefresh: () => void
}) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["addons", profile.id] })
  const install = useMutation({
    mutationFn: async (manifestUrl: string) => {
      const input = manifestUrl.trim()
      const normalizedUrl = input.startsWith("stremio://")
        ? `https://${input.slice("stremio://".length)}`
        : input
      const manifest = await loadManifest(normalizedUrl)
      await api(`/v1/profiles/${profile.id}/addons`, {
        method: "POST",
        body: JSON.stringify({ manifestUrl: normalizedUrl, manifest }),
      })
    },
    onSuccess: invalidate,
  })
  // Update and removal share one alert, so starting either clears the other's stale error.
  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: { enabled?: boolean; position?: number } }) =>
      api(`/v1/profiles/${profile.id}/addons/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onMutate: () => {
      remove.reset()
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/profiles/${profile.id}/addons/${id}`, { method: "DELETE" }),
    onMutate: () => {
      update.reset()
    },
    onSuccess: invalidate,
  })
  const changeError = update.error
    ? `Could not update add-on: ${update.error.message}`
    : remove.error && `Could not uninstall add-on: ${remove.error.message}`

  return (
    <ViewShell
      title="Add-ons"
      description="Install, prioritize, and control the add-ons used for discovery and playback."
    >
      <Section title="Install from manifest" description="Paste an add-on manifest URL.">
        <div className="p-5">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            install.mutate(String(new FormData(form).get("manifestUrl")), {
              onSuccess: () => form.reset(),
            })
          }}
        >
          <Input
            name="manifestUrl"
            className="flex-1"
            placeholder="https://addon.example/configured/manifest.json"
            required
          />
          <Button disabled={install.isPending}>
            <Plus size={16} /> {install.isPending ? "Verifying…" : "Install"}
          </Button>
        </form>
        {install.error && <p className="mt-3 text-sm text-red-400">{install.error.message}</p>}
        </div>
      </Section>

      <Section
        className="mt-7"
        title="Installed"
        description="Higher sources are resolved first."
        actions={
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            <RefreshCw size={14} /> Sync
          </Button>
        }
      >
        {changeError && (
          <p role="alert" className="mx-5 mt-3 text-sm text-red-400">
            {changeError}
          </p>
        )}
        <div className="divide-y divide-zinc-800">
          {addons.map((addon, index) => (
            <div className={`flex items-center gap-4 p-4 ${addon.enabled ? "" : "opacity-55"}`} key={addon.id}>
              <AddonLogo name={addon.manifest.name} logo={addon.manifest.logo} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{addon.manifest.name}</p>
                <p className="mt-1 line-clamp-1 text-xs text-zinc-400">
                  {addon.manifest.description ?? addon.manifestId}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  title="Move up"
                  disabled={index === 0 || update.isPending}
                  onClick={() => update.mutate({ id: addon.id, values: { position: index - 1 } })}
                ><ArrowUp size={15} /></Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Move down"
                  disabled={index === addons.length - 1 || update.isPending}
                  onClick={() => update.mutate({ id: addon.id, values: { position: index + 1 } })}
                ><ArrowDown size={15} /></Button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={addon.enabled}
                  aria-label={`${addon.enabled ? "Disable" : "Enable"} ${addon.manifest.name}`}
                  disabled={update.isPending}
                  className="mx-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-60"
                  onClick={() => update.mutate({ id: addon.id, values: { enabled: !addon.enabled } })}
                >
                  <SwitchIndicator checked={addon.enabled} />
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-zinc-500 hover:text-red-400"
                  title={`Uninstall ${addon.manifest.name}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Uninstall ${addon.manifest.name} from ${profile.name}?`)) {
                      remove.mutate(addon.id)
                    }
                  }}
                ><Trash2 size={16} /></Button>
              </div>
            </div>
          ))}
          {addons.length === 0 && (
            <div className="p-10 text-center text-sm text-zinc-400">No add-ons installed yet.</div>
          )}
        </div>
      </Section>
    </ViewShell>
  )
}

/** Add-on artwork, contained so wide wordmarks are not cropped; a monogram when there is none. */
function AddonLogo({ name, logo }: { name: string; logo?: string }) {
  const [monogram, setMonogram] = useState(false)
  return (
    <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-zinc-800 ring-1 ring-white/5">
      {logo && !monogram ? (
        <img
          className="size-full object-contain p-1.5"
          src={logo}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setMonogram(true)}
        />
      ) : (
        <span className="font-display text-lg font-semibold text-zinc-300">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </div>
  )
}

export function ViewShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className={pageClassName}>
      <PageHeader title={title} description={description} />
      {children}
    </main>
  )
}
