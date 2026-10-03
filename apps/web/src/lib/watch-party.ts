import type { ProgressMetadata } from "./api"

export interface WatchPartyMedia {
  type: "movie" | "series"
  mediaId: string
  videoId: string
  title: string
  poster?: string
  videoTitle?: string
  season?: number
  episode?: number
}

export interface WatchPartyMember {
  profileId: string
  role: "host" | "guest"
  ready?: boolean
  connected?: boolean
}

export interface WatchPartySummary {
  id: string
  mode: "private" | "shared"
  status: "active" | "ended"
  isHost: boolean
  hostProfileId: string
  media?: WatchPartyMedia
  memberCount: number
  members: WatchPartyMember[]
  createdAt: string
  expiresAt: string
}

export interface WatchPartyInvite {
  url: string
  expiresAt: string
}

export interface WatchPartyTicket {
  ticket: string
  expiresAt: string
  socketPath: string
}

export interface WatchPartyState {
  position: number
  duration: number
  playing: boolean
  rate: number
  sequence: number
  serverTime: number
  epoch: string
  generation: number
}

export type WatchPartyEvent =
  | {
      type: "joined"
      role: "host" | "guest"
      media?: WatchPartyMedia
      state?: WatchPartyState
      participants: WatchPartyMember[]
    }
  | { type: "state"; state: WatchPartyState }
  | { type: "media"; media: WatchPartyMedia | null }
  | { type: "presence"; participants: WatchPartyMember[] }
  | { type: "ended"; reason: string }
  | { type: "error"; message: string }
  | { type: "host-disconnected" }
  | { type: "connected" }
  | { type: "disconnected" }

export interface WatchPartySessionOptions extends WatchPartyTicket {
  partyId: string
  role: "host" | "guest"
  party?: WatchPartySummary
  refreshTicket?: () => Promise<WatchPartyTicket>
  apiUrl?: string
}

/** Lives above player/dialog mounts and replays the current snapshot to late subscribers. */
export class WatchPartySession {
  readonly partyId: string
  readonly role: "host" | "guest"
  private ticket: WatchPartyTicket
  private readonly options: WatchPartySessionOptions
  private socket?: WebSocket
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private clockTimer?: ReturnType<typeof setInterval>
  private closed = false
  connected = false
  private reconnectAttempt = 0
  private sequence = 0
  private revision = -1
  private epoch = ""
  private generation = 0
  private clockOffset = 0
  private serverClock?: { time: number; at: number }
  private bestRoundTrip = Infinity
  private snapshot?: Extract<WatchPartyEvent, { type: "joined" }>
  private readonly listeners = new Set<(event: WatchPartyEvent) => void>()

  constructor(options: WatchPartySessionOptions) {
    this.partyId = options.partyId
    this.role = options.role
    this.ticket = options
    this.options = options
  }
  get party(): WatchPartySummary | undefined {
    const party = this.options.party
    if (!party || this.closed) return undefined
    if (!this.snapshot) return party
    return {
      ...party,
      media: this.snapshot.media,
      members: this.snapshot.participants,
      memberCount: this.snapshot.participants.length,
    }
  }
  get state(): WatchPartyState | undefined {
    return this.snapshot?.state
  }
  get media(): WatchPartyMedia | undefined {
    return this.snapshot?.media
  }

