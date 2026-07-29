import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Check, Film, Globe2, Library, Search, Server, Shield, X } from "lucide-react"
import { api, type Bootstrap, type InstalledAddon, type Profile } from "./lib/api"
import { API_URL, authClient } from "./lib/auth"
import {
  DEFAULT_SERVER_URL,
  isDefaultServer,
  saveServerUrl,
  serverDisplayName,
  testConduitServer,
} from "./lib/server"
import { loadCatalog, type CatalogItem } from "./lib/core"
import { readLastProfileId, rememberLastProfileId } from "./lib/profile-preference"
import { posterCoverClass, posterGridClass } from "./lib/poster-layout"
import { ProfileSwitcher } from "./components/profile-switcher"
import { Button } from "./components/ui/button"
import { Card } from "./components/ui/card"
import { Input } from "./components/ui/input"
import { MediaDetails, type MetadataBrowseTarget } from "./components/media-details"
import { SearchView } from "./components/search-view"
import { AppSidebar, type AppSection } from "./components/app-sidebar"
import { AddonsView, ViewShell } from "./components/addons-view"
import { SettingsView } from "./components/settings-view"
import { LibraryView } from "./components/library-view"
import { CalendarView } from "./components/calendar-view"
import { PosterWatchStatus, PosterWatchStatusProvider } from "./components/poster-watch-status"
import { ContinueWatching, HistoryView } from "./components/progress-view"
import { applyPreferences, readPreferences } from "./lib/preferences"
import { DiscoverView, type DiscoverSelection } from "./components/discover-view"
import { VirtualVerticalList } from "./components/virtual-vertical-list"

export function App() {
  const session = authClient.useSession()
  useEffect(() => applyPreferences(readPreferences()), [])

  if (session.isPending) {
    return <CenteredMessage>Starting conduit…</CenteredMessage>
  }
  if (window.location.pathname === "/recover/admin") {
    return <AdminRecoveryScreen />
  }
  if (!session.data?.user) {
    return <AuthScreen />
  }
  if (window.sessionStorage.getItem("conduit:recovery-setup") === "pending") {
    return <RecoverySetup />
  }
  if (window.location.pathname === "/admin") {
    return <AdminScreen />
  }
  return (
    <AuthenticatedApp
      userId={session.data.user.id}
      userName={session.data.user.email}
      isOwner={(session.data.user as typeof session.data.user & { role?: string }).role === "owner"}
    />
  )
}

