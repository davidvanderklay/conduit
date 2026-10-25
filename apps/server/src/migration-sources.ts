import { inflateSync } from "node:zlib"
import {
  MAX_ITEMS_PER_SECTION,
  PORTABLE_DATA_FORMAT,
  PORTABLE_DATA_VERSION,
  validatePortableData,
  type PortableProfileData,
} from "./portable-data.js"

// Reads a Stremio account or a Nuvio profile and converts it into a
// conduit-profile document. Nothing here writes to either service. Clients pass
// the result to the regular import endpoint with mode "additive".

export const STREMIO_API_URL = "https://api.strem.io/api"
export const CINEMETA_URL = "https://v3-cinemeta.strem.io"
export const NUVIO_DEFAULT_BACKEND_URL = "https://api.nuvio.tv"

const REQUEST_TIMEOUT_MS = 15_000
const MANIFEST_TIMEOUT_MS = 8_000
const MAX_MANIFEST_BYTES = 256 * 1024
const NUVIO_PAGE_SIZE = 500
const FETCH_CONCURRENCY = 8

export type MigrationSession =
  | { source: "stremio"; authKey: string }
  | { source: "nuvio"; backendUrl: string; publishableKey: string; accessToken: string }

export type MigrationCredentials =
  | { source: "stremio"; authKey: string }
  | { source: "stremio"; email: string; password: string }
  | { source: "nuvio"; email: string; password: string; backendUrl?: string }

export interface MigrationAccount {
  session: MigrationSession
  email?: string
  profiles: Array<{ id: string; name: string }>
}

export interface MigrationSnapshot {
  data: PortableProfileData
  counts: { library: number; continueWatching: number; watched: number; addons: number }
  warnings: string[]
}

/** User-facing failure. `status` is 400 for bad input and 502 for upstream errors. */
export class MigrationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 502 = 502,
  ) {
    super(message)
  }
}

type Fetch = typeof fetch
type Library = PortableProfileData["library"][number]
type Progress = PortableProfileData["progress"][number]
type Addon = PortableProfileData["addons"][number]

