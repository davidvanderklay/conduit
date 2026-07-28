import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Film, LogOut, Plus, RefreshCw, Server, Trash2 } from "lucide-react"
import { api, type Bootstrap, type InstalledAddon, type Profile } from "./lib/api"
import { authClient } from "./lib/auth"
import { loadCatalog, loadManifest, type CatalogItem } from "./lib/core"
import { Button } from "./components/ui/button"
import { Card } from "./components/ui/card"
import { Input } from "./components/ui/input"

export function App() {
  const session = authClient.useSession()

  if (session.isPending) {
    return <CenteredMessage>Starting Conduit…</CenteredMessage>
  }
  if (!session.data?.user) {
    return <AuthScreen />
  }
  return <AuthenticatedApp userName={session.data.user.name} />
}

function AuthScreen() {
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError("")
    const data = new FormData(event.currentTarget)
    const email = String(data.get("email"))
    const password = String(data.get("password"))
    const name = String(data.get("name") || email.split("@")[0])
    const result =
      mode === "register"
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password })
    setPending(false)
    if (result.error) setError(result.error.message ?? "Authentication failed")
  }

  return (
    <main className="grid min-h-screen place-items-center px-5">
      <Card className="w-full max-w-md p-7">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-amber-400 text-zinc-950">
            <Film size={22} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold">Conduit</h1>
            <p className="text-sm text-zinc-500">Your household media system</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          {mode === "register" && <Input name="name" placeholder="Your name" required />}
          <Input name="email" type="email" placeholder="Email" required />
          <Input name="password" type="password" placeholder="Password" minLength={8} required />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button className="w-full" disabled={pending}>
            {pending ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
          </Button>
        </form>
        <button
          className="mt-5 w-full text-center text-sm text-zinc-500 hover:text-zinc-200"
          onClick={() => setMode((value) => (value === "register" ? "sign-in" : "register"))}
        >
          {mode === "register"
            ? "Already have an account? Sign in"
            : "New household? Create an account"}
        </button>
      </Card>
    </main>
  )
}

function AuthenticatedApp({ userName }: { userName: string }) {
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api<Bootstrap>("/v1/bootstrap"),
  })
  const [activeProfileId, setActiveProfileId] = useState<string>()

  const profiles = useMemo(
    () => bootstrap.data?.households.flatMap((household) => household.profiles) ?? [],
    [bootstrap.data],
  )

  useEffect(() => {
    if (!activeProfileId && profiles[0]) setActiveProfileId(profiles[0].id)
  }, [activeProfileId, profiles])

  if (bootstrap.isLoading) {
    return <CenteredMessage>Synchronizing your household…</CenteredMessage>
  }
  if (bootstrap.isError) {
    return (
      <CenteredMessage>
        Could not connect to the Conduit server: {bootstrap.error.message}
      </CenteredMessage>
    )
  }
  if (profiles.length === 0) {
    return <HouseholdSetup />
  }

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0]!

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-zinc-900 bg-zinc-950/85 px-5 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4">
          <div className="flex items-center gap-2 font-display text-lg font-semibold">
            <Film className="text-amber-400" size={21} />
            Conduit
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select
              className="h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm"
              value={activeProfile.id}
              onChange={(event) => setActiveProfileId(event.target.value)}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <span className="hidden text-sm text-zinc-500 sm:inline">{userName}</span>
            <Button
              size="icon"
              variant="ghost"
              title="Sign out"
              onClick={() => authClient.signOut()}
            >
              <LogOut size={17} />
            </Button>
          </div>
        </div>
      </header>
      <MediaHome profile={activeProfile} />
    </div>
  )
}

function HouseholdSetup() {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: (values: { name: string; profileName: string }) =>
      api("/v1/households", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
  })

  return (
    <main className="grid min-h-screen place-items-center px-5">
      <Card className="w-full max-w-lg p-8">
        <Server className="mb-5 text-amber-400" />
        <h1 className="font-display text-3xl font-semibold">Create your household</h1>
        <p className="mt-2 text-zinc-500">
          Profiles, add-ons, and watch state will synchronize through this server.
        </p>
        <form
          className="mt-7 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            create.mutate({
              name: String(data.get("name")),
              profileName: String(data.get("profileName")),
            })
          }}
        >
          <Input name="name" placeholder="Household name" required />
          <Input name="profileName" placeholder="First profile name" required />
          {create.error && <p className="text-sm text-red-400">{create.error.message}</p>}
          <Button disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create household"}
          </Button>
        </form>
      </Card>
    </main>
  )
}

