import { randomBytes, randomUUID } from "node:crypto"
import type { Server } from "node:http"
import { WebSocket, WebSocketServer } from "ws"
import type { WatchPartyMedia } from "./db/schema.js"

export const WATCH_PARTY_PROTOCOL_VERSION = 1
export const WATCH_PARTY_TICKET_TTL_MS = 60_000
export const WATCH_PARTY_HOST_GRACE_MS = 30_000

export interface WatchPartyActor {
  partyId: string
  userId: string
  sessionId?: string
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
  epoch: string
  generation: number
}
interface PartySocket {
  socket: WebSocket
  actor: WatchPartyActor
  ready: boolean
  alive: boolean
  lastSequence: number
  queue: Promise<void>
}
interface PartyRuntime {
  media?: WatchPartyMedia
  playback?: WatchPartyPlaybackState
  epoch: string
  generation: number
  sequence: number
  sockets: Set<PartySocket>
  host?: PartySocket
  grace?: ReturnType<typeof setTimeout>
}
interface HubOptions {
  authorize?: (actor: WatchPartyActor) => Promise<boolean>
  onHostExpired?: (partyId: string) => Promise<void>
  onError?: (error: unknown) => void
  hostGraceMs?: number
}
type Ticket = WatchPartyActor & { expiresAt: number }

/** One API process owns the live timeline. REST owns durable membership and media. */
export class WatchPartyHub {
  private readonly tickets = new Map<string, Ticket>()
  private readonly parties = new Map<string, PartyRuntime>()
  private socketServer?: WebSocketServer
  private heartbeat?: ReturnType<typeof setInterval>
  private detach?: () => void
  private closed = false

  constructor(private readonly options: HubOptions = {}) {}

  createTicket(actor: WatchPartyActor) {
    this.pruneTickets()
    this.runtime(actor.partyId)
    const ticket = randomBytes(32).toString("base64url")
    const expiresAt = Date.now() + WATCH_PARTY_TICKET_TTL_MS
    this.tickets.set(ticket, { ...actor, expiresAt })
    return { ticket, expiresAt: new Date(expiresAt).toISOString() }
  }

  attach(server: Server): void {
    if (this.socketServer) return
    this.closed = false
    const socketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
    this.socketServer = socketServer
    const onUpgrade = (
      request: import("node:http").IncomingMessage,
      socket: import("node:stream").Duplex,
      head: Buffer,
    ) => {
      const url = new URL(request.url ?? "/", "http://conduit.local")
      if (url.pathname !== "/v1/watch-parties/socket") return
      const ticket = url.searchParams.get("ticket")
      const actor = ticket ? this.consumeTicket(ticket) : undefined
      if (!actor) {
        socket.destroy()
        return
      }
      const runtime = this.parties.get(actor.partyId)
      void this.authorize(actor)
        .then((allowed) => {
          if (
            !allowed ||
            this.closed ||
            socket.destroyed ||
            this.parties.get(actor.partyId) !== runtime
          ) {
            socket.destroy()
            return
          }
          socketServer.handleUpgrade(request, socket, head, (websocket) =>
            this.connect(websocket, actor),
          )
        })
        .catch((error: unknown) => {
          this.options.onError?.(error)
          socket.destroy()
        })
    }
    server.on("upgrade", onUpgrade)
    this.detach = () => server.off("upgrade", onUpgrade)
    this.heartbeat = setInterval(() => {
      this.pruneTickets()
      for (const runtime of this.parties.values()) {
        for (const participant of runtime.sockets) {
          if (!participant.alive) {
            participant.socket.terminate()
            continue
          }
          participant.alive = false
          participant.socket.ping()
          void this.authorize(participant.actor)
            .then((allowed) => {
              if (!allowed) participant.socket.close(1008, "Party access expired")
            })
            .catch((error: unknown) => this.options.onError?.(error))
        }
      }
    }, 15_000)
    this.heartbeat.unref()
  }

  close(): void {
    this.closed = true
    this.detach?.()
    clearInterval(this.heartbeat)
    for (const runtime of this.parties.values()) {
      clearTimeout(runtime.grace)
      for (const participant of runtime.sockets)
        participant.socket.close(1001, "Server is stopping")
    }
    this.socketServer?.close()
    this.socketServer = undefined
    this.parties.clear()
    this.tickets.clear()
  }