/** Verifies credentials and lists the profiles that can be read. */
export async function connectMigrationSource(
  credentials: MigrationCredentials,
  fetchImpl: Fetch = fetch,
): Promise<MigrationAccount> {
  if (credentials.source === "stremio") {
    if ("authKey" in credentials) {
      const user = await stremioCall<{ email?: string }>(fetchImpl, "getUser", {
        type: "GetUser",
        authKey: credentials.authKey,
      })
      return {
        session: { source: "stremio", authKey: credentials.authKey },
        email: user.email,
        profiles: [{ id: "default", name: "Stremio" }],
      }
    }
    const login = await stremioCall<{ authKey?: string; user?: { email?: string } }>(
      fetchImpl,
      "login",
      { type: "Login", email: credentials.email, password: credentials.password, facebook: false },
    )
    if (!login.authKey) throw new MigrationError("Stremio did not return a session")
    return {
      session: { source: "stremio", authKey: login.authKey },
      email: login.user?.email ?? credentials.email,
      profiles: [{ id: "default", name: "Stremio" }],
    }
  }

  const backend = await discoverNuvio(
    fetchImpl,
    credentials.backendUrl ?? NUVIO_DEFAULT_BACKEND_URL,
  )
  const response = await request(
    fetchImpl,
    `${backend.backendUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: backend.publishableKey, "content-type": "application/json" },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
    },
  )
  const body = await readJson(response)
  if (!response.ok || !isRecord(body) || typeof body.access_token !== "string") {
    const message =
      isRecord(body) && typeof body.msg === "string" ? body.msg : "Nuvio sign-in failed"
    throw new MigrationError(message, response.status >= 500 ? 502 : 400)
  }
  const session: MigrationSession = {
    source: "nuvio",
    ...backend,
    accessToken: body.access_token,
  }
  const profiles = await nuvioRpc(fetchImpl, session, "sync_pull_profiles", {})
  return {
    session,
    email:
      isRecord(body.user) && typeof body.user.email === "string"
        ? body.user.email
        : credentials.email,
    profiles: profiles
      .filter(isRecord)
      .flatMap((profile) =>
        typeof profile.profile_index === "number"
          ? [
              {
                id: String(profile.profile_index),
                name: text(profile.name) ?? `Profile ${profile.profile_index}`,
              },
            ]
          : [],
      )
      .sort((a, b) => Number(a.id) - Number(b.id)),
  }
}

/** Reads one source profile into a validated conduit-profile document. */
export async function readMigrationSource(
  session: MigrationSession,
  profileId: string,
  fetchImpl: Fetch = fetch,
  now = new Date(),
): Promise<MigrationSnapshot> {
  const builder = new SnapshotBuilder()
  if (session.source === "stremio") await readStremio(fetchImpl, session, builder)
  else await readNuvio(fetchImpl, session, profileId, builder)
  return builder.finish(session.source === "stremio" ? "Stremio" : "Nuvio", now)
}

// Stremio

interface StremioLibraryItem {
  _id: string
  name: string
  type: string
  poster?: string
  background?: string
  removed?: boolean
  temp?: boolean
  _ctime?: unknown
  _mtime?: unknown
  state?: {
    lastWatched?: unknown
    timeOffset?: number
    duration?: number
    video_id?: string | null
    timesWatched?: number
    flaggedWatched?: number
    watched?: string | null
  }
}

async function readStremio(
  fetchImpl: Fetch,
  session: Extract<MigrationSession, { source: "stremio" }>,
  builder: SnapshotBuilder,
) {
  const [items, collection] = await Promise.all([
    stremioCall<unknown[]>(fetchImpl, "datastoreGet", {
      authKey: session.authKey,
      collection: "libraryItem",
      ids: [],
      all: true,
    }),
    stremioCall<{ addons?: unknown[] }>(fetchImpl, "addonCollectionGet", {
      type: "AddonCollectionGet",
      authKey: session.authKey,
      update: true,
    }),
  ])

  const seriesWithHistory: StremioLibraryItem[] = []
  for (const raw of Array.isArray(items) ? items : []) {
    const item = parseStremioItem(raw)
    if (!item || (item.temp && !item.state?.timeOffset)) continue
    if (item.type !== "movie" && item.type !== "series") {
      builder.skippedTypes += 1
      continue
    }
    const createdAt = isoTime(item._ctime) ?? isoTime(item._mtime) ?? new Date(0).toISOString()
    const updatedAt = isoTime(item._mtime) ?? createdAt
    const watchedAt = isoTime(item.state?.lastWatched) ?? updatedAt
    if (!item.removed && !item.temp) {
      builder.addLibrary({
        mediaType: item.type,
        mediaId: item._id,
        name: item.name,
        poster: item.poster,
        background: item.background,
        createdAt,
        updatedAt,
      })
    }

    const state = item.state ?? {}
    if ((state.timeOffset ?? 0) > 0 && (!item.removed || item.temp)) {
      const videoId = state.video_id || item._id
      builder.addProgress({
        videoId,
        mediaType: item.type,
        mediaId: item._id,
        name: item.name,
        poster: item.poster,
        ...episodeNumbers(videoId),
        positionMs: Math.round(state.timeOffset ?? 0),
        durationMs: Math.round(state.duration ?? 0),
        watched: false,
        continueWatching: true,
        updatedAt: watchedAt,
      })
    }
    if (
      item.type === "movie" &&
      ((state.flaggedWatched ?? 0) > 0 || (state.timesWatched ?? 0) > 0)
    ) {
      builder.addProgress({
        videoId: item._id,
        mediaType: "movie",
        mediaId: item._id,
        name: item.name,
        poster: item.poster,
        positionMs: 0,
        durationMs: Math.round(state.duration ?? 0),
        watched: true,
        continueWatching: false,
        updatedAt: watchedAt,
      })
    }
    if (item.type === "series" && state.watched) seriesWithHistory.push(item)
  }

  // Stremio stores watched episodes as a bitfield over the series' sorted
  // episode list, so decoding needs each title's metadata.
  let unresolved = 0
  await mapConcurrent(seriesWithHistory, FETCH_CONCURRENCY, async (item) => {
    const videoIds = item._id.startsWith("tt")
      ? await cinemetaVideoIds(fetchImpl, item._id)
      : undefined
    const watched = videoIds && decodeStremioWatched(item.state?.watched ?? "", videoIds)
    if (!watched) {
      unresolved += 1
      return
    }
    const updatedAt =
      isoTime(item.state?.lastWatched) ?? isoTime(item._mtime) ?? new Date(0).toISOString()
    for (const videoId of watched) {
      builder.addProgress({
        videoId,
        mediaType: "series",
        mediaId: item._id,
        name: item.name,
        poster: item.poster,
        ...episodeNumbers(videoId),
        positionMs: 0,
        durationMs: 0,
        watched: true,
        continueWatching: false,
        updatedAt,
      })
    }
  })
  if (unresolved)
    builder.warnings.push(`Episode history for ${unresolved} series could not be read`)

  for (const [position, raw] of (collection.addons ?? []).entries()) {
    if (!isRecord(raw) || !isRecord(raw.manifest) || typeof raw.transportUrl !== "string") continue
    if (isRecord(raw.flags) && raw.flags.protected === true) continue
    builder.addAddon(raw.transportUrl, withoutNulls(raw.manifest), position, true)
  }
}

function parseStremioItem(raw: unknown): StremioLibraryItem | undefined {
  if (!isRecord(raw) || typeof raw._id !== "string" || typeof raw.type !== "string") return
  return {
    ...(raw as unknown as StremioLibraryItem),
    name: text(raw.name) ?? raw._id,
    poster: text(raw.poster),
    background: text(raw.background),
    state: isRecord(raw.state) ? (raw.state as StremioLibraryItem["state"]) : undefined,
  }
}

async function stremioCall<T>(
  fetchImpl: Fetch,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await request(fetchImpl, `${STREMIO_API_URL}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await readJson(response)
  if (isRecord(json) && isRecord(json.error)) {
    const message =
      typeof json.error.message === "string" ? json.error.message : "Stremio request failed"
    throw new MigrationError(`Stremio: ${message}`, 400)
  }
  if (!response.ok || !isRecord(json) || !("result" in json)) {
    throw new MigrationError("Stremio request failed")
  }
  return json.result as T
}

async function cinemetaVideoIds(fetchImpl: Fetch, id: string): Promise<string[] | undefined> {
  try {
    const response = await request(
      fetchImpl,
      `${CINEMETA_URL}/meta/series/${encodeURIComponent(id)}.json`,
      {},
    )
    const body = await readJson(response)
    if (!response.ok || !isRecord(body) || !isRecord(body.meta) || !Array.isArray(body.meta.videos))
      return
    return sortStremioVideos(body.meta.videos)
  } catch {
    return
  }
}

/** Orders videos the way stremio-core does before building a watched bitfield. */
export function sortStremioVideos(videos: unknown[]): string[] {
  const unique = new Map<string, { season: number; episode: number; released: number }>()
  for (const video of videos) {
    if (!isRecord(video) || typeof video.id !== "string" || unique.has(video.id)) continue
    const released = typeof video.released === "string" ? Date.parse(video.released) : Number.NaN
    unique.set(video.id, {
      season: typeof video.season === "number" ? video.season : Number.NEGATIVE_INFINITY,
      episode: typeof video.episode === "number" ? video.episode : Number.NEGATIVE_INFINITY,
      released: Number.isFinite(released) ? released : Number.NEGATIVE_INFINITY,
    })
  }
  return [...unique]
    .sort(
      ([, a], [, b]) =>
        compare(a.season, b.season) ||
        compare(a.episode, b.episode) ||
        compare(a.released, b.released),
    )
    .map(([id]) => id)
}

/**
 * Decodes Stremio's `state.watched` value (`anchorVideoId:anchorLength:base64(zlib(bits))`)
 * against the current sorted episode list. Returns undefined when it cannot be decoded.
 */
export function decodeStremioWatched(serialized: string, videoIds: string[]): string[] | undefined {
  const parts = serialized.split(":")
  if (parts.length < 3) return
  const encoded = parts.pop() ?? ""
  const anchorLength = Number(parts.pop())
  const anchorVideo = parts.join(":")
  if (!Number.isSafeInteger(anchorLength)) return
  let bits: Buffer
  try {
    bits = inflateSync(Buffer.from(encoded, "base64"))
  } catch {
    return
  }
  const anchorIndex = videoIds.indexOf(anchorVideo)
  if (anchorIndex < 0) return []
  // The list may have gained episodes since Stremio saved the field; the anchor
  // re-aligns old bit positions with the current list.
  const offset = anchorLength - anchorIndex - 1
  return videoIds.filter((_, index) => {
    const previous = index + offset
    if (previous < 0) return false
    const byte = bits[Math.floor(previous / 8)]
    return byte !== undefined && ((byte >> (previous % 8)) & 1) === 1
  })
}

// Nuvio

async function readNuvio(
  fetchImpl: Fetch,
  session: Extract<MigrationSession, { source: "nuvio" }>,
  profileId: string,
  builder: SnapshotBuilder,
) {
  httpsUrl(session.backendUrl, "Nuvio server")
  const profileIndex = Number(profileId)
  if (!Number.isSafeInteger(profileIndex)) throw new MigrationError("Choose a Nuvio profile", 400)
  const profiles = await nuvioRpc(fetchImpl, session, "sync_pull_profiles", {})
  const profile = profiles.filter(isRecord).find((entry) => entry.profile_index === profileIndex)
  if (!profile) throw new MigrationError("That Nuvio profile no longer exists", 400)
  const addonProfile = profileIndex !== 1 && profile.uses_primary_addons === true ? 1 : profileIndex

  const [library, progress, watched, addons] = await Promise.all([
    nuvioPages(async (limit, page) =>
      nuvioRpc(fetchImpl, session, "sync_pull_library", {
        p_profile_id: profileIndex,
        p_limit: limit,
        p_offset: page * limit,
      }),
    ),
    nuvioRpc(fetchImpl, session, "sync_pull_watch_progress", { p_profile_id: profileIndex }),
    nuvioPages(async (limit, page) =>
      nuvioRpc(fetchImpl, session, "sync_pull_watched_items", {
        p_profile_id: profileIndex,
        p_page: page + 1,
        p_page_size: limit,
      }),
    ),
    nuvioRest(
      fetchImpl,
      session,
      `addons?select=url,name,enabled,sort_order&profile_id=eq.${addonProfile}&order=sort_order.asc`,
    ),
  ])

  const names = new Map<string, { name: string; poster?: string }>()
  for (const item of library.filter(isRecord)) {
    const id = text(item.content_id)
    const type = text(item.content_type)
    if (!id || !type) continue
    const name = text(item.name) ?? id
    const poster = text(item.poster)
    names.set(id, { name, poster })
    if (type !== "movie" && type !== "series") {
      builder.skippedTypes += 1
      continue
    }
    const addedAt = epochIso(item.added_at) ?? new Date(0).toISOString()
    builder.addLibrary({
      mediaType: type,
      mediaId: id,
      name,
      poster,
      background: text(item.background),
      description: text(item.description),
      releaseInfo: text(item.release_info),
      createdAt: addedAt,
      updatedAt: addedAt,
    })
  }
  for (const item of watched.filter(isRecord)) {
    const id = text(item.content_id)
    if (id && !names.has(id) && text(item.title)) names.set(id, { name: text(item.title) ?? id })
  }

  for (const entry of progress.filter(isRecord)) {
    const mediaId = text(entry.content_id)
    const mediaType = text(entry.content_type)
    if (!mediaId || (mediaType !== "movie" && mediaType !== "series")) continue
    if (nonNegative(entry.position) === 0) continue
    const season = optionalInteger(entry.season)
    const episode = optionalInteger(entry.episode)
    builder.addProgress({
      videoId: text(entry.video_id) ?? episodeVideoId(mediaId, season, episode),
      mediaType,
      mediaId,
      name: names.get(mediaId)?.name ?? mediaId,
      poster: names.get(mediaId)?.poster,
      ...(season !== undefined ? { season } : {}),
      ...(episode !== undefined ? { episode } : {}),
      positionMs: nonNegative(entry.position),
      durationMs: nonNegative(entry.duration),
      watched: false,
      continueWatching: true,
      updatedAt: epochIso(entry.last_watched) ?? new Date(0).toISOString(),
    })
  }
  for (const item of watched.filter(isRecord)) {
    const mediaId = text(item.content_id)
    const mediaType = text(item.content_type)
    if (!mediaId || (mediaType !== "movie" && mediaType !== "series")) continue
    const season = optionalInteger(item.season)
    const episode = optionalInteger(item.episode)
    builder.addProgress({
      videoId: episodeVideoId(mediaId, season, episode),
      mediaType,
      mediaId,
      name: names.get(mediaId)?.name ?? mediaId,
      poster: names.get(mediaId)?.poster,
      ...(season !== undefined ? { season } : {}),
      ...(episode !== undefined ? { episode } : {}),
      positionMs: 0,
      durationMs: 0,
      watched: true,
      continueWatching: false,
      updatedAt: epochIso(item.watched_at) ?? new Date(0).toISOString(),
    })
  }

  const rows = addons.filter(isRecord).flatMap((row) => {
    const url = text(row.url)
    return url ? [{ url: manifestUrl(url), enabled: row.enabled !== false }] : []
  })
  let unreachable = 0
  const manifests = await mapConcurrent(rows, FETCH_CONCURRENCY, async (row) => {
    const manifest = await fetchManifest(fetchImpl, row.url)
    if (!manifest) unreachable += 1
    return manifest
  })
  rows.forEach((row, position) => {
    const manifest = manifests[position]
    if (manifest) builder.addAddon(row.url, manifest, position, row.enabled)
  })
  if (unreachable)
    builder.warnings.push(`${unreachable} add-on(s) did not return a manifest and will be skipped`)
}

async function discoverNuvio(fetchImpl: Fetch, rawUrl: string) {
  const base = httpsUrl(rawUrl.trim().replace(/\/+$/, ""), "Nuvio server")
  const response = await request(fetchImpl, `${base}/.well-known/nuvio`, {}).catch(() => {
    throw new MigrationError("Could not reach that Nuvio server", 400)
  })
  const body = await readJson(response)
  if (
    !response.ok ||
    !isRecord(body) ||
    body.service !== "nuvio" ||
    typeof body.publishable_key !== "string"
  ) {
    throw new MigrationError("That address is not a Nuvio server", 400)
  }
  const backendUrl =
    typeof body.backend_url === "string" ? body.backend_url.replace(/\/+$/, "") : base
  return { backendUrl: httpsUrl(backendUrl, "Nuvio server"), publishableKey: body.publishable_key }
}

function nuvioHeaders(session: Extract<MigrationSession, { source: "nuvio" }>) {
  return {
    apikey: session.publishableKey,
    authorization: `Bearer ${session.accessToken}`,
    "content-type": "application/json",
  }
}

async function nuvioRpc(
  fetchImpl: Fetch,
  session: Extract<MigrationSession, { source: "nuvio" }>,
  name: string,
  params: Record<string, unknown>,
): Promise<unknown[]> {
  const response = await request(fetchImpl, `${session.backendUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: nuvioHeaders(session),
    body: JSON.stringify(params),
  })
  return nuvioRows(response)
}

async function nuvioRest(
  fetchImpl: Fetch,
  session: Extract<MigrationSession, { source: "nuvio" }>,
  path: string,
): Promise<unknown[]> {
  const response = await request(fetchImpl, `${session.backendUrl}/rest/v1/${path}`, {
    headers: nuvioHeaders(session),
  })
  return nuvioRows(response)
}

async function nuvioRows(response: Response): Promise<unknown[]> {
  const body = await readJson(response)
  if (response.status === 401)
    throw new MigrationError("Nuvio session expired. Connect again.", 400)
  if (!response.ok || !Array.isArray(body)) throw new MigrationError("Nuvio request failed")
  return body
}

async function nuvioPages(load: (limit: number, page: number) => Promise<unknown[]>) {
  const rows: unknown[] = []
  for (let page = 0; rows.length < MAX_ITEMS_PER_SECTION * 2; page += 1) {
    const next = await load(NUVIO_PAGE_SIZE, page)
    rows.push(...next)
    if (next.length < NUVIO_PAGE_SIZE) break
  }
  return rows
}

async function fetchManifest(
  fetchImpl: Fetch,
  url: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    httpsUrl(url, "manifest URL")
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    })
    const raw = await response.text()
    if (!response.ok || Buffer.byteLength(raw) > MAX_MANIFEST_BYTES) return
    const manifest: unknown = JSON.parse(raw)
    return isRecord(manifest) &&
      typeof manifest.id === "string" &&
      typeof manifest.name === "string"
      ? manifest
      : undefined
  } catch {
    return
  }
}

// Shared

/** Collects converted entries, dedupes them, and enforces conduit-profile limits. */
class SnapshotBuilder {
  readonly warnings: string[] = []
  skippedTypes = 0
  private readonly library = new Map<string, Library>()
  private readonly progress = new Map<string, Progress>()
  private readonly addons = new Map<string, Addon>()
  private skippedAddons = 0

  addLibrary(item: Library) {
    const key = `${item.mediaType}:${item.mediaId}`
    if (!this.library.has(key))
      this.library.set(key, compact({ ...item, name: clip(item.name, 500) }))
  }

  addProgress(item: Progress) {
    // Resume points are added before history, so the first entry wins.
    if (this.progress.has(item.videoId)) return
    this.progress.set(item.videoId, compact({ ...item, name: clip(item.name, 500) }))
  }

  addAddon(url: string, manifest: Record<string, unknown>, position: number, enabled: boolean) {
    const manifestId = text(manifest.id)
    if (
      !manifestId ||
      !text(manifest.name) ||
      !isHttps(url) ||
      Buffer.byteLength(JSON.stringify(manifest)) > MAX_MANIFEST_BYTES
    ) {
      this.skippedAddons += 1
      return
    }
    if (!this.addons.has(url))
      this.addons.set(url, { manifestId, manifestUrl: url, manifest, position, enabled })
  }

  finish(name: string, now: Date): MigrationSnapshot {
    const library = [...this.library.values()]
    let progress = [...this.progress.values()]
    if (this.skippedTypes)
      this.warnings.push(`${this.skippedTypes} item(s) that are not movies or series were skipped`)
    if (this.skippedAddons)
      this.warnings.push(`${this.skippedAddons} add-on(s) are local or invalid and were skipped`)
    if (library.length > MAX_ITEMS_PER_SECTION) {
      this.warnings.push(
        `Only the ${MAX_ITEMS_PER_SECTION} most recent library titles are included`,
      )
      library.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).splice(MAX_ITEMS_PER_SECTION)
    }
    if (progress.length > MAX_ITEMS_PER_SECTION) {
      this.warnings.push(
        `Only the ${MAX_ITEMS_PER_SECTION} most recent history entries are included`,
      )
      progress = progress
        .sort(
          (a, b) =>
            Number(b.continueWatching) - Number(a.continueWatching) ||
            b.updatedAt.localeCompare(a.updatedAt),
        )
        .slice(0, MAX_ITEMS_PER_SECTION)
    }
    let data: PortableProfileData
    try {
      data = validatePortableData({
        format: PORTABLE_DATA_FORMAT,
        version: PORTABLE_DATA_VERSION,
        exportedAt: now.toISOString(),
        profile: { name, isKids: false },
        library,
        progress,
        addons: [...this.addons.values()],
      })
    } catch (error) {
      throw new MigrationError(
        `This account cannot be imported: ${error instanceof Error ? error.message : "invalid data"}`,
      )
    }
    return {
      data,
      counts: {
        library: data.library.length,
        continueWatching: data.progress.filter((item) => item.continueWatching).length,
        watched: data.progress.filter((item) => !item.continueWatching).length,
        addons: data.addons.length,
      },
      warnings: this.warnings,
    }
  }
}

async function request(fetchImpl: Fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch {
    throw new MigrationError(`Could not reach ${new URL(url).host}`)
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await run(items[index] as T)
      }
    }),
  )
  return results
}

function episodeNumbers(videoId: string): { season?: number; episode?: number } {
  const match = /:(\d+):(\d+)$/.exec(videoId)
  return match ? { season: Number(match[1]), episode: Number(match[2]) } : {}
}

function episodeVideoId(mediaId: string, season?: number, episode?: number) {
  return season !== undefined && episode !== undefined ? `${mediaId}:${season}:${episode}` : mediaId
}

function manifestUrl(url: string) {
  return url.endsWith("/manifest.json") ? url : `${url.replace(/\/+$/, "")}/manifest.json`
}

function httpsUrl(value: string, label: string): string {
  if (!isHttps(value)) throw new MigrationError(`${label} must be an HTTPS URL`, 400)
  return value
}

function isHttps(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password
  } catch {
    return false
  }
}

/** Accepts ISO strings or epoch milliseconds. */
function isoTime(value: unknown): string | undefined {
  if (typeof value === "number") return epochIso(value)
  if (typeof value !== "string") return
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : undefined
}

/** Nuvio timestamps are epoch milliseconds, with some older watched rows stored as YYYYMMDDHHMMSS. */
function epochIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return
  if (value >= 1e13 && value < 1e14) {
    const raw = String(Math.trunc(value))
    const parsed = Date.parse(
      `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}Z`,
    )
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
  }
  const date = new Date(value)
  return date.getUTCFullYear() <= 2200 ? date.toISOString() : undefined
}

function optionalInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined
}

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.round(value), 2 ** 31 - 1)
    : 0
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function clip(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

/** Drops undefined and oversized optional strings so validation accepts the entry. */
function compact<T extends object>(value: T): T {
  const limits: Record<string, number> = {
    poster: 4096,
    background: 4096,
    description: 20_000,
    releaseInfo: 200,
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, entry]) =>
        entry !== undefined &&
        !(typeof entry === "string" && entry.length > (limits[key] ?? Infinity)),
    ),
  ) as T
}

function compare(a: number, b: number) {
  return a === b ? 0 : a < b ? -1 : 1
}

/**
 * Stremio's API stores manifests with explicit nulls for unset fields
 * (`idPrefixes: null`). Conduit's core expects those fields to be absent.
 */
function withoutNulls(manifest: Record<string, unknown>): Record<string, unknown> {
  const strip = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.filter((entry) => entry !== null).map(strip)
      : isRecord(value)
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, entry]) => entry !== null)
              .map(([key, entry]) => [key, strip(entry)]),
          )
        : value
  return strip(manifest) as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