  connect(): void {
    if (this.closed || (this.socket && this.socket.readyState !== WebSocket.CLOSED)) return
    const url = new URL(this.options.apiUrl ?? window.location.origin)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.pathname = this.ticket.socketPath
    url.search = `?ticket=${encodeURIComponent(this.ticket.ticket)}`
    url.hash = ""
    const socket = new WebSocket(url)
    this.socket = socket
    socket.onopen = () => {
      this.connected = true
      this.reconnectAttempt = 0
      this.bestRoundTrip = Infinity
      this.emit({ type: "connected" })
      this.syncClock()
      clearInterval(this.clockTimer)
      this.clockTimer = setInterval(() => this.syncClock(), 15_000)
    }
    socket.onclose = (event) => {
      if (socket !== this.socket || this.closed) return
      this.connected = false
      clearInterval(this.clockTimer)
      this.emit({ type: "disconnected" })
      if (event.code === 1008 || event.code === 1000) {
        this.close()
        this.emit({ type: "ended", reason: event.reason || "Party connection closed" })
      } else this.retry()
    }
    socket.onerror = () => undefined
    socket.onmessage = (event) => this.receive(event.data)
  }
  private retry(): void {
    if (this.closed || !this.options.refreshTicket) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(
      () => {
        void this.options.refreshTicket!()
          .then((ticket) => {
            if (this.closed) return
            this.ticket = ticket
            this.socket = undefined
            this.connect()
          })
          .catch((error: unknown) => {
            if (error instanceof Error) {
              try {
                const payload: unknown = JSON.parse(error.message)
                if (
                  isRecord(payload) &&
                  (payload.statusCode === 403 || payload.statusCode === 404)
                ) {
                  this.close()
                  this.emit({ type: "ended", reason: "Party access expired" })
                  return
                }
              } catch {
                /* Retry transport errors. */
              }
            }
            this.retry()
          })
      },
      Math.min(10_000, 500 * 2 ** this.reconnectAttempt++),
    )
  }
  close(): void {
    this.closed = true
    this.connected = false
    clearTimeout(this.reconnectTimer)
    clearInterval(this.clockTimer)
    this.socket?.close()
    this.socket = undefined
  }
  subscribe(listener: (event: WatchPartyEvent) => void): () => void {
    this.listeners.add(listener)
    if (this.snapshot) listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }
  sendReady(ready: boolean): void {
    this.send({ type: "ready", ready })
  }
  publishState(
    state: Omit<WatchPartyState, "sequence" | "serverTime" | "epoch" | "generation">,
  ): void {
    if (this.role === "host" && this.epoch)
      this.send({
        type: "state",
        ...state,
        sequence: ++this.sequence,
        epoch: this.epoch,
        generation: this.generation,
      })
  }
  publishCommand(command: "play" | "pause" | "seek" | "rate", value?: number): void {
    if (this.role === "host" && this.epoch)
      this.send({
        type: "command",
        command,
        value,
        sequence: ++this.sequence,
        epoch: this.epoch,
        generation: this.generation,
      })
  }
  positionAt(state: WatchPartyState): number {
    return partyPositionAt(
      state,
      this.serverClock
        ? this.serverClock.time + performance.now() - this.serverClock.at
        : Date.now() + this.clockOffset,
    )
  }
  private syncClock(): void {
    this.send({ type: "clock", clientTime: Date.now() })
  }
  private receive(raw: unknown): void {
    let data: unknown
    try {
      data = typeof raw === "string" ? JSON.parse(raw) : raw
    } catch {
      return
    }
    if (!isRecord(data) || data.v !== 1) return
    const message = data
    if (message.type === "clock" && finite(message.clientTime) && finite(message.serverTime)) {
      const now = Date.now()
      const roundTrip = now - message.clientTime
      if (roundTrip >= 0 && roundTrip <= this.bestRoundTrip) {
        this.bestRoundTrip = roundTrip
        this.clockOffset = message.serverTime - (now + message.clientTime) / 2
        this.serverClock = { time: now + this.clockOffset, at: performance.now() }
      }
      return
    }
    if (message.type === "joined" || message.type === "media") {
      if (typeof message.epoch !== "string" || !Number.isSafeInteger(message.generation)) return
      if (this.epoch !== message.epoch || this.generation !== message.generation) this.revision = -1
      this.epoch = message.epoch
      this.generation = message.generation as number
      if (
        message.type === "joined" &&
        finite(message.serverTime) &&
        this.bestRoundTrip === Infinity
      ) {
        this.clockOffset = message.serverTime - Date.now()
        this.serverClock = { time: message.serverTime, at: performance.now() }
      }
      const media = isMedia(message.media) ? message.media : undefined
      const state = isState(message.state) ? message.state : undefined
      if (state) this.revision = state.sequence
      this.snapshot = {
        type: "joined",
        role: this.role,
        media,
        state,
        participants: Array.isArray(message.participants)
          ? message.participants.filter(isMember)
          : (this.snapshot?.participants ?? []),
      }
      this.emit(message.type === "joined" ? this.snapshot : { type: "media", media: media ?? null })
      return
    }
    if (message.type === "state" && isState(message)) {
      if (
        message.epoch !== this.epoch ||
        message.generation !== this.generation ||
        message.sequence <= this.revision
      )
        return
      this.revision = message.sequence
      if (this.snapshot) this.snapshot = { ...this.snapshot, state: message }
      this.emit({ type: "state", state: message })
    } else if (message.type === "presence" && Array.isArray(message.participants)) {
      const participants = message.participants.filter(isMember)
      if (this.snapshot) this.snapshot = { ...this.snapshot, participants }
      this.emit({ type: "presence", participants })
    } else if (message.type === "ended" && typeof message.reason === "string") {
      this.close()
      this.emit({ type: "ended", reason: message.reason })
    } else if (message.type === "host-disconnected") this.emit({ type: "host-disconnected" })
    else if (message.type === "error" && typeof message.message === "string")
      this.emit({ type: "error", message: message.message })
  }
  private send(payload: object): void {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ v: 1, ...payload }))
  }
  private emit(event: WatchPartyEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

export function mediaFromProgressMetadata(
  metadata: ProgressMetadata,
  videoId: string,
): WatchPartyMedia {
  return {
    type: metadata.mediaType === "series" ? "series" : "movie",
    mediaId: metadata.mediaId,
    videoId,
    title: metadata.name,
    poster: metadata.poster,
    videoTitle: metadata.videoTitle,
    season: metadata.season,
    episode: metadata.episode,
  }
}
export function partyPositionAt(state: WatchPartyState, now = Date.now()): number {
  return Math.min(
    state.duration || Infinity,
    state.position +
      (state.playing ? (Math.max(0, now - state.serverTime) / 1000) * state.rate : 0),
  )
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}
function isMedia(value: unknown): value is WatchPartyMedia {
  return (
    isRecord(value) &&
    (value.type === "movie" || value.type === "series") &&
    typeof value.mediaId === "string" &&
    typeof value.videoId === "string" &&
    typeof value.title === "string"
  )
}
function isState(value: unknown): value is WatchPartyState {
  return (
    isRecord(value) &&
    finite(value.position) &&
    finite(value.duration) &&
    finite(value.rate) &&
    value.rate > 0 &&
    value.rate <= 4 &&
    Number.isSafeInteger(value.sequence) &&
    finite(value.serverTime) &&
    typeof value.playing === "boolean" &&
    typeof value.epoch === "string" &&
    Number.isSafeInteger(value.generation)
  )
}
function isMember(value: unknown): value is WatchPartyMember {
  return (
    isRecord(value) &&
    typeof value.profileId === "string" &&
    (value.role === "host" || value.role === "guest")
  )
}

/** Validate the party summary received by the separate Electron player renderer. */
export function isWatchPartySummary(value: unknown): value is WatchPartySummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.mode === "private" || value.mode === "shared") &&
    (value.status === "active" || value.status === "ended") &&
    typeof value.isHost === "boolean" &&
    typeof value.hostProfileId === "string" &&
    finite(value.memberCount) &&
    Array.isArray(value.members) &&
    value.members.every(isMember) &&
    typeof value.createdAt === "string" &&
    typeof value.expiresAt === "string" &&
    (value.media === undefined || isMedia(value.media))
  )
}
