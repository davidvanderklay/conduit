import { useEffect, useMemo, useState } from "react"
import { Check, Copy, Link2, LoaderCircle, LogOut, Square, UsersRound, X } from "lucide-react"
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
  type WatchPartyEvent,
  type WatchPartyMedia,
  type WatchPartySummary,
} from "../lib/watch-party"
import type { ProgressMetadata } from "../lib/api"
import { Button } from "./ui/button"
import { Card } from "./ui/card"

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
        active ? "bg-amber-400/15 text-amber-300" : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
      } ${className}`}
      onClick={onClick}
    >
      <UsersRound size={18} />
    </button>
  )
}

export function WatchPartyDialog({
  open,
  onOpenChange,
  profile,
  media,
  initialInviteToken,
  initialParty,
  initialSession,
  onPartyJoined,
  onPartyLeft,
  onSessionChange,
}: {
  open: boolean
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
  onSessionChange?: (session: WatchPartySession | undefined) => void
}) {
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
    if (initialParty && initialSession && initialSession !== session) {
      setParty(initialParty)
      setSession(initialSession)
    }
  }, [initialParty, initialSession, session])

  useEffect(() => {
    if (!open) return
    setInviteToken(initialInviteToken ?? "")
    setError(undefined)
    setCopied(false)
    let cancelled = false
    void listWatchParties(profile.id)
      .then((result) => {
        if (!cancelled) setParties(result.parties)
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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [onOpenChange, open])

  useEffect(() => {
    onSessionChange?.(session)
    if (!session) return
    setConnection("connecting")
    return session.subscribe((event) => {
      if (event.type === "connected") setConnection("connected")
      if (event.type === "disconnected") setConnection("offline")
      if (event.type === "ended") {
        setParties((current) => current.filter((candidate) => candidate.id !== session.partyId))
        setParty((current) => current?.id === session.partyId ? undefined : current)
        setSession((current) => current === session ? undefined : current)
        setConnection("offline")
      }
      if (event.type === "presence") {
        setParty((current) => current ? { ...current, memberCount: event.participants.length, members: event.participants } : current)
      }
    })
  }, [onSessionChange, session])

  const activeParty = party?.status === "active" ? party : undefined
  const canCreate = Boolean(media)
  const sortedParties = useMemo(
    () => parties.filter((candidate) => candidate.status === "active"),
    [parties],
  )

  if (!open) return null

  async function start(response: WatchPartySessionResponse) {
    session?.close()
    const next = createWatchPartySession(profile.id, response)
    setSession(next)
    setParty(response.party)
    setInviteUrl(response.invite?.url)
    next.connect()
    setParties((current) => [response.party, ...current.filter((candidate) => candidate.id !== response.party.id)])
    onPartyJoined?.(response.party, next, response)
  }

  async function create() {
    if (!media) return
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
      await start(await joinWatchParty(candidate.id, profile.id))
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
      const result = await createWatchPartyInvite(activeParty.id)
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
      if (session?.role === "host") await endWatchParty(activeParty.id)
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
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-start sm:justify-end sm:p-6"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <Card
        className="max-h-[min(760px,calc(100dvh-1.5rem))] w-full max-w-md overflow-y-auto border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 sm:mt-12"
        role="dialog"
        aria-modal="true"
        aria-label="Watch together"
      >
        <div className="flex items-start gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-400/10 text-amber-300"><UsersRound size={18} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">Watch together</h2>
            <p className="mt-1 truncate text-xs text-zinc-500">{activeParty ? activeParty.media.title : media?.title ?? "Start or join a party"}</p>
          </div>
          <button type="button" aria-label="Close" title="Close" className="grid size-9 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900 hover:text-white" onClick={() => onOpenChange(false)}><X size={18} /></button>
        </div>

        <div className="space-y-5 p-5">
          {activeParty ? (
            <ActiveParty
              party={activeParty}
              inviteUrl={inviteUrl}
              copied={copied}
              loading={loading}
              connection={connection}
              isHost={session?.role === "host"}
              onCopy={() => void copyInvite()}
              onInvite={() => void invite()}
              onLeave={() => void leave()}
            />
          ) : (
            <>
              {sortedParties.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Active parties</h3><span className="text-xs text-zinc-600">{sortedParties.length}</span></div>
                  <div className="space-y-2">
                    {sortedParties.map((candidate) => (
                      <button key={candidate.id} type="button" disabled={loading} onClick={() => void join(candidate)} className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-left hover:border-zinc-700 disabled:opacity-50">
                        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-800 text-zinc-300"><UsersRound size={15} /></div>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm text-zinc-200">{candidate.media.title}</span><span className="mt-0.5 block text-xs text-zinc-500">{candidate.memberCount} participant{candidate.memberCount === 1 ? "" : "s"} · {candidate.mode === "private" ? "Household only" : "Household + invited guests"}</span></span>
                        <span className="text-xs font-medium text-amber-300">Join</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="border-t border-zinc-800 pt-5">
                <h3 className="text-sm font-semibold">Start a party</h3>
                {canCreate ? (
                  <>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <ModeButton active={mode === "private"} title="Private" detail="Household only" onClick={() => setMode("private")} />
                      <ModeButton active={mode === "shared"} title="Invite someone" detail="Household + outside guests" onClick={() => setMode("shared")} />
                    </div>
                    {mode === "shared" && <p className="mt-3 text-xs leading-5 text-zinc-500">People in your household can join this party from Active parties. Use the invite link for people outside your account.</p>}
                    <Button className="mt-3 h-10 w-full" disabled={loading} onClick={() => void create()}>{loading ? <LoaderCircle className="animate-spin" size={16} /> : <UsersRound size={16} />}{loading ? "Starting…" : mode === "private" ? "Start private party" : "Start shared party"}</Button>
                  </>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-zinc-500">Open a movie or episode first to start a new party.</p>
                )}
              </section>

              <section className="border-t border-zinc-800 pt-5">
                <h3 className="text-sm font-semibold">Join with an invite</h3>
                <div className="mt-3 flex gap-2"><input value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} placeholder="Paste an invite link or token" className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-amber-400" /><Button variant="secondary" className="h-10 shrink-0" disabled={loading || !inviteToken.trim()} onClick={() => void acceptInvite()}>Join</Button></div>
              </section>
            </>
          )}
          {error && <p className="rounded-lg border border-red-950 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>}
        </div>
      </Card>
    </div>
  )
}

function ActiveParty({
  party,
  inviteUrl,
  copied,
  loading,
  connection,
  isHost,
  onCopy,
  onInvite,
  onLeave,
}: {
  party: WatchPartySummary
  inviteUrl?: string
  copied: boolean
  loading: boolean
  connection: "connecting" | "connected" | "offline"
  isHost: boolean
  onCopy: () => void
  onInvite: () => void
  onLeave: () => void
}) {
  return (
    <>
      <div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[.14em] text-zinc-600">Party active</p><h3 className="mt-1 font-display text-xl font-semibold">{party.media.title}</h3></div><span className={`text-xs ${connection === "connected" ? "text-green-300" : "text-zinc-500"}`}>{connection === "connected" ? "● Connected" : connection === "connecting" ? "Connecting…" : "Reconnecting…"}</span></div>
      <div className="space-y-1 border-y border-zinc-800 py-2">{party.members.map((member) => <div key={member.profileId} className="flex items-center justify-between py-2 text-sm"><span className="flex items-center gap-2 text-zinc-300"><span className="grid size-6 place-items-center rounded-full bg-zinc-800 text-[10px]">{member.role === "host" ? "H" : "G"}</span>{member.role === "host" ? "Host" : "Guest"}</span><span className="text-xs text-green-300">{member.role === "host" ? "Controls playback" : "Following host"}</span></div>)}</div>
      {isHost && party.mode === "shared" && <div className="space-y-2"><p className="text-sm text-zinc-400">Household members can join from Active parties. Use an invite for people outside your account.</p>{inviteUrl ? <div className="flex gap-2"><div className="min-w-0 flex-1 truncate rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-300">{inviteUrl}</div><Button variant="secondary" size="icon" aria-label="Copy invite" title="Copy invite" onClick={onCopy}>{copied ? <Check size={16} /> : <Copy size={16} />}</Button></div> : <Button variant="secondary" className="h-9" disabled={loading} onClick={onInvite}><Link2 size={15} />Create invite</Button>}</div>}
      <Button variant="ghost" className="h-9 w-full justify-center text-zinc-500 hover:text-red-300" disabled={loading} onClick={onLeave}>{isHost ? <Square size={15} /> : <LogOut size={15} />}{isHost ? "End party" : "Leave party"}</Button>
    </>
  )
}

function ModeButton({ active, title, detail, onClick }: { active: boolean; title: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-lg border p-3 text-left transition ${active ? "border-amber-400/60 bg-amber-400/10" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"}`}><span className="block text-sm font-medium text-zinc-200">{title}</span><span className="mt-1 block text-xs text-zinc-500">{detail}</span></button>
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
    role: response.party.hostProfileId === profileId ? "host" : "guest",
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
  return value.trim().split("/").pop()?.split("?")[0] ?? value.trim()
}
