import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Check, Plus, RefreshCw, Trash2 } from "lucide-react"
import { api, type InstalledAddon, type Profile } from "../lib/api"
import { loadManifest } from "../lib/core"
import { Button } from "./ui/button"
import { Card } from "./ui/card"
import { Input } from "./ui/input"

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
  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: { enabled?: boolean; position?: number } }) =>
      api(`/v1/profiles/${profile.id}/addons/${id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/profiles/${profile.id}/addons/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  })

  return (
    <ViewShell
      eyebrow={`${profile.name}'s sources`}
      title="Add-ons"
      description="Install, prioritize, and control the add-ons used for discovery and playback."
    >
      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold">Install from manifest</h2>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
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
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Installed</h2>
            <p className="mt-1 text-xs text-zinc-500">Higher sources are resolved first.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            <RefreshCw size={14} /> Sync
          </Button>
        </div>
        <div className="divide-y divide-zinc-800">
          {addons.map((addon, index) => (
            <div className={`flex items-center gap-4 p-4 ${addon.enabled ? "" : "opacity-55"}`} key={addon.id}>
              {addon.manifest.logo ? (
                <img className="size-12 rounded-xl object-cover" src={addon.manifest.logo} alt="" />
              ) : (
                <div className="grid size-12 place-items-center rounded-xl bg-zinc-800"><Plus size={18} /></div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{addon.manifest.name}</p>
                <p className="mt-1 line-clamp-1 text-xs text-zinc-500">
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
                  className={`relative mx-2 h-6 w-11 rounded-full transition ${addon.enabled ? "bg-amber-400" : "bg-zinc-700"}`}
                  onClick={() => update.mutate({ id: addon.id, values: { enabled: !addon.enabled } })}
                >
                  <span className={`absolute top-1 grid size-4 place-items-center rounded-full bg-white text-zinc-900 transition-all ${addon.enabled ? "left-6" : "left-1"}`}>
                    {addon.enabled && <Check size={10} />}
                  </span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  title={`Uninstall ${addon.manifest.name}`}
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
            <div className="p-10 text-center text-sm text-zinc-500">No add-ons installed yet.</div>
          )}
        </div>
      </Card>
    </ViewShell>
  )
}

export function ViewShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto max-w-[2200px] 2xl:max-w-none px-4 py-9 sm:px-6 lg:px-6 xl:px-6 2xl:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">{eyebrow}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-500">{description}</p>
      <div className="mt-8">{children}</div>
    </main>
  )
}
