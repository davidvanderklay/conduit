import { API_URL, DESKTOP_SESSION_TOKEN } from "./auth"
import type { PlaybackSource } from "./stream-selection"

export type { PlaybackSource } from "./stream-selection"

export interface Profile {
  id: string
  name: string
  isKids: boolean
  usesPrimaryAddons?: boolean
  avatarColor?: string | null
  avatarUrl?: string | null
}

export interface Household {
  id: string
  name: string
  role: string
  profiles: Profile[]
}

export interface Bootstrap {
  households: Household[]
}

export interface AddonManifest {
  id: string
  version: string
  name: string
  description?: string
  logo?: string
  resources: Array<
    | string
    | {
        name: string
        types?: string[]
        idPrefixes?: string[]
      }
  >
  types: string[]
  catalogs: Array<{
    id: string
    type: string
    name?: string
    extra?: Array<{
      name: string
      isRequired?: boolean
      options?: string[]
      optionsLimit?: number
    }>
  }>
}

export interface InstalledAddon {
  id: string
  manifestId: string
  manifestUrl: string
  manifest: AddonManifest
  position: number
  enabled: boolean
}

export interface LibraryItem {
  id: string
  type: "movie" | "series"
  name: string
  poster?: string
  background?: string
  description?: string
  releaseInfo?: string
  runtime?: string
  createdAt: string
  updatedAt: string
}

export interface WatchProgress {
  videoId: string
  mediaType: string
  mediaId: string
  name: string
  poster?: string
  videoTitle?: string
  season?: number
  episode?: number
  positionMs: number
  durationMs: number
  watched: boolean
  dismissed?: boolean
  continueWatching?: boolean
  playbackSource?: PlaybackSource
  updatedAt: string
}

export interface ProgressMetadata {
  mediaType: string
  mediaId: string
  name: string
  poster?: string
  videoTitle?: string
  season?: number
  episode?: number
}

export interface PlayerArtwork {
  background?: string
  logo?: string
  poster?: string
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = requestHeaders(init)
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with ${response.status}`)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

export function requestHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers)
  if (DESKTOP_SESSION_TOKEN && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${DESKTOP_SESSION_TOKEN}`)
  }
  if (init.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }
  return headers
}