  seedMedia(partyId: string, media: WatchPartyMedia): void {
    const runtime = this.runtime(partyId)
    // A joining client must not restore stale REST media over a live selection.
    if (!runtime.media && runtime.generation === 0) runtime.media = media
  }

  publishMedia(partyId: string, media: WatchPartyMedia | null): void {
    const runtime = this.runtime(partyId)
    if (JSON.stringify(runtime.media ?? null) === JSON.stringify(media)) return
    runtime.media = media ?? undefined
    runtime.playback = undefined
    runtime.generation += 1
    for (const participant of runtime.sockets) participant.ready = false
    this.broadcast(runtime, { type: "media", media, ...this.version(runtime) })
  }

  removeActor(partyId: string, userId: string, profileId: string): void {
    for (const [value, ticket] of this.tickets) {
      if (ticket.partyId === partyId && ticket.userId === userId && ticket.profileId === profileId)
        this.tickets.delete(value)
    }
    const runtime = this.parties.get(partyId)
    if (!runtime) return
    for (const participant of runtime.sockets) {
      if (participant.actor.userId === userId && participant.actor.profileId === profileId) {
        this.send(participant.socket, { type: "ended", reason: "You left the party" })
        participant.socket.close(1000, "You left the party")
      }
    }
  }

  removeParty(partyId: string, reason = "Party ended"): void {
    // Invalidate even tickets that have not created a runtime yet.
    for (const [value, ticket] of this.tickets)
      if (ticket.partyId === partyId) this.tickets.delete(value)
    const runtime = this.parties.get(partyId)
    if (!runtime) return
    clearTimeout(runtime.grace)
    this.parties.delete(partyId)
    this.broadcast(runtime, { type: "ended", reason })
    for (const participant of runtime.sockets) participant.socket.close(1000, reason)
  }

