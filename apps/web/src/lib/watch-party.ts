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
}

export interface WatchPartySummary {
  id: string
  mode: "private" | "shared"
  status: "active" | "ended"
  hostProfileId: string
  media: WatchPartyMedia
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
  | { type: "command"; command: "play" | "pause" | "seek" | "rate"; value?: number; sequence: number }
  | { type: "media"; media: WatchPartyMedia }
  | { type: "presence"; participants: WatchPartyMember[] }
  | { type: "ended"; reason: string }
  | { type: "error"; message: string }
  | { type: "connected" }
  | { type: "disconnected" }

export interface WatchPartySessionOptions extends WatchPartyTicket {
  partyId: string
  role: "host" | "guest"
  refreshTicket?: () => Promise<WatchPartyTicket>
  apiUrl?: string
}

export class WatchPartySession {
  readonly partyId: string
  readonly role: "host" | "guest"
  private ticket: WatchPartyTicket
  private readonly refreshTicket?: () => Promise<WatchPartyTicket>
  private readonly apiUrl: string
  private socket?: WebSocket
  private reconnectTimer?: number
  private closed = false
  private sequence = 0
  private lastStateSequence = -1
  private readonly listeners = new Set<(event: WatchPartyEvent) => void>()

  constructor(options: WatchPartySessionOptions) {
    this.partyId = options.partyId
    this.role = options.role
    this.ticket = options
    this.refreshTicket = options.refreshTicket
    this.apiUrl = options.apiUrl ?? window.location.origin
  }

  connect(): void {
    this.closed = false
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return
    const url = new URL(this.apiUrl)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.pathname = this.ticket.socketPath
    url.search = `?ticket=${encodeURIComponent(this.ticket.ticket)}`
    const socket = new WebSocket(url)
    this.socket = socket
    socket.onopen = () => this.emit({ type: "connected" })
    socket.onclose = () => {
      this.emit({ type: "disconnected" })
      if (this.closed || !this.refreshTicket) return
      this.reconnectTimer = window.setTimeout(() => {
        void this.refreshTicket!()
          .then((ticket) => {
            this.ticket = ticket
            this.connect()
          })
          .catch(() => undefined)
      }, 1000)
    }
    socket.onerror = () => undefined
    socket.onmessage = (event) => {
      const message = parseServerMessage(event.data)
      if (!message) return
      if (message.type === "state") {
        if (message.state.sequence <= this.lastStateSequence) return
        this.lastStateSequence = message.state.sequence
      }
      this.emit(message)
    }
  }

  close(): void {
    this.closed = true
    window.clearTimeout(this.reconnectTimer)
    this.socket?.close()
    this.socket = undefined
  }

  subscribe(listener: (event: WatchPartyEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  sendReady(ready: boolean): void {
    this.send({ v: 1, type: "ready", ready })
  }

  publishMedia(media: WatchPartyMedia): void {
    if (this.role !== "host") return
    this.send({ v: 1, type: "media", media })
  }

  publishState(state: Omit<WatchPartyState, "sequence" | "serverTime">): void {
    if (this.role !== "host") return
    this.sequence += 1
    this.send({ v: 1, type: "state", ...state, sequence: this.sequence })
  }

  publishCommand(command: "play" | "pause" | "seek" | "rate", value?: number): void {
    if (this.role !== "host") return
    this.sequence += 1
    this.send({ v: 1, type: "command", command, value, sequence: this.sequence })
  }

  private send(payload: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload))
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
  if (!state.playing) return state.position
  return Math.min(
    state.duration || Number.POSITIVE_INFINITY,
    state.position + Math.max(0, now - state.serverTime) / 1000 * state.rate,
  )
}

function parseServerMessage(value: unknown): WatchPartyEvent | undefined {
  let message: Record<string, unknown>
  try {
    message = typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>
  } catch {
    return undefined
  }
  if (!message || message.v !== 1 || typeof message.type !== "string") return undefined
  if (message.type === "connected" || message.type === "disconnected") return { type: message.type }
  if (message.type === "error" && typeof message.message === "string") return { type: "error", message: message.message }
  if (message.type === "ended" && typeof message.reason === "string") return { type: "ended", reason: message.reason }
  if (message.type === "media" && isMedia(message.media)) return { type: "media", media: message.media }
  if (message.type === "presence" && Array.isArray(message.participants)) return { type: "presence", participants: message.participants.filter(isMember) }
  if (message.type === "joined") {
    if ((message.role !== "host" && message.role !== "guest") || !Array.isArray(message.participants)) return undefined
    const state = isState(message.state) ? message.state : undefined
    return {
      type: "joined",
      role: message.role,
      media: isMedia(message.media) ? message.media : undefined,
      state,
      participants: message.participants.filter(isMember),
    }
  }
  if (message.type === "state" && isState(message)) return { type: "state", state: message }
  if (
    message.type === "command" &&
    (message.command === "play" || message.command === "pause" || message.command === "seek" || message.command === "rate") &&
    Number.isInteger(message.sequence)
  ) {
    return { type: "command", command: message.command, value: typeof message.value === "number" ? message.value : undefined, sequence: message.sequence as number }
  }
  return undefined
}

function isMedia(value: unknown): value is WatchPartyMedia {
  if (!value || typeof value !== "object") return false
  const media = value as Record<string, unknown>
  return (media.type === "movie" || media.type === "series") &&
    typeof media.mediaId === "string" && typeof media.videoId === "string" && typeof media.title === "string"
}

function isState(value: unknown): value is WatchPartyState {
  if (!value || typeof value !== "object") return false
  const state = value as Record<string, unknown>
  return ["position", "duration", "rate", "sequence", "serverTime"].every((key) => typeof state[key] === "number") &&
    typeof state.playing === "boolean"
}

function isMember(value: unknown): value is WatchPartyMember {
  if (!value || typeof value !== "object") return false
  const member = value as Record<string, unknown>
  return typeof member.profileId === "string" && (member.role === "host" || member.role === "guest")
}
