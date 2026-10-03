import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Check, Film, House, Link, UsersRound, X } from "lucide-react"
import type { Profile } from "../lib/api"
import { API_URL } from "../lib/auth"
import {
  acceptWatchPartyInvite,
  createWatchParty,
  createWatchPartyInvite,
  endWatchParty,
  joinWatchParty,
  leaveWatchParty,
  listWatchParties,
  refreshWatchPartyTicket,
  type WatchPartySessionResponse,
} from "../lib/watch-party-api"
import {
  mediaFromProgressMetadata,
  WatchPartySession,
  type WatchPartyMedia,
  type WatchPartySummary,
} from "../lib/watch-party"
import type { ProgressMetadata } from "../lib/api"

export function WatchPartyButton({
  onClick,
  active = false,
  className = "",
}: {
  onClick: () => void
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label="Watch together"
      title="Watch together"
      className={`grid size-10 shrink-0 place-items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
        active
          ? "bg-amber-400/15 text-amber-300"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
      } ${className}`}
      onClick={onClick}
    >
      <UsersRound size={18} />
    </button>
  )
}

export function WatchPartyDialog({
  open,
  presentation = "modal",
  onOpenChange,
  profile,
  media,
  initialInviteToken,
  initialParty,
  initialSession,
  onPartyJoined,
  onPartyLeft,
  onPartyMediaChange,
  onSessionChange,
}: {
  open: boolean
  presentation?: "modal" | "sidebar"
  onOpenChange: (open: boolean) => void
  profile: Profile
  media?: WatchPartyMedia
  initialInviteToken?: string
  initialParty?: WatchPartySummary
  initialSession?: WatchPartySession
  onPartyJoined?: (
    party: WatchPartySummary,
    session: WatchPartySession,
    response: WatchPartySessionResponse,
  ) => void
  onPartyLeft?: (partyId: string) => void
  onPartyMediaChange?: (media: WatchPartyMedia | undefined, session: WatchPartySession) => void
  onSessionChange?: (session: WatchPartySession | undefined) => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [parties, setParties] = useState<WatchPartySummary[]>([])
  const [party, setParty] = useState<WatchPartySummary | undefined>(initialParty)
  const [inviteUrl, setInviteUrl] = useState<string>()
  const [session, setSession] = useState<WatchPartySession | undefined>(initialSession)
  const [mode, setMode] = useState<"private" | "shared">("private")
  const [inviteToken, setInviteToken] = useState(initialInviteToken ?? "")
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [connection, setConnection] = useState<"connecting" | "connected" | "offline">("connecting")

  useEffect(() => {
    if (
      initialParty &&
      (party?.id !== initialParty.id ||
        partyMediaKey(party.media) !== partyMediaKey(initialParty.media))
    )
      setParty(initialParty)
    if (initialSession && initialSession !== session) setSession(initialSession)
  }, [initialParty, initialSession, party, session])

  const restoreHostedParty = useEffectEvent((hostedParty: WatchPartySummary | undefined) => {
    if (!hostedParty || party || session) return
    setLoading(true)
    void joinWatchParty(hostedParty.id, hostedParty.hostProfileId)
      .then((response) => start(response, true, hostedParty.hostProfileId))
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setLoading(false))
  })
  const notifySession = useEffectEvent((value: WatchPartySession | undefined) =>
    onSessionChange?.(value),
  )
  const notifyMedia = useEffectEvent(
    (value: WatchPartyMedia | undefined, valueSession: WatchPartySession) =>
      onPartyMediaChange?.(value, valueSession),
  )

  useEffect(() => {
    if (!open) return
    setInviteToken(initialInviteToken ?? "")
    setError(undefined)
    setCopied(false)
    let cancelled = false
    void listWatchParties(profile.id)
      .then((result) => {
        if (cancelled) return
        setParties(result.parties)
        const hostedParty = result.parties.find(
          (candidate) => candidate.status === "active" && candidate.isHost,
        )
        restoreHostedParty(hostedParty)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause))
      })
    return () => {
      cancelled = true
    }
  }, [initialInviteToken, open, profile.id])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    panelRef.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [open])

  useEffect(() => {
    notifySession(session)
    if (!session) return
    setConnection("connecting")
    return session.subscribe((event) => {
      if (event.type === "connected") setConnection("connected")
      if (event.type === "disconnected") setConnection("offline")
      if (event.type === "ended") {
        setParties((current) => current.filter((candidate) => candidate.id !== session.partyId))
        setParty((current) => (current?.id === session.partyId ? undefined : current))
        setSession((current) => (current === session ? undefined : current))
        setConnection("offline")
      }
      if (event.type === "presence") {
        const participants = uniquePartyMembers(event.participants)
        setParty((current) =>
          current
            ? { ...current, memberCount: participants.length, members: participants }
            : current,
        )
      }
      if (event.type === "media") {
        setParty((current) => (current ? { ...current, media: event.media ?? undefined } : current))
        notifyMedia(event.media ?? undefined, session)
      }
      if (event.type === "joined") {
        setConnection("connected")
        setParty((current) =>
          current
            ? {
                ...current,
                media: event.media,
                members: uniquePartyMembers(event.participants),
                memberCount: uniquePartyMembers(event.participants).length,
              }
            : current,
        )
        notifyMedia(event.media, session)
      }
    })
  }, [session])

  const activeParty = party?.status === "active" ? party : undefined
  const canCreate = true

  if (!open) return null

  async function start(
    response: WatchPartySessionResponse,
    notify = true,
    sessionProfileId = profile.id,
  ) {
    session?.close()
    const next = createWatchPartySession(sessionProfileId, response)
    const nextParty = response.party
    setSession(next)
    setParty(nextParty)
    setInviteUrl(response.invite?.url)
    next.connect()
    setParties((current) => [
      nextParty,
      ...current.filter((candidate) => candidate.id !== nextParty.id),
    ])
    if (notify) onPartyJoined?.(nextParty, next, response)
  }

  async function create() {
    setLoading(true)
    setError(undefined)
    try {
      await start(await createWatchParty(profile.id, mode, media))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  async function join(candidate: WatchPartySummary) {
    setLoading(true)
    setError(undefined)
    try {
      const joinProfileId = candidate.isHost ? candidate.hostProfileId : profile.id
      await start(await joinWatchParty(candidate.id, joinProfileId), true, joinProfileId)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  async function acceptInvite() {
    if (!inviteToken.trim()) return
    setLoading(true)
    setError(undefined)
    try {
      await start(await acceptWatchPartyInvite(inviteTokenValue(inviteToken), profile.id))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return
    await navigator.clipboard?.writeText(inviteUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  async function invite() {
    if (!activeParty) return
    setLoading(true)
    setError(undefined)
    try {
      const result = await createWatchPartyInvite(activeParty.id, activeParty.hostProfileId)
      setInviteUrl(result.invite.url)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  async function leave() {
    if (!activeParty) return
    setLoading(true)
    try {
      const isHost = session?.role === "host" || activeParty.isHost
      if (isHost) await endWatchParty(activeParty.id, activeParty.hostProfileId)
      else await leaveWatchParty(activeParty.id, profile.id)
      onPartyLeft?.(activeParty.id)
      session?.close()
      setParties((current) => current.filter((candidate) => candidate.id !== activeParty.id))
      setSession(undefined)
      setParty(undefined)
      setInviteUrl(undefined)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[70] flex ${presentation === "sidebar" ? "justify-end bg-black/25" : "items-center justify-center bg-black/60 p-4"}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`flex w-[24rem] flex-col bg-black text-white shadow-2xl shadow-black/60 outline-none ${presentation === "sidebar" ? "h-dvh max-w-[90vw] rounded-l-3xl border-l border-white/10" : "max-h-[calc(100dvh-2rem)] max-w-full overflow-hidden rounded-2xl border border-white/10"}`}
        role="dialog"
        aria-modal="true"
        aria-label="Watch together"
        onKeyDown={(event) => {
          if (event.key === "Escape") onOpenChange(false)
          if (event.key !== "Tab") return
          const controls = event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          )
          const first = controls[0]
          const last = controls[controls.length - 1]
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === event.currentTarget)
          ) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
      >
        <div className="flex shrink-0 items-center justify-between px-6 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <UsersRound size={20} className="text-amber-400" />
            <h2 className="font-display text-lg font-semibold tracking-tight">Watch together</h2>
          </div>
          <button
            className="grid size-9 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            type="button"
            aria-label="Close watch party"
            onClick={() => onOpenChange(false)}
          >
            <X size={20} />
          </button>
        </div>
        {activeParty ? (
          <>
            <div
              className={`min-h-0 overflow-y-auto overscroll-contain px-6 ${presentation === "sidebar" ? "flex-1" : ""}`}
            >
              <div className="flex items-center gap-3 border-b border-white/10 pb-5">
                <div className="relative grid h-16 w-11 shrink-0 place-items-center overflow-hidden rounded-md bg-zinc-900 text-zinc-500">
                  <Film size={20} />
                  {activeParty.media?.poster && (
                    <img
                      src={activeParty.media.poster}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      onError={(event) => {
                        event.currentTarget.hidden = true
                      }}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-semibold leading-5">
                    {partyMediaTitle(activeParty.media)}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                    <span
                      className={`size-1.5 rounded-full ${connection === "connected" ? "bg-amber-400" : "bg-zinc-500"}`}
                    />
                    {connection === "connected"
                      ? "Connected"
                      : connection === "connecting"
                        ? "Connecting…"
                        : "Reconnecting…"}
                  </p>
                </div>
              </div>
              <h3 className="mb-2 mt-5 text-xs font-medium text-zinc-300">
                Watching · {activeParty.members.length}
              </h3>
              {activeParty.members.map((member, index) => {
                const self = member.profileId === profile.id
                const label = self
                  ? "You"
                  : member.role === "host"
                    ? "Host"
                    : `Guest ${activeParty.members.slice(0, index + 1).filter((candidate) => candidate.role !== "host").length}`
                return (
                  <div key={member.profileId} className="flex min-h-12 items-center gap-3 text-sm">
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-lg text-xs font-medium ${self ? "bg-amber-400/15 text-amber-300" : "bg-zinc-900 text-zinc-300"}`}
                    >
                      {self ? "Y" : member.role === "host" ? "H" : "G"}
                    </span>
                    <span>{label}</span>
                    <span className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
                      {member.role === "host" ? (
                        "Host"
                      ) : member.ready ? (
                        <>
                          <Check size={13} className="text-amber-400" />
                          Ready
                        </>
                      ) : (
                        "Following host"
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="mx-6 flex shrink-0 flex-col gap-2 border-t border-white/10 py-5">
              {activeParty.isHost && activeParty.mode === "shared" && (
                <button
                  className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 text-sm font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
                  disabled={loading}
                  type="button"
                  onClick={() => void (inviteUrl ? copyInvite() : invite())}
                >
                  {copied ? <Check size={16} /> : <Link size={16} />}
                  {inviteUrl ? (copied ? "Copied" : "Copy invite") : "Create invite"}
                </button>
              )}
              <button
                className="min-h-10 rounded-lg text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                disabled={loading}
                type="button"
                onClick={() => void leave()}
              >
                {activeParty.isHost ? "End party" : "Leave party"}
              </button>
            </div>
          </>
        ) : (
          <div
            className={`flex min-h-0 flex-col overflow-y-auto overscroll-contain px-6 pb-6 ${presentation === "sidebar" ? "flex-1" : ""}`}
          >
            <div className="space-y-1">
              {(["private", "shared"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setMode(choice)}
                  aria-pressed={mode === choice}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-xl px-3 text-left ${mode === choice ? "bg-amber-400 text-zinc-950" : "text-zinc-300 hover:bg-zinc-900"}`}
                >
                  {choice === "private" ? <House size={18} /> : <Link size={18} />}
                  <span className="flex-1">
                    <span className="block text-sm font-medium">
                      {choice === "private" ? "Household" : "Invite guests"}
                    </span>
                    <span
                      className={`mt-1 block text-xs ${mode === choice ? "text-amber-950/80" : "text-zinc-500"}`}
                    >
                      {choice === "private" ? "Profiles in your household" : "Share a one-use link"}
                    </span>
                  </span>
                  {mode === choice && <Check size={16} />}
                </button>
              ))}
            </div>
            <button
              className="mt-4 min-h-10 shrink-0 rounded-lg bg-amber-400 px-4 text-sm font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
              disabled={loading || !canCreate}
              type="button"
              onClick={() => void create()}
            >
              Start party
            </button>
            {parties
              .filter((candidate) => candidate.status === "active")
              .map((candidate) => (
                <div
                  key={candidate.id}
                  className="mt-4 flex items-center gap-3 border-t border-white/10 pt-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{partyMediaTitle(candidate.media)}</p>
                    <p className="mt-1 text-xs text-zinc-400">{candidate.memberCount} watching</p>
                  </div>
                  <button
                    className="min-h-9 rounded-lg border border-white/15 px-3 text-xs hover:bg-zinc-900 disabled:opacity-50"
                    disabled={loading}
                    type="button"
                    onClick={() => void join(candidate)}
                  >
                    Join
                  </button>
                </div>
              ))}
            <div className="mt-auto pt-8">
              <label
                className="mb-3 block border-t border-white/10 pt-5 text-xs font-medium text-zinc-300"
                htmlFor="party-invite"
              >
                Join a party
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-700 p-1.5 focus-within:border-amber-400">
                <input
                  id="party-invite"
                  placeholder="Paste invite link"
                  aria-label="Invite link or token"
                  className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-white outline-none placeholder:text-zinc-500"
                  value={inviteToken}
                  onChange={(event) => setInviteToken(event.target.value)}
                />
                <button
                  className="min-h-8 rounded-md bg-zinc-800 px-3 text-xs font-medium hover:bg-zinc-700 disabled:opacity-40"
                  disabled={loading || !inviteToken.trim()}
                  type="button"
                  onClick={() => void acceptInvite()}
                >
                  Join party
                </button>
              </div>
            </div>
          </div>
        )}
        {(loading || error) && (
          <div className="shrink-0 px-6 pb-5">
            {loading && <p className="text-xs text-zinc-400">Working…</p>}
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function mediaForParty(metadata: ProgressMetadata, videoId: string) {
  return mediaFromProgressMetadata(metadata, videoId)
}

export function createWatchPartySession(profileId: string, response: WatchPartySessionResponse) {
  return new WatchPartySession({
    partyId: response.party.id,
    ticket: response.ticket,
    expiresAt: response.expiresAt,
    socketPath: response.socketPath,
    role: response.party.isHost ? "host" : "guest",
    refreshTicket: () => refreshWatchPartyTicket(response.party.id, profileId),
    apiUrl: API_URL,
  })
}

function errorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return "Watch party request failed"
  try {
    const payload = JSON.parse(cause.message) as { message?: unknown }
    if (typeof payload.message === "string") return payload.message
  } catch {
    // Fall through to the original message for non-JSON errors.
  }
  return cause.message
}

function inviteTokenValue(value: string): string {
  const input = value.trim()
  if (!input.includes("://")) return input
  const link = new URL(input)
  if (
    !["http:", "https:"].includes(link.protocol) ||
    link.hostname !== new URL(API_URL).hostname ||
    !link.pathname.startsWith("/party/")
  )
    throw new Error("This invitation belongs to another server")
  return link.pathname.slice("/party/".length)
}

function uniquePartyMembers(members: WatchPartySummary["members"]): WatchPartySummary["members"] {
  const seen = new Set<string>()
  return members.filter((member) => {
    if (seen.has(member.profileId)) return false
    seen.add(member.profileId)
    return true
  })
}

function partyMediaTitle(media?: WatchPartyMedia): string {
  return media?.videoTitle
    ? `${media.title} · ${media.videoTitle}`
    : (media?.title ?? "Waiting for content")
}

function partyMediaKey(media?: WatchPartyMedia): string {
  return media
    ? [media.type, media.mediaId, media.videoId, media.season ?? "", media.episode ?? ""].join(":")
    : ""
}
