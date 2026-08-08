import { randomBytes } from "node:crypto"
import type { Server } from "node:http"
import { WebSocket, WebSocketServer } from "ws"
import type { WatchPartyMedia } from "./db/schema.js"

export const WATCH_PARTY_PROTOCOL_VERSION = 1
export const WATCH_PARTY_TICKET_TTL_MS = 60_000

export interface WatchPartyActor {
  partyId: string
  userId: string
  profileId: string
  role: "host" | "guest"
}

export interface WatchPartyPlaybackState {
  position: number
  duration: number
  playing: boolean
  rate: number
  sequence: number
  serverTime: number
}

export interface WatchPartyParticipant {
  profileId: string
  role: "host" | "guest"
  ready: boolean
  connected: boolean
}

interface PartySocket {
  socket: WebSocket
  actor: WatchPartyActor
  ready: boolean
}

interface Ticket extends WatchPartyActor {
  expiresAt: number
}

interface PartyRuntime {
  media?: WatchPartyMedia
  playback?: WatchPartyPlaybackState
  sockets: Set<PartySocket>
}

type ClientMessage =
  | { v: 1; type: "hello" }
  | { v: 1; type: "media"; media: WatchPartyMedia | null }
  | {
      v: 1
      type: "state"
      position: number
      duration: number
      playing: boolean
      rate: number
      sequence: number
    }
  | {
      v: 1
      type: "command"
      command: "play" | "pause" | "seek" | "rate"
      value?: number
      sequence: number
    }
  | { v: 1; type: "ready"; ready: boolean }
  | { v: 1; type: "leave" }

export class WatchPartyHub {
  private readonly tickets = new Map<string, Ticket>()
  private readonly parties = new Map<string, PartyRuntime>()
  private readonly sockets = new Set<WebSocket>()
  private server?: Server
  private socketServer?: WebSocketServer
  private heartbeat?: ReturnType<typeof setInterval>

  constructor(private readonly onParticipantDisconnected?: (actor: WatchPartyActor) => void) {}

  createTicket(actor: WatchPartyActor): { ticket: string; expiresAt: string } {
    this.pruneTickets()
    const ticket = randomBytes(32).toString("base64url")
    const expiresAt = Date.now() + WATCH_PARTY_TICKET_TTL_MS
    this.tickets.set(ticket, { ...actor, expiresAt })
    return { ticket, expiresAt: new Date(expiresAt).toISOString() }
  }

  attach(server: Server): void {
    if (this.server) return
    this.server = server
    this.socketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://conduit.local")
      if (url.pathname !== "/v1/watch-parties/socket") return
      const ticket = url.searchParams.get("ticket")
      const actor = ticket ? this.consumeTicket(ticket) : undefined
      if (!actor) {
        socket.destroy()
        return
      }
      this.socketServer!.handleUpgrade(request, socket, head, (websocket) => {
        this.handleConnection(websocket, actor)
      })
    })
    this.heartbeat = setInterval(() => {
      this.pruneTickets()
      for (const socket of this.sockets) {
        if (socket.readyState !== WebSocket.OPEN) continue
        socket.ping()
      }
    }, 25_000)
    this.heartbeat.unref?.()
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    for (const socket of this.sockets) socket.close(1001, "Server is stopping")
    this.sockets.clear()
    this.socketServer?.close()
    this.socketServer = undefined
    this.server = undefined
    this.parties.clear()
    this.tickets.clear()
  }

  seedMedia(partyId: string, media: WatchPartyMedia): void {
    const runtime = this.runtime(partyId)
    runtime.media = media
  }

  publishMedia(partyId: string, media: WatchPartyMedia | null): void {
    const runtime = this.runtime(partyId)
    runtime.media = media ?? undefined
    runtime.playback = undefined
    this.broadcast(partyId, { v: 1, type: "media", media })
  }

  removeParty(partyId: string, reason = "Party ended"): void {
    const runtime = this.parties.get(partyId)
    if (!runtime) return
    this.broadcast(partyId, { v: 1, type: "ended", reason })
    for (const participant of runtime.sockets) participant.socket.close(1000, reason)
    this.parties.delete(partyId)
  }

  private consumeTicket(value: string): WatchPartyActor | undefined {
    const ticket = this.tickets.get(value)
    this.tickets.delete(value)
    if (!ticket || ticket.expiresAt <= Date.now()) return undefined
    const { expiresAt: _expiresAt, ...actor } = ticket
    return actor
  }

  private pruneTickets(): void {
    const now = Date.now()
    for (const [value, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) this.tickets.delete(value)
    }
  }

  private runtime(partyId: string): PartyRuntime {
    const existing = this.parties.get(partyId)
    if (existing) return existing
    const runtime = { sockets: new Set<PartySocket>() }
    this.parties.set(partyId, runtime)
    return runtime
  }

  private handleConnection(socket: WebSocket, actor: WatchPartyActor): void {
    const participant: PartySocket = { socket, actor, ready: false }
    const runtime = this.runtime(actor.partyId)
    runtime.sockets.add(participant)
    this.sockets.add(socket)
    socket.on("message", (raw) => this.handleMessage(participant, raw.toString()))
    socket.on("close", () => {
      runtime.sockets.delete(participant)
      this.sockets.delete(socket)
      const sameParticipantConnected = [...runtime.sockets].some(
        (candidate) => candidate.actor.userId === actor.userId && candidate.actor.profileId === actor.profileId,
      )
      if (!sameParticipantConnected) {
        if (actor.role === "host") {
          runtime.media = undefined
          runtime.playback = undefined
          this.broadcast(actor.partyId, { v: WATCH_PARTY_PROTOCOL_VERSION, type: "media", media: null })
        }
        this.onParticipantDisconnected?.(actor)
      }
      this.broadcast(actor.partyId, {
        v: WATCH_PARTY_PROTOCOL_VERSION,
        type: "presence",
        participants: this.participants(runtime),
      })
      if (runtime.sockets.size === 0 && !runtime.media && !runtime.playback) {
        this.parties.delete(actor.partyId)
      }
    })
    socket.on("error", () => socket.close())
    this.sendJoined(participant)
    this.broadcast(actor.partyId, {
      v: WATCH_PARTY_PROTOCOL_VERSION,
      type: "presence",
      participants: this.participants(runtime),
    }, socket)
  }

  private sendJoined(participant: PartySocket): void {
    const runtime = this.runtime(participant.actor.partyId)
    this.send(participant.socket, {
      v: WATCH_PARTY_PROTOCOL_VERSION,
      type: "joined",
      partyId: participant.actor.partyId,
      profileId: participant.actor.profileId,
      role: participant.actor.role,
      media: runtime.media,
      state: runtime.playback,
      participants: this.participants(runtime),
    })
  }

  private handleMessage(participant: PartySocket, raw: string): void {
    const message = parseMessage(raw)
    if (!message) {
      this.send(participant.socket, { v: 1, type: "error", message: "Invalid party message" })
      return
    }
    const runtime = this.runtime(participant.actor.partyId)
    switch (message.type) {
      case "hello":
        this.sendJoined(participant)
        return
      case "ready":
        participant.ready = message.ready
        this.broadcast(participant.actor.partyId, {
          v: 1,
          type: "presence",
          participants: this.participants(runtime),
        })
        return
      case "media":
        if (participant.actor.role !== "host" || (message.media !== null && !validMedia(message.media))) return
        runtime.media = message.media ?? undefined
        runtime.playback = undefined
        this.broadcast(participant.actor.partyId, { v: 1, type: "media", media: message.media })
        return
      case "state":
        if (participant.actor.role !== "host" || !validState(message)) return
        if (runtime.playback && message.sequence <= runtime.playback.sequence) return
        runtime.playback = {
          position: message.position,
          duration: message.duration,
          playing: message.playing,
          rate: message.rate,
          sequence: message.sequence,
          serverTime: Date.now(),
        }
        this.broadcast(participant.actor.partyId, {
          v: 1,
          type: "state",
          ...runtime.playback,
        })
        return
      case "command":
        if (participant.actor.role !== "host" || !validCommand(message)) return
        this.broadcast(participant.actor.partyId, message, participant.socket)
        return
      case "leave":
        participant.socket.close(1000, "You left the party")
        return
    }
  }

  private participants(runtime: PartyRuntime): WatchPartyParticipant[] {
    return [...runtime.sockets].map((participant) => ({
      profileId: participant.actor.profileId,
      role: participant.actor.role,
      ready: participant.ready,
      connected: participant.socket.readyState === WebSocket.OPEN,
    }))
  }

  private broadcast(partyId: string, payload: object, except?: WebSocket): void {
    const runtime = this.runtime(partyId)
    for (const participant of runtime.sockets) {
      if (participant.socket !== except) this.send(participant.socket, payload)
    }
  }

  private send(socket: WebSocket, payload: object): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
  }
}