function MediaHome({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient()
  const [installOpen, setInstallOpen] = useState(false)
  const addons = useQuery({
    queryKey: ["addons", profile.id],
    queryFn: () => api<{ addons: InstalledAddon[] }>(`/v1/profiles/${profile.id}/addons`),
  })

  const catalogs = useQuery({
    queryKey: ["catalogs", profile.id, addons.data?.addons.map((addon) => addon.id)],
    enabled: Boolean(addons.data),
    queryFn: async () => {
      const results = await Promise.allSettled(
        (addons.data?.addons ?? [])
          .filter((addon) => addon.enabled)
          .flatMap((addon) =>
            addon.manifest.catalogs
              .filter((catalog) => !(catalog.extra ?? []).some((extra) => extra.isRequired))
              .slice(0, 3)
              .map(async (catalog) => ({
                key: `${addon.id}:${catalog.type}:${catalog.id}`,
                title: catalog.name ?? `${addon.manifest.name} · ${catalog.id}`,
                items: await loadCatalog(addon.manifestUrl, catalog.type, catalog.id),
              })),
          ),
      )
      return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    },
  })

  const remove = useMutation({
    mutationFn: (addonId: string) =>
      api(`/v1/profiles/${profile.id}/addons/${addonId}`, {
        method: "DELETE",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["addons", profile.id] }),
  })

  return (
    <main className="mx-auto max-w-7xl px-5 py-10">
      <section className="mb-12 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
            {profile.name}&apos;s space
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            What are we watching?
          </h1>
          <p className="mt-2 text-zinc-500">
            Catalogs are loaded directly from your synchronized add-ons.
          </p>
        </div>
        <Button onClick={() => setInstallOpen((value) => !value)}>
          <Plus size={17} />
          Install add-on
        </Button>
      </section>

      {installOpen && (
        <InstallAddon
          profile={profile}
          onInstalled={() => {
            setInstallOpen(false)
            queryClient.invalidateQueries({
              queryKey: ["addons", profile.id],
            })
          }}
        />
      )}

      <section className="mb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Synchronized add-ons</h2>
          <Button size="sm" variant="ghost" onClick={() => addons.refetch()}>
            <RefreshCw size={14} /> Sync
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {addons.data?.addons.map((addon) => (
            <Card className="flex items-center gap-4 p-4" key={addon.id}>
              {addon.manifest.logo ? (
                <img className="size-11 rounded-lg object-cover" src={addon.manifest.logo} alt="" />
              ) : (
                <div className="grid size-11 place-items-center rounded-lg bg-zinc-800">
                  <Plus size={18} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{addon.manifest.name}</p>
                <p className="truncate text-xs text-zinc-500">{addon.manifestId}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                title="Remove add-on"
                onClick={() => remove.mutate(addon.id)}
              >
                <Trash2 size={16} />
              </Button>
            </Card>
          ))}
          {addons.data?.addons.length === 0 && (
            <Card className="col-span-full border-dashed p-8 text-center text-zinc-500">
              Install a Stremio-compatible manifest to begin.
            </Card>
          )}
        </div>
      </section>

      {catalogs.data?.map((catalog) => (
        <CatalogShelf key={catalog.key} title={catalog.title} items={catalog.items} />
      ))}
    </main>
  )
}

function InstallAddon({ profile, onInstalled }: { profile: Profile; onInstalled: () => void }) {
  const install = useMutation({
    mutationFn: async (manifestUrl: string) => {
      const normalizedUrl = manifestUrl.startsWith("stremio://")
        ? `https://${manifestUrl.slice("stremio://".length)}`
        : manifestUrl
      const manifest = await loadManifest(normalizedUrl)
      await api(`/v1/profiles/${profile.id}/addons`, {
        method: "POST",
        body: JSON.stringify({ manifestUrl: normalizedUrl, manifest }),
      })
    },
    onSuccess: onInstalled,
  })

  return (
    <Card className="mb-10 p-5">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          install.mutate(String(new FormData(event.currentTarget).get("manifestUrl")))
        }}
      >
        <Input
          className="flex-1"
          name="manifestUrl"
          placeholder="https://addon.example/configured/manifest.json"
          required
        />
        <Button disabled={install.isPending}>
          {install.isPending ? "Verifying…" : "Verify and install"}
        </Button>
      </form>
      {install.error && <p className="mt-3 text-sm text-red-400">{install.error.message}</p>}
      <p className="mt-3 text-xs text-zinc-600">
        Conduit encrypts the configured URL for synchronization. Catalog and stream requests go
        directly from this device to the add-on.
      </p>
    </Card>
  )
}

function CatalogShelf({ title, items }: { title: string; items: CatalogItem[] }) {
  if (items.length === 0) return null
  return (
    <section className="mb-10">
      <h2 className="mb-4 font-display text-xl font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7">
        {items.slice(0, 14).map((item) => (
          <article className="group" key={`${item.type}:${item.id}`}>
            <div className="aspect-[2/3] overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-800 transition group-hover:-translate-y-1 group-hover:ring-amber-400/60">
              {item.poster ? (
                <img
                  className="h-full w-full object-cover"
                  src={item.poster}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="grid h-full place-items-center text-zinc-700">
                  <Film />
                </div>
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-medium">{item.name}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-zinc-400">
      {children}
    </main>
  )
}