function AuthScreen() {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in")
  const [selectingServer, setSelectingServer] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [recovering, setRecovering] = useState(false)
  const authConfig = useQuery({
    queryKey: ["auth-config"],
    queryFn: () =>
      api<{
        needsOwner: boolean
        localRegistration: boolean
        oidc: { enabled: boolean; provider?: "google" | "oidc"; displayName?: string }
      }>("/v1/auth/config"),
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError("")
    const data = new FormData(event.currentTarget)
    const email = String(data.get("email"))
    const password = String(data.get("password"))
    if (mode === "register") {
      window.sessionStorage.setItem("conduit:recovery-setup", "pending")
    }
    const result =
      mode === "register"
        ? await authClient.signUp.email({ email, password, name: "Conduit account" })
        : await authClient.signIn.email({ email, password })
    setPending(false)
    if (result.error) {
      if (mode === "register") window.sessionStorage.removeItem("conduit:recovery-setup")
      setError(result.error.message ?? "Authentication failed")
    } else {
      // Never let data cached by a previous session cross an account boundary.
      queryClient.clear()
      if (mode === "register") {
        try {
          const recovery = await api<{ codes: string[] }>("/v1/auth/recovery-codes", {
            method: "POST",
          })
          setRecoveryCodes(recovery.codes)
        } catch {
          // Account creation succeeded; codes can be regenerated later.
        }
      }
    }
  }

  const oauthEnabled = !recovering && recoveryCodes.length === 0 && authConfig.data?.oidc.enabled
  const switchModeLabel = authConfig.data?.needsOwner
    ? "Set up this instance"
    : "Create a local account"

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-18rem] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-amber-400/[0.07] blur-3xl" />
        <div className="absolute inset-0 opacity-[0.025] [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:64px_64px]" />
      </div>
      <div className="relative w-full max-w-[27rem]">
        <a href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-amber-400 text-zinc-950 shadow-lg shadow-amber-400/10">
            <Film size={18} strokeWidth={2.4} />
          </div>
          <span className="font-display text-xl font-semibold tracking-tight">conduit</span>
        </a>
        <Card className="overflow-hidden border-zinc-800/90 bg-zinc-900/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="p-6 sm:p-8">
            <div className="mb-7 text-center">
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {recovering
                  ? "Recover your account"
                  : mode === "register"
                    ? authConfig.data?.needsOwner
                      ? "Set up Conduit"
                      : "Create your account"
                    : "Welcome back"}
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                {recovering
                  ? "Enter one of the recovery codes you saved."
                  : mode === "register"
                    ? "Create a private account for this Conduit instance."
                    : "Sign in to continue to your household."}
              </p>
            </div>
            {recoveryCodes.length > 0 ? (
              <RecoveryCodes
                codes={recoveryCodes}
                onContinue={() => {
                  window.sessionStorage.removeItem("conduit:recovery-setup")
                  window.location.reload()
                }}
              />
            ) : recovering ? (
              <form
                className="space-y-5"
                onSubmit={async (event) => {
                  event.preventDefault()
                  setPending(true)
                  setError("")
                  const data = new FormData(event.currentTarget)
                  try {
                    await api("/v1/auth/recover", {
                      method: "POST",
                      body: JSON.stringify({
                        email: String(data.get("email")),
                        code: String(data.get("code")),
                        password: String(data.get("password")),
                      }),
                    })
                    setRecovering(false)
                    setError("Password reset. You can sign in now.")
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Recovery failed")
                  } finally {
                    setPending(false)
                  }
                }}
              >
                <AuthField id="recovery-email" label="Email address">
                  <Input id="recovery-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
                </AuthField>
                <AuthField id="recovery-code" label="Recovery code">
                  <Input id="recovery-code" name="code" autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX-XXXX" required />
                </AuthField>
                <AuthField id="recovery-password" label="New password">
                  <Input id="recovery-password" name="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" minLength={8} required />
                </AuthField>
                {error && <AuthMessage message={error} />}
                <Button className="h-11 w-full" disabled={pending}>
                  {pending ? "Resetting…" : "Reset password"}
                </Button>
                <button
                  type="button"
                  className="w-full text-sm font-medium text-zinc-400 transition hover:text-white"
                  onClick={() => {
                    setRecovering(false)
                    setError("")
                  }}
                >
                  Back to sign in
                </button>
              </form>
            ) : (
              <>
                {oauthEnabled && (
                  <>
                    <Button
                      className="h-11 w-full border border-zinc-700 bg-white text-zinc-900 hover:bg-zinc-100"
                      variant="secondary"
                      onClick={() =>
                        authConfig.data!.oidc.provider === "google"
                          ? authClient.signIn.social({
                              provider: "google",
                              callbackURL: `${window.location.origin}/`,
                              errorCallbackURL: `${window.location.origin}/`,
                              newUserCallbackURL: `${window.location.origin}/`,
                            })
                          : authClient.signIn.oauth2({
                              providerId: "conduit-oidc",
                              callbackURL: `${window.location.origin}/`,
                              errorCallbackURL: `${window.location.origin}/`,
                              newUserCallbackURL: `${window.location.origin}/`,
                            })
                      }
                    >
                      {authConfig.data!.oidc.provider === "google" && <GoogleMark />}
                      {authConfig.data!.oidc.displayName}
                    </Button>
                    <div className="my-6 flex items-center gap-3">
                      <div className="h-px flex-1 bg-zinc-800" />
                      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-600">
                        or continue with email
                      </span>
                      <div className="h-px flex-1 bg-zinc-800" />
                    </div>
                  </>
                )}
                <form className="space-y-5" onSubmit={submit}>
                  <AuthField id="auth-email" label="Email address">
                    <Input id="auth-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
                  </AuthField>
                  <AuthField id="auth-password" label="Password">
                    <Input
                      id="auth-password"
                      name="password"
                      type="password"
                      autoComplete={mode === "register" ? "new-password" : "current-password"}
                      placeholder={mode === "register" ? "At least 8 characters" : "Enter your password"}
                      minLength={8}
                      required
                    />
                    {mode === "sign-in" && (
                      <div className="mt-2 flex justify-end text-xs">
                        <button
                          type="button"
                          className="font-medium text-zinc-500 transition hover:text-amber-300"
                          onClick={() => {
                            setRecovering(true)
                            setError("")
                          }}
                        >
                          Use recovery code
                        </button>
                      </div>
                    )}
                  </AuthField>
                  {mode === "register" && (
                    <p className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5 text-xs leading-5 text-zinc-500">
                      No personal name required. Profiles remain separate from your account.
                    </p>
                  )}
                  {error && <AuthMessage message={error} success={error.startsWith("Password reset")} />}
                  <Button className="h-11 w-full" disabled={pending}>
                    {pending ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
                  </Button>
                </form>
              </>
            )}
          </div>
          {recoveryCodes.length === 0 && !recovering && authConfig.data?.localRegistration && (
            <div className="border-t border-zinc-800/80 bg-zinc-950/40 px-6 py-4 text-center text-sm text-zinc-500">
              {mode === "register" ? "Already have an account?" : "New to this instance?"}{" "}
              <button
                className="font-medium text-zinc-200 transition hover:text-amber-300"
                onClick={() => {
                  setMode((value) => (value === "register" ? "sign-in" : "register"))
                  setError("")
                }}
              >
                {mode === "register" ? "Sign in" : switchModeLabel}
              </button>
            </div>
          )}
        </Card>
        <button
          type="button"
          className="mx-auto mt-5 flex max-w-full items-center gap-2 rounded-full border border-zinc-800/80 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
          onClick={() => setSelectingServer(true)}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.5)]" />
          <span className="truncate">
            {isDefaultServer(API_URL) ? "Default server" : serverDisplayName(API_URL)}
          </span>
          <span className="text-zinc-700">·</span>
          <span className="shrink-0 font-medium text-zinc-400">Change server</span>
        </button>
      </div>
      {selectingServer && <ServerSelector onClose={() => setSelectingServer(false)} />}
    </main>
  )
}