function parseMessage(raw: string): ClientMessage | undefined {
  if (raw.length > 64 * 1024) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== 1) return undefined
  const message = value as Record<string, unknown>
  if (typeof message.type !== "string") return undefined
  if (message.type === "hello") return { v: 1, type: "hello" }
  if (message.type === "ready" && typeof message.ready === "boolean") {
    return { v: 1, type: "ready", ready: message.ready }
  }
  if (message.type === "leave") return { v: 1, type: "leave" }
  if (message.type === "media" && (message.media === null || validMedia(message.media))) {
    return { v: 1, type: "media", media: message.media }
  }
  if (message.type === "state" && validState(message)) {
    return {
      v: 1,
      type: "state",
      position: message.position as number,
      duration: message.duration as number,
      playing: message.playing as boolean,
      rate: message.rate as number,
      sequence: message.sequence as number,
    }
  }
  if (message.type === "command" && validCommand(message)) {
    return {
      v: 1,
      type: "command",
      command: message.command as "play" | "pause" | "seek" | "rate",
      value: message.value as number | undefined,
      sequence: message.sequence as number,
    }
  }
  return undefined
}

function validMedia(value: unknown): value is WatchPartyMedia {
  if (!value || typeof value !== "object") return false
  const media = value as Record<string, unknown>
  return (
    (media.type === "movie" || media.type === "series") &&
    typeof media.mediaId === "string" && media.mediaId.length <= 300 &&
    typeof media.videoId === "string" && media.videoId.length <= 300 &&
    typeof media.title === "string" && media.title.length <= 300 &&
    (!media.poster || typeof media.poster === "string") &&
    (!media.videoTitle || typeof media.videoTitle === "string") &&
    (!media.season || Number.isInteger(media.season)) &&
    (!media.episode || Number.isInteger(media.episode))
  )
}

function validState(value: Record<string, unknown>): boolean {
  return (
    typeof value.position === "number" && Number.isFinite(value.position) && value.position >= 0 &&
    typeof value.duration === "number" && Number.isFinite(value.duration) && value.duration >= 0 &&
    typeof value.playing === "boolean" &&
    typeof value.rate === "number" && Number.isFinite(value.rate) && value.rate > 0 && value.rate <= 4 &&
    Number.isInteger(value.sequence) && (value.sequence as number) >= 0
  )
}

function validCommand(value: Record<string, unknown>): boolean {
  return (
    value.command === "play" || value.command === "pause" || value.command === "seek" || value.command === "rate"
  ) && Number.isInteger(value.sequence) && (value.value === undefined || (typeof value.value === "number" && Number.isFinite(value.value)))
}
