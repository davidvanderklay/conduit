import { useEffect, useEffectEvent, useState } from "react"
import { UsersRound, X } from "lucide-react"
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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [onOpenChange, open])

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
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 sm:items-center"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto border border-zinc-700 bg-black p-5 text-white"
        role="dialog"
        aria-modal="true"
        aria-label="Watch together"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Watch together</h2>
          <button type="button" aria-label="Close watch party" onClick={() => onOpenChange(false)}>
            <X size={20} />
          </button>
        </div>
        {activeParty ? (
          <>
            <div className="flex justify-between gap-3 border-b border-zinc-700 pb-3">
              <span>{partyMediaTitle(activeParty.media)}</span>
              <span className="text-sm">
                {connection === "connected"
                  ? "Connected"
                  : connection === "connecting"
                    ? "Connecting…"
                    : "Reconnecting…"}
              </span>
            </div>
            {activeParty.members.map((member) => (
              <div
                key={member.profileId}
                className="flex justify-between border-b border-zinc-800 py-3 text-sm"
              >
                <span>
                  {member.profileId === profile.id
                    ? "You"
                    : member.role === "host"
                      ? "Host"
                      : "Guest"}
                </span>
                <span>
                  {member.role === "host"
                    ? "Controls playback"
                    : member.ready
                      ? "Ready"
                      : "Following host"}
                </span>
              </div>
            ))}
            <div className="mt-4 flex gap-4">
              {activeParty.isHost && activeParty.mode === "shared" && (
                <button
                  disabled={loading}
                  type="button"
                  onClick={() => void (inviteUrl ? copyInvite() : invite())}
                >
                  {inviteUrl ? (copied ? "Copied" : "Copy invite") : "Create invite"}
                </button>
              )}
              <button disabled={loading} type="button" onClick={() => void leave()}>
                {activeParty.isHost ? "End party" : "Leave party"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex gap-4">
              <button
                type="button"
                onClick={() => setMode("private")}
                aria-pressed={mode === "private"}
              >
                {mode === "private" ? "✓ " : ""}Household
              </button>
              <button
                type="button"
                onClick={() => setMode("shared")}
                aria-pressed={mode === "shared"}
              >
                {mode === "shared" ? "✓ " : ""}Invite guests
              </button>
            </div>
            <button
              className="border border-zinc-600 px-3 py-2"
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
                  className="mt-3 flex items-center justify-between border-b border-zinc-700 py-3"
                >
                  <span>
                    {partyMediaTitle(candidate.media)} · {candidate.memberCount}
                  </span>
                  <button disabled={loading} type="button" onClick={() => void join(candidate)}>
                    Join
                  </button>
                </div>
              ))}
            <label className="mt-5 block text-sm" htmlFor="party-invite">
              Invite link or token
            </label>
            <input
              id="party-invite"
              className="my-2 w-full border border-zinc-600 bg-black p-2 text-white"
              value={inviteToken}
              onChange={(event) => setInviteToken(event.target.value)}
            />
            <button
              disabled={loading || !inviteToken.trim()}
              type="button"
              onClick={() => void acceptInvite()}
            >
              Join party
            </button>
          </>
        )}
        {loading && <p className="mt-3 text-sm">Working…</p>}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
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