function ServerSelector({ onClose }: { onClose: () => void }) {
  const currentIsDefault = isDefaultServer(API_URL)
  const [choice, setChoice] = useState<"default" | "custom">(
    currentIsDefault ? "default" : "custom",
  )
  const [customUrl, setCustomUrl] = useState(currentIsDefault ? "" : API_URL)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const target = choice === "default" ? DEFAULT_SERVER_URL : customUrl
      const normalized = await testConduitServer(target)
      const changed = normalized !== API_URL
      saveServerUrl(normalized)
      if (changed) {
        window.location.assign("/")
      } else {
        onClose()
      }
    } catch (cause) {
      if (cause instanceof TypeError) {
        setError(
          "Could not reach that server. Check the address, HTTPS, and the server's allowed web origin.",
        )
      } else {
        setError(cause instanceof Error ? cause.message : "Could not connect to that server.")
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/80 px-5 py-10 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="server-selector-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <Card className="w-full max-w-[29rem] overflow-hidden border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60">
        <form onSubmit={connect}>
          <div className="p-6 sm:p-8">
            <button
              type="button"
              className="mb-6 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition hover:text-zinc-200"
              onClick={onClose}
              disabled={pending}
            >
              <ArrowLeft size={14} />
              Back to sign in
            </button>
            <div className="mb-7">
              <div className="mb-4 grid size-11 place-items-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
                <Globe2 size={21} />
              </div>
              <h2
                id="server-selector-title"
                className="font-display text-2xl font-semibold tracking-tight"
              >
                Choose your server
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Use Conduit&apos;s default service or connect directly to a self-hosted instance.
                Your choice stays on this device.
              </p>
            </div>

            <div className="space-y-3">
              <ServerChoice
                checked={choice === "default"}
                title="Default server"
                description={serverDisplayName(DEFAULT_SERVER_URL)}
                onSelect={() => {
                  setChoice("default")
                  setError("")
                }}
              />
              <ServerChoice
                checked={choice === "custom"}
                title="Self-hosted server"
                description="Connect with an address provided by your administrator."
                onSelect={() => {
                  setChoice("custom")
                  setError("")
                }}
              />
            </div>

            {choice === "custom" && (
              <div className="mt-5">
                <AuthField id="custom-server-url" label="Server address">
                  <Input
                    id="custom-server-url"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="https://conduit.example.com"
                    value={customUrl}
                    onChange={(event) => setCustomUrl(event.target.value)}
                    required
                    autoFocus
                  />
                </AuthField>
                <p className="mt-2 text-xs leading-5 text-zinc-600">
                  Include <span className="font-mono text-zinc-500">https://</span>. Local
                  development servers may use <span className="font-mono text-zinc-500">http://</span>.
                </p>
              </div>
            )}

            {error && <div className="mt-5"><AuthMessage message={error} /></div>}
          </div>
          <div className="border-t border-zinc-800 bg-zinc-950/40 px-6 py-4 sm:px-8">
            <Button className="h-11 w-full" disabled={pending}>
              {pending ? "Checking server…" : choice === "default" ? "Use default server" : "Connect to server"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

function ServerChoice({
  checked,
  title,
  description,
  onSelect,
}: {
  checked: boolean
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition ${
        checked
          ? "border-amber-400/50 bg-amber-400/[0.07]"
          : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
      }`}
      onClick={onSelect}
    >
      <span
        className={`grid size-5 shrink-0 place-items-center rounded-full border ${
          checked ? "border-amber-400 bg-amber-400 text-zinc-950" : "border-zinc-700"
        }`}
      >
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-200">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-zinc-600">{description}</span>
      </span>
    </button>
  )
}

function AuthenticatedApp({
  userId,
  userName,
  isOwner,
}: {
  userId: string
  userName: string
  isOwner: boolean
}) {
  const queryClient = useQueryClient()
  const bootstrap = useQuery({
    queryKey: bootstrapQueryKey(userId),
    queryFn: () => api<Bootstrap>("/v1/bootstrap"),
  })
  const [activeProfileId, setActiveProfileId] = useState<string | undefined>(readLastProfileId)
  const [section, setSection] = useState<AppSection>("home")
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [discoverSelection, setDiscoverSelection] = useState<DiscoverSelection>({})
  const scrollViewportRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    let idleTimeout = 0
    const onScroll = () => {
      if (!document.documentElement.classList.contains("desktop-scrolling")) {
        document.documentElement.classList.add("desktop-scrolling")
      }
      window.clearTimeout(idleTimeout)
      idleTimeout = window.setTimeout(() => {
        document.documentElement.classList.remove("desktop-scrolling")
      }, 140)
    }
    viewport.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      viewport.removeEventListener("scroll", onScroll)
      window.clearTimeout(idleTimeout)
      document.documentElement.classList.remove("desktop-scrolling")
    }
  }, [bootstrap.data])

  if (bootstrap.isLoading) {
    return <CenteredMessage>Synchronizing your household…</CenteredMessage>
  }
  if (bootstrap.isError) {
    return (
      <CenteredMessage>
        Could not connect to the conduit server: {bootstrap.error.message}
      </CenteredMessage>
    )
  }
  if (profiles.length === 0) {
    return <HouseholdSetup />
  }

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0]!
  const activeHousehold = bootstrap.data!.households.find((household) =>
    household.profiles.some((profile) => profile.id === activeProfile.id),
  )!
  const navigate = (nextSection: AppSection) => {
    setSection(nextSection)
    setSearchInput("")
    setQuery("")
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="app-chrome z-20 shrink-0 border-b border-zinc-900 bg-zinc-950/85 pl-[22px] pr-4 backdrop-blur-xl sm:pr-6 lg:pr-8 xl:pr-10">
        <div className="flex h-16 items-center gap-3">
          <div className="flex shrink-0 items-center gap-2 font-display text-lg font-semibold">
            <Film className="text-amber-400" size={21} />
            <span className="hidden sm:inline">conduit</span>
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
              onCreate={async (values) => {
                const result = await api<{ profile: Profile }>(
                  `/v1/households/${activeHousehold.id}/profiles`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      name: values.name,
                      isKids: values.isKids,
                      ...(values.copyAddons ? { copyAddonsFromProfileId: activeProfile.id } : {}),
                    }),
                  },
                )
                await queryClient.invalidateQueries({ queryKey: bootstrapQueryKey(userId) })
                setActiveProfileId(result.profile.id)
              }}
              userName={userName}
              onNavigate={navigate}
              onSignOut={async () => {
                const result = await authClient.signOut()
                if (!result.error) queryClient.clear()
              }}
            />
            {isOwner && (
              <a
                href="/admin"
                aria-label="Instance administration"
                className="grid size-10 place-items-center rounded-xl text-zinc-400 hover:bg-zinc-900 hover:text-white"
              >
                <Shield size={18} />
              </a>
            )}
          </div>
        </div>
      </header>
      <AppSidebar active={section} onNavigate={navigate} />
      <div
        ref={scrollViewportRef}
        id="app-scroll-viewport"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-16 md:ml-16 md:pb-0"
      >
        <ProfileApp
          profile={activeProfile}
          section={section}
          onNavigate={navigate}
          searchInput={searchInput}
          query={query}
          discoverSelection={discoverSelection}
          onDiscoverSelection={setDiscoverSelection}
          onMetadataBrowse={(target) => {
            if (target.kind === "genre") {
              setSearchInput("")
              setQuery("")
              setDiscoverSelection({ type: target.mediaType, genre: target.value })
              setSection("discover")
              return
            }
            setSearchInput(target.value)
            setQuery(target.value)
          }}
        />
      </div>
    </div>
  )
}

export function bootstrapQueryKey(userId: string) {
  return ["bootstrap", userId] as const
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
  onMetadataBrowse,
}: {
  profile: Profile
  section: AppSection
  onNavigate: (section: AppSection) => void
  searchInput: string
  query: string
  discoverSelection: DiscoverSelection
  onDiscoverSelection: (selection: DiscoverSelection) => void
  onMetadataBrowse: (target: MetadataBrowseTarget) => void
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
    <PosterWatchStatusProvider profileId={profile.id}>
      {!searchInput && section === "home" && (
        <MediaHome
          profile={profile}
          addons={addons.data?.addons ?? []}
          onHistory={() => onNavigate("history")}
          onDiscover={(selection) => {
            onDiscoverSelection(selection)
            onNavigate("discover")
          }}
          onMetadataBrowse={onMetadataBrowse}
        />
      )}
      {!searchInput && section === "discover" && (
        <DiscoverView
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
        <CalendarView
          profileId={profile.id}
          addons={addons.data?.addons ?? []}
          onSelect={(item, videoId) => {
            setSelectedItem(item)
            setSelectedVideoId(videoId)
          }}
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
          onBrowse={onMetadataBrowse}
          onClose={() => setSelectedItem(undefined)}
        />
      )}
    </PosterWatchStatusProvider>
  )
}

interface HomeCatalog {
  key: string
  addonId: string
  type: string
  catalogId: string
  title: string
  items: CatalogItem[]
}

type HomeFeedItem =
  | { key: "continue"; kind: "continue" }
  | { key: "error"; kind: "error"; errors: string[] }
  | { key: string; kind: "catalog"; catalog: HomeCatalog }

function MediaHome({
  profile,
  addons,
  onHistory,
  onDiscover,
  onMetadataBrowse,
}: {
  profile: Profile
  addons: InstalledAddon[]
  onHistory: () => void
  onDiscover: (selection: DiscoverSelection) => void
  onMetadataBrowse: (target: MetadataBrowseTarget) => void
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
  const feedItems: HomeFeedItem[] = [
    { key: "continue", kind: "continue" },
    ...(catalogs.data?.errors.length
      ? [{ key: "error" as const, kind: "error" as const, errors: catalogs.data.errors }]
      : []),
    ...(catalogs.data?.catalogs
      .filter((catalog) => catalog.items.length > 0)
      .map((catalog) => ({
        key: catalog.key,
        kind: "catalog" as const,
        catalog,
      })) ?? []),
  ]

  return (
    <main className="mx-auto max-w-[2200px] px-4 py-10 sm:px-6 lg:px-8 xl:px-10">
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

      <VirtualVerticalList
        items={feedItems}
        itemKey={(item) => item.key}
        renderItem={(feedItem) => {
          if (feedItem.kind === "continue") {
            return (
              <ContinueWatching
                profileId={profile.id}
                onSeeMore={onHistory}
                onSelect={(item, videoId) => {
                  setSelectedItem(item)
                  setSelectedVideoId(videoId)
                }}
              />
            )
          }
          if (feedItem.kind === "error") {
            return (
              <Card className="border-red-900/70 bg-red-950/30 p-4 text-sm text-red-200">
                {feedItem.errors.length} catalog request
                {feedItem.errors.length === 1 ? "" : "s"} failed. The first error was:{" "}
                {feedItem.errors[0]}
              </Card>
            )
          }
          const catalog = feedItem.catalog
          return (
            <CatalogShelf
              addons={addons}
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
          )
        }}
      />

      {selectedItem && (
        <MediaDetails
          item={selectedItem}
          addons={addons}
          profileId={profile.id}
          initialVideoId={selectedVideoId}
          onBrowse={onMetadataBrowse}
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
  addons,
  onSelect,
  onSeeMore,
}: {
  title: string
  items: CatalogItem[]
  addons: InstalledAddon[]
  onSelect: (item: CatalogItem) => void
  onSeeMore: () => void
}) {
  if (items.length === 0) return null
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <button
          className="text-xs font-semibold text-zinc-500 transition hover:text-amber-300"
          onClick={onSeeMore}
        >
          See more
        </button>
      </div>
      <div className={posterGridClass}>
        {items.slice(0, 14).map((item) => (
          <div className="group relative" key={`${item.type}:${item.id}`}>
            <button className="w-full text-left" onClick={() => onSelect(item)}>
              <div className={posterCoverClass}>
                {item.poster ? (
                  <img
                    className="h-full w-full object-cover"
                    src={item.poster}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={300}
                    height={450}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-zinc-700">
                    <Film />
                  </div>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-medium">{item.name}</p>
            </button>
            <div className="pointer-events-none absolute right-2 top-2">
              <PosterWatchStatus item={item} addons={addons} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function AuthField({
  id,
  label,
  action,
  children,
}: {
  id: string
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <span className="mb-2 flex items-center justify-between text-xs font-medium text-zinc-400">
        <label htmlFor={id}>{label}</label>
        {action}
      </span>
      {children}
    </div>
  )
}

function AuthMessage({ message, success = false }: { message: string; success?: boolean }) {
  return (
    <p
      role="alert"
      className={`rounded-lg border px-3 py-2.5 text-xs ${
        success
          ? "border-emerald-900/70 bg-emerald-950/40 text-emerald-300"
          : "border-red-900/70 bg-red-950/40 text-red-300"
      }`}
    >
      {message}
    </p>
  )
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4.5">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.36l-3.25-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.93A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.63.39 3.17 1.04 4.55l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.82 1.5l2.88-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z" />
    </svg>
  )
}

function RecoveryCodes({ codes, onContinue }: { codes: string[]; onContinue: () => void }) {
  const text = codes.join("\n")
  return (
    <div>
      <h2 className="font-display text-xl font-semibold">Save your recovery codes</h2>
      <p className="mt-2 text-sm text-zinc-400">
        Each code can reset your password once. Conduit cannot email you a reset link.
      </p>
      <pre className="mt-4 grid grid-cols-2 gap-2 whitespace-pre-wrap rounded-xl bg-zinc-950 p-4 text-xs text-amber-300">
        {text}
      </pre>
      <p className="mt-4 text-xs text-zinc-500">
        Recovery codes protect account access. Frequent profile exports separately protect your
        library and watch history if the account cannot be recovered.
      </p>
      <Button
        className="mt-4 w-full"
        variant="secondary"
        onClick={() => navigator.clipboard.writeText(text)}
      >
        Copy codes
      </Button>
      <Button className="mt-3 w-full" onClick={onContinue}>
        I saved them
      </Button>
    </div>
  )
}

function RecoverySetup() {
  const [codes, setCodes] = useState<string[]>([])
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  if (codes.length > 0) {
    return (
      <main className="grid min-h-screen place-items-center px-5">
        <Card className="w-full max-w-md p-7">
          <RecoveryCodes
            codes={codes}
            onContinue={() => {
              window.sessionStorage.removeItem("conduit:recovery-setup")
              window.location.reload()
            }}
          />
        </Card>
      </main>
    )
  }
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <Card className="w-full max-w-md p-7">
        <h1 className="font-display text-2xl font-semibold">Protect your account</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Conduit does not depend on paid email reset services. Generate ten one-time recovery
          codes before continuing.
        </p>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        <Button
          className="mt-5 w-full"
          disabled={pending}
          onClick={async () => {
            setPending(true)
            setError("")
            try {
              const result = await api<{ codes: string[] }>("/v1/auth/recovery-codes", {
                method: "POST",
              })
              setCodes(result.codes)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not generate codes")
            } finally {
              setPending(false)
            }
          }}
        >
          {pending ? "Generating…" : "Generate recovery codes"}
        </Button>
      </Card>
    </main>
  )
}

interface AdminAuthSettings {
  registrationMode: "open" | "closed"
  oauthProvider: "google" | "oidc"
  oidcEnabled: boolean
  oidcIssuer: string
  oidcClientId: string
  oidcDisplayName: string
  oidcScopes: string
  oidcAutoRegister: boolean
  hasClientSecret: boolean
  googleCallbackUrl: string
  oidcCallbackUrl: string
}

function AdminRecoveryScreen() {
  const token = new URLSearchParams(window.location.search).get("token") ?? ""
  const recovery = useQuery({
    queryKey: ["admin-recovery", token],
    queryFn: () =>
      api<{ email: string; expiresAt: string }>("/v1/auth/admin-recovery/inspect", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
    retry: false,
    enabled: token.length > 0,
  })
  const [complete, setComplete] = useState(false)
  const reset = useMutation({
    mutationFn: (password: string) =>
      api("/v1/auth/admin-recovery/password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),
    onSuccess: () => setComplete(true),
  })

  return (
    <main className="grid min-h-screen place-items-center px-5">
      <Card className="w-full max-w-md p-7">
        <Shield className="mb-5 text-amber-400" />
        <h1 className="font-display text-2xl font-semibold">Local account recovery</h1>
        {complete ? (
          <>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Local password access has been restored and existing sessions were revoked.
            </p>
            <a className="mt-5 inline-flex text-sm font-medium text-amber-300" href="/">
              Return to sign in
            </a>
          </>
        ) : recovery.isLoading ? (
          <p className="mt-3 text-sm text-zinc-500">Validating this one-time link…</p>
        ) : recovery.isError || !token ? (
          <p className="mt-3 text-sm text-red-300">
            This recovery link is invalid, expired, or has already been used.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Set a new local password for <span className="text-zinc-200">{recovery.data!.email}</span>.
              This link will be consumed and all existing sessions will be revoked.
            </p>
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                reset.mutate(String(new FormData(event.currentTarget).get("password")))
              }}
            >
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                placeholder="New password"
                required
              />
              {reset.error && <p className="text-sm text-red-300">{reset.error.message}</p>}
              <Button className="w-full" disabled={reset.isPending}>
                {reset.isPending ? "Restoring…" : "Restore local login"}
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  )
}

function AdminScreen() {
  const settings = useQuery({
    queryKey: ["admin-auth"],
    queryFn: () => api<AdminAuthSettings>("/v1/admin/auth"),
  })
  const [message, setMessage] = useState("")
  const [oauthProvider, setOauthProvider] = useState<"google" | "oidc">("google")
  useEffect(() => {
    if (settings.data) setOauthProvider(settings.data.oauthProvider)
  }, [settings.data])
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api<{ saved: boolean; restartRequired: boolean }>("/v1/admin/auth", {
        method: "PUT",
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      setMessage("Saved. Restart the Conduit server to apply authentication changes.")
      await settings.refetch()
    },
  })

  if (settings.isLoading) return <CenteredMessage>Loading instance administration…</CenteredMessage>
  if (settings.isError) {
    return (
      <CenteredMessage>
        This page is only available to the instance owner. <a className="text-amber-300" href="/">Return to Conduit</a>
      </CenteredMessage>
    )
  }
  const value = settings.data!
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10">
      <a className="text-sm text-zinc-500 hover:text-white" href="/">← Back to Conduit</a>
      <div className="mt-6 flex items-center gap-3">
        <Shield className="text-amber-400" />
        <div>
          <h1 className="font-display text-3xl font-semibold">Instance authentication</h1>
          <p className="text-sm text-zinc-500">Owner-only settings for account access.</p>
        </div>
      </div>
      <Card className="mt-8 p-7">
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault()
            setMessage("")
            const data = new FormData(event.currentTarget)
            save.mutate({
              registrationMode: String(data.get("registrationMode")),
              oauthProvider: String(data.get("oauthProvider")),
              oidcEnabled: data.has("oidcEnabled"),
              oidcIssuer: String(data.get("oidcIssuer")),
              oidcClientId: String(data.get("oidcClientId")),
              oidcClientSecret: String(data.get("oidcClientSecret")),
              oidcDisplayName: String(data.get("oidcDisplayName")),
              oidcScopes: String(data.get("oidcScopes")),
              oidcAutoRegister: data.has("oidcAutoRegister"),
            })
          }}
        >
          <label className="block text-sm text-zinc-300">
            Local account registration
            <select
              name="registrationMode"
              defaultValue={value.registrationMode}
              className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3"
            >
              <option value="closed">Owner setup only / closed</option>
              <option value="open">Open registration</option>
            </select>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input name="oidcEnabled" type="checkbox" defaultChecked={value.oidcEnabled} />
            Enable OAuth login
          </label>
          <label className="block text-sm text-zinc-300">
            Login provider
            <select
              name="oauthProvider"
              value={oauthProvider}
              onChange={(event) => setOauthProvider(event.target.value as "google" | "oidc")}
              className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3"
            >
              <option value="google">Google</option>
              <option value="oidc">Custom OpenID Connect</option>
            </select>
          </label>
          {oauthProvider === "google" ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
              <p className="font-medium text-zinc-200">Google defaults</p>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div><dt className="text-zinc-600">Login button</dt><dd className="mt-1">Continue with Google</dd></div>
                <div><dt className="text-zinc-600">Requested access</dt><dd className="mt-1">Email address only</dd></div>
              </dl>
              <input type="hidden" name="oidcDisplayName" value="Continue with Google" />
              <input type="hidden" name="oidcScopes" value="openid email" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input name="oidcDisplayName" defaultValue={value.oidcDisplayName} placeholder="Button label" required />
              <Input name="oidcScopes" defaultValue={value.oidcScopes} placeholder="openid email" required />
            </div>
          )}
          {oauthProvider === "oidc" && (
            <Input name="oidcIssuer" defaultValue={value.oidcIssuer} placeholder="https://id.example.com/.well-known/openid-configuration" />
          )}
          {oauthProvider === "google" && <input type="hidden" name="oidcIssuer" value="" />}
          <Input name="oidcClientId" defaultValue={value.oidcClientId} placeholder="Client ID" />
          <Input
            name="oidcClientSecret"
            type="password"
            placeholder={value.hasClientSecret ? "Client secret saved — leave blank to keep it" : "Client secret"}
          />
          <label className="flex items-center gap-3 text-sm">
            <input name="oidcAutoRegister" type="checkbox" defaultChecked={value.oidcAutoRegister} />
            Automatically create accounts for new OAuth users
          </label>
          <div className="rounded-xl bg-zinc-950 p-4">
            <p className="text-xs text-zinc-500">OIDC callback URL</p>
            <code className="mt-1 block overflow-x-auto text-xs text-zinc-300">
              {oauthProvider === "google" ? value.googleCallbackUrl : value.oidcCallbackUrl}
            </code>
          </div>
          <p className="text-xs leading-5 text-zinc-500">
            Saving does not activate a provider immediately. Restart the Conduit server, then
            sign out or use a private browser window to see the login button.
          </p>
          {message && <p className="text-sm text-amber-300">{message}</p>}
          {save.error && <p className="text-sm text-red-400">{save.error.message}</p>}
          <Button disabled={save.isPending}>{save.isPending ? "Saving…" : "Save settings"}</Button>
        </form>
      </Card>
    </main>
  )
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-zinc-400">
      {children}
    </main>
  )
}
