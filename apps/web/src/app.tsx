import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarDays, Film, Library, Search, Server, X } from "lucide-react"
import { api, type Bootstrap, type InstalledAddon, type Profile } from "./lib/api"
import { authClient } from "./lib/auth"
import { loadCatalog, type CatalogItem } from "./lib/core"
import { readLastProfileId, rememberLastProfileId } from "./lib/profile-preference"
import { ProfileSwitcher } from "./components/profile-switcher"
import { Button } from "./components/ui/button"
import { Card } from "./components/ui/card"
import { Input } from "./components/ui/input"
import { MediaDetails } from "./components/media-details"
import { SearchView } from "./components/search-view"
import { AppSidebar, type AppSection } from "./components/app-sidebar"
import { AddonsView, ViewShell } from "./components/addons-view"
import { SettingsView } from "./components/settings-view"
import { LibraryView } from "./components/library-view"
import { LibraryToggle } from "./components/library-toggle"
import { ContinueWatching, HistoryView } from "./components/progress-view"
import { applyPreferences, readPreferences } from "./lib/preferences"
import {
  DiscoverView,
  type DiscoverSelection,
} from "./components/discover-view"

export function App() {
  const session = authClient.useSession()
  useEffect(() => applyPreferences(readPreferences()), [])

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
  const [activeProfileId, setActiveProfileId] = useState<string | undefined>(readLastProfileId)
  const [section, setSection] = useState<AppSection>("home")
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [discoverSelection, setDiscoverSelection] = useState<DiscoverSelection>({})

  const profiles = useMemo(
    () => bootstrap.data?.households.flatMap((household) => household.profiles) ?? [],
    [bootstrap.data],
  )

  useEffect(() => {
    if (profiles[0] && !profiles.some((profile) => profile.id === activeProfileId)) {
      setActiveProfileId(profiles[0].id)
    }
  }, [activeProfileId, profiles])

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(searchInput.trim()), 350)
    return () => window.clearTimeout(timeout)
  }, [searchInput])

  useEffect(() => {
    setSearchInput("")
    setQuery("")
    setDiscoverSelection({})
  }, [activeProfileId])

  useEffect(() => {
    if (activeProfileId && profiles.some((profile) => profile.id === activeProfileId)) {
      rememberLastProfileId(activeProfileId)
    }
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
  const navigate = (nextSection: AppSection) => {
    setSection(nextSection)
    setSearchInput("")
    setQuery("")
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-zinc-900 bg-zinc-950/85 px-5 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3">
          <div className="flex shrink-0 items-center gap-2 font-display text-lg font-semibold">
            <Film className="text-amber-400" size={21} />
            <span className="hidden sm:inline">Conduit</span>
          </div>
          <div className="relative mx-auto w-full max-w-xl">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              size={17}
            />
            <input
              type="search"
              value={searchInput}
              aria-label="Search or paste a link"
              placeholder="Search or paste a link"
              className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 pl-10 pr-10 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchInput && (
              <button
                className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-white"
                aria-label="Clear search"
                onClick={() => setSearchInput("")}
              >
                <X size={15} />
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ProfileSwitcher
              profiles={profiles}
              activeProfile={activeProfile}
              onSelect={setActiveProfileId}
              userName={userName}
              onNavigate={navigate}
              onSignOut={() => authClient.signOut()}
            />
          </div>
        </div>
      </header>
      <AppSidebar active={section} onNavigate={navigate} />
      <div className="pb-16 md:ml-16 md:pb-0">
        <ProfileApp
          profile={activeProfile}
          section={section}
          onNavigate={navigate}
          searchInput={searchInput}
          query={query}
          discoverSelection={discoverSelection}
          onDiscoverSelection={setDiscoverSelection}
        />
      </div>
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

function ProfileApp({
  profile,
  section,
  onNavigate,
  searchInput,
  query,
  discoverSelection,
  onDiscoverSelection,
}: {
  profile: Profile
  section: AppSection
  onNavigate: (section: AppSection) => void
  searchInput: string
  query: string
  discoverSelection: DiscoverSelection
  onDiscoverSelection: (selection: DiscoverSelection) => void
}) {
  const [selectedItem, setSelectedItem] = useState<CatalogItem>()
  const [selectedVideoId, setSelectedVideoId] = useState<string>()
  const addons = useQuery({
    queryKey: ["addons", profile.id],
    queryFn: () => api<{ addons: InstalledAddon[] }>(`/v1/profiles/${profile.id}/addons`),
  })

  useEffect(() => {
    setSelectedItem(undefined)
  }, [profile.id])

  return (
    <>
      {!searchInput && section === "home" && (
        <MediaHome
          profile={profile}
          addons={addons.data?.addons ?? []}
          onDiscover={(selection) => {
            onDiscoverSelection(selection)
            onNavigate("discover")
          }}
        />
      )}
      {!searchInput && section === "discover" && (
        <DiscoverView
          profileId={profile.id}
          addons={addons.data?.addons ?? []}
          selection={discoverSelection}
          onChange={onDiscoverSelection}
          onSelect={(item) => {
            setSelectedVideoId(undefined)
            setSelectedItem(item)
          }}
        />
      )}
      {!searchInput && section === "library" && (
        <LibraryView
          profileId={profile.id}
          addons={addons.data?.addons ?? []}
          onSelect={(item) => {
            setSelectedVideoId(undefined)
            setSelectedItem(item)
          }}
        />
      )}
      {!searchInput && section === "history" && (
        <HistoryView
          profileId={profile.id}
          onSelect={(item, videoId) => {
            setSelectedItem(item)
            setSelectedVideoId(videoId)
          }}
        />
      )}
      {!searchInput && section === "calendar" && (
        <UnavailableCollection
          icon={CalendarDays}
          title="Calendar"
          description="Upcoming episodes from series in your library will appear here."
        />
      )}
      {!searchInput && section === "addons" && (
        <AddonsView
          profile={profile}
          addons={addons.data?.addons ?? []}
          onRefresh={() => addons.refetch()}
        />
      )}
      {!searchInput && section === "settings" && <SettingsView profile={profile} />}
      {searchInput && (
        <SearchView
          profileId={profile.id}
          addons={addons.data?.addons ?? []}
          query={query}
          onSelect={(item) => {
            setSelectedVideoId(undefined)
            setSelectedItem(item)
          }}
        />
      )}
      {selectedItem && addons.data && (
        <MediaDetails
          item={selectedItem}
          addons={addons.data.addons}
          profileId={profile.id}
          initialVideoId={selectedVideoId}
          onClose={() => setSelectedItem(undefined)}
        />
      )}
    </>
  )
}

function MediaHome({
  profile,
  addons,
  onDiscover,
}: {
  profile: Profile
  addons: InstalledAddon[]
  onDiscover: (selection: DiscoverSelection) => void
}) {
  const [selectedItem, setSelectedItem] = useState<CatalogItem>()
  const [selectedVideoId, setSelectedVideoId] = useState<string>()
  const catalogs = useQuery({
    queryKey: ["catalogs", profile.id, addons.map((addon) => [addon.id, addon.enabled])],
    enabled: addons.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        addons
          .filter((addon) => addon.enabled)
          .flatMap((addon) =>
            addon.manifest.catalogs
              .filter((catalog) => !(catalog.extra ?? []).some((extra) => extra.isRequired))
              .slice(0, 3)
              .map(async (catalog) => ({
                key: `${addon.id}:${catalog.type}:${catalog.id}`,
                addonId: addon.id,
                type: catalog.type,
                catalogId: catalog.id,
                title: catalog.name ?? `${addon.manifest.name} · ${catalog.id}`,
                items: await loadCatalog(addon.manifestUrl, catalog.type, catalog.id),
              })),
          ),
      )
      return {
        catalogs: results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        ),
        errors: results.flatMap((result) =>
          result.status === "rejected"
            ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
            : [],
        ),
      }
    },
  })

  return (
    <main className="mx-auto max-w-7xl px-5 py-10">
      <section className="mb-12">
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
      </section>

      <ContinueWatching
        profileId={profile.id}
        onSelect={(item, videoId) => {
          setSelectedItem(item)
          setSelectedVideoId(videoId)
        }}
      />

      {catalogs.data?.errors.length ? (
        <Card className="mb-8 border-red-900/70 bg-red-950/30 p-4 text-sm text-red-200">
          {catalogs.data.errors.length} catalog request
          {catalogs.data.errors.length === 1 ? "" : "s"} failed. The first error was:{" "}
          {catalogs.data.errors[0]}
        </Card>
      ) : null}

      {catalogs.data?.catalogs.map((catalog) => (
        <CatalogShelf
          key={catalog.key}
          profileId={profile.id}
          title={catalog.title}
          items={catalog.items}
          onSelect={(item) => {
            setSelectedVideoId(undefined)
            setSelectedItem(item)
          }}
          onSeeMore={() =>
            onDiscover({
              addonId: catalog.addonId,
              type: catalog.type,
              catalogId: catalog.catalogId,
            })
          }
        />
      ))}

      {selectedItem && (
        <MediaDetails
          item={selectedItem}
          addons={addons}
          profileId={profile.id}
          initialVideoId={selectedVideoId}
          onClose={() => setSelectedItem(undefined)}
        />
      )}
    </main>
  )
}

function UnavailableCollection({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Library
  title: string
  description: string
}) {
  return (
    <ViewShell eyebrow="Your collection" title={title} description={description}>
      <Card className="grid min-h-64 place-items-center border-dashed text-center">
        <div>
          <Icon className="mx-auto text-zinc-700" size={34} />
          <p className="mt-4 text-sm text-zinc-500">Nothing here yet</p>
        </div>
      </Card>
    </ViewShell>
  )
}

function CatalogShelf({
  title,
  items,
  profileId,
  onSelect,
  onSeeMore,
}: {
  title: string
  items: CatalogItem[]
  profileId: string
  onSelect: (item: CatalogItem) => void
  onSeeMore: () => void
}) {
  if (items.length === 0) return null
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <button
          className="text-xs font-semibold text-zinc-500 transition hover:text-amber-300"
          onClick={onSeeMore}
        >
          See more
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7">
        {items.slice(0, 14).map((item) => (
          <div className="group relative" key={`${item.type}:${item.id}`}>
            <button className="w-full text-left" onClick={() => onSelect(item)}>
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
            </button>
            <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              <LibraryToggle profileId={profileId} item={item} compact />
            </div>
          </div>
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