  private async authorize(actor: WatchPartyActor): Promise<boolean> {
    return this.options.authorize ? this.options.authorize(actor) : true
  }
  private consumeTicket(value: string): WatchPartyActor | undefined {
    const ticket = this.tickets.get(value)
    this.tickets.delete(value)
    if (!ticket || ticket.expiresAt <= Date.now()) return undefined
    const { expiresAt: _expiresAt, ...actor } = ticket
    return actor
  }
  private pruneTickets(): void {
    for (const [value, ticket] of this.tickets)
      if (ticket.expiresAt <= Date.now()) this.tickets.delete(value)
  }
  private runtime(partyId: string): PartyRuntime {
    let runtime = this.parties.get(partyId)
    if (!runtime) {
      runtime = { epoch: randomUUID(), generation: 0, sequence: 0, sockets: new Set() }
      this.parties.set(partyId, runtime)
    }
    return runtime
  }
  private version(runtime: PartyRuntime) {
    return { epoch: runtime.epoch, generation: runtime.generation }
  }
  private connect(socket: WebSocket, actor: WatchPartyActor): void {
    const runtime = this.runtime(actor.partyId)
    const participant: PartySocket = {
      socket,
      actor,
      ready: false,
      alive: true,
      lastSequence: -1,
      queue: Promise.resolve(),
    }
    if (actor.role === "host") {
      const old = runtime.host
      runtime.host = participant
      old?.socket.close(1000, "Host opened another connection")
      clearTimeout(runtime.grace)
      runtime.grace = undefined
    }
    runtime.sockets.add(participant)
    socket.on("pong", () => {
      participant.alive = true
    })
    socket.on("message", (raw) => {
      participant.queue = participant.queue
        .then(async () => {
          if (
            this.closed ||
            this.parties.get(actor.partyId) !== runtime ||
            socket.readyState !== WebSocket.OPEN
          )
            return
          if (!(await this.authorize(actor))) {
            socket.close(1008, "Party access expired")
            return
          }
          this.message(runtime, participant, raw.toString())
        })
        .catch((error: unknown) => this.options.onError?.(error))
    })
    socket.on("error", () => socket.close())
    socket.on("close", () => {
      runtime.sockets.delete(participant)
      if (this.closed || this.parties.get(actor.partyId) !== runtime) return
      if (runtime.host === participant) {
        runtime.host = undefined
        if (runtime.playback) {
          const playback = runtime.playback
          const position =
            playback.position +
            (playback.playing ? ((Date.now() - playback.serverTime) / 1000) * playback.rate : 0)
          this.setState(runtime, {
            ...playback,
            position: Math.min(playback.duration || Infinity, position),
            playing: false,
          })
        }
        this.broadcast(runtime, { type: "host-disconnected" })
        runtime.grace = setTimeout(() => {
          this.removeParty(actor.partyId, "Host disconnected")
          void this.options
            .onHostExpired?.(actor.partyId)
            .catch((error: unknown) => this.options.onError?.(error))
        }, this.options.hostGraceMs ?? WATCH_PARTY_HOST_GRACE_MS)
        runtime.grace.unref()
      }
      this.presence(runtime)
    })
    this.joined(runtime, participant)
    this.presence(runtime)
  }
  private joined(runtime: PartyRuntime, participant: PartySocket): void {
    this.send(participant.socket, {
      type: "joined",
      partyId: participant.actor.partyId,
      profileId: participant.actor.profileId,
      role: participant.actor.role,
      media: runtime.media ?? null,
      state: runtime.playback,
      participants: this.participants(runtime),
      ...this.version(runtime),
      serverTime: Date.now(),
    })
  }
  private participants(runtime: PartyRuntime) {
    return [...runtime.sockets]
      .filter(
        (participant) =>
          participant.socket.readyState === WebSocket.OPEN &&
          (participant.actor.role !== "host" || participant === runtime.host),
      )
      .map(({ actor, ready }) => ({
        profileId: actor.profileId,
        role: actor.role,
        ready,
        connected: true,
      }))
  }
  private presence(runtime: PartyRuntime): void {
    this.broadcast(runtime, { type: "presence", participants: this.participants(runtime) })
  }
  private message(runtime: PartyRuntime, participant: PartySocket, raw: string): void {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      return
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return
    const message = data as Record<string, unknown>
    if (message.v !== 1) return
    if (message.type === "hello") {
      this.joined(runtime, participant)
      return
    }
    if (message.type === "clock" && finite(message.clientTime, 0, Number.MAX_SAFE_INTEGER)) {
      this.send(participant.socket, {
        type: "clock",
        clientTime: message.clientTime,
        serverTime: Date.now(),
      })
      return
    }
    if (message.type === "ready" && typeof message.ready === "boolean") {
      participant.ready = message.ready
      this.presence(runtime)
      return
    }
    if (
      runtime.host !== participant ||
      message.generation !== runtime.generation ||
      message.epoch !== runtime.epoch
    )
      return
    if (
      !Number.isSafeInteger(message.sequence) ||
      typeof message.sequence !== "number" ||
      message.sequence <= participant.lastSequence
    )
      return
    if (
      message.type === "state" &&
      finite(message.position, 0, Number.MAX_SAFE_INTEGER) &&
      finite(message.duration, 0, Number.MAX_SAFE_INTEGER) &&
      finite(message.rate, 0.1, 4) &&
      typeof message.playing === "boolean" &&
      runtime.media
    ) {
      participant.lastSequence = message.sequence
      this.setState(runtime, {
        position: message.position,
        duration: message.duration,
        rate: message.rate,
        playing: message.playing,
      })
      return
    }
    if (message.type === "command" && runtime.playback) {
      const state = runtime.playback
      const next = {
        ...state,
        position:
          state.position +
          (state.playing ? ((Date.now() - state.serverTime) / 1000) * state.rate : 0),
      }
      if (message.command === "play") next.playing = true
      else if (message.command === "pause") next.playing = false
      else if (message.command === "seek" && finite(message.value, 0, Number.MAX_SAFE_INTEGER))
        next.position = message.value
      else if (message.command === "rate" && finite(message.value, 0.1, 4))
        next.rate = message.value
      else return
      participant.lastSequence = message.sequence
      this.setState(runtime, next)
    }
  }
  private setState(
    runtime: PartyRuntime,
    state: Pick<WatchPartyPlaybackState, "position" | "duration" | "playing" | "rate">,
  ): void {
    runtime.playback = {
      ...state,
      position: Math.min(state.duration || Infinity, state.position),
      sequence: ++runtime.sequence,
      serverTime: Date.now(),
      ...this.version(runtime),
    }
    this.broadcast(runtime, { type: "state", ...runtime.playback })
  }
  private broadcast(runtime: PartyRuntime, payload: object): void {
    for (const participant of runtime.sockets) this.send(participant.socket, payload)
  }
  private send(socket: WebSocket, payload: object): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: 1, ...payload }))
  }
}
function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
}
