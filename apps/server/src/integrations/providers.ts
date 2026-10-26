import type { IntegrationProviderId } from "../db/schema.js"

/** A movie or a single episode, identified the way Cinemeta identifies it. */
export type MediaRef =
  | { type: "movie"; imdb: string }
  | { type: "episode"; imdb: string; season: number; episode: number }

/** A whole title, as stored in a watchlist or the conduit library. */
export interface TitleRef {
  type: "movie" | "series"
  imdb: string
}

export interface Credentials {
  /** OAuth access token, or the MDBList API key. */
  token: string
  refreshToken?: string
  /** Epoch milliseconds. */
  expiresAt?: number
}

export interface RemoteWatched {
  ref: MediaRef
  name: string
  watchedAt: Date
}

export interface RemoteListed {
  ref: TitleRef
  name: string
}

export interface RemotePlayback {
  ref: MediaRef
  name: string
  episodeTitle?: string
  /** 0-100. */
  progress: number
  pausedAt: Date
  runtimeMinutes?: number
}

export interface RemoteLibrary {
  watched: RemoteWatched[]
  watchlist: RemoteListed[]
  playback: RemotePlayback[]
}

export type ScrobbleAction = "start" | "pause" | "stop"

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUrl: string
  interval: number
  expiresIn: number
}

export type DevicePoll =
  | { status: "pending" | "slow_down" | "expired" | "denied" }
  | { status: "authorized"; credentials: Credentials }

/** What the sync service needs from a tracking service. */
export interface Provider {
  id: IntegrationProviderId
  name: string
  /** Present for OAuth providers. */
  device?: {
    start(): Promise<DeviceCode>
    poll(deviceCode: string): Promise<DevicePoll>
    refresh(credentials: Credentials): Promise<Credentials>
  }
  accountName(credentials: Credentials): Promise<string>
  scrobble(
    credentials: Credentials,
    action: ScrobbleAction,
    ref: MediaRef,
    progress: number,
  ): Promise<void>
  setWatched(credentials: Credentials, refs: MediaRef[], watched: boolean): Promise<void>
  setListed(credentials: Credentials, ref: TitleRef, listed: boolean): Promise<void>
  /** A marker that changes whenever the remote library changes. */
  activity(credentials: Credentials): Promise<string>
  /** `since` is the previous activity marker, or null for a full pull. */
  pull(credentials: Credentials, since: string | null): Promise<RemoteLibrary>
}

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export type Fetch = typeof fetch

const USER_AGENT = `conduit/${process.env.CONDUIT_RELEASE_VERSION ?? "development"}`

async function request(fetchImpl: Fetch, url: string, init: RequestInit = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { "user-agent": USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new ProviderError(response.status, `${new URL(url).host} returned ${response.status}`)
  }
  const text = await response.text()
  return { body: text ? JSON.parse(text) : undefined, headers: response.headers }
}

export async function requestJson<T>(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  return (await request(fetchImpl, url, init)).body as T
}

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

/** Trakt-style `{ movies, shows: [{ seasons: [{ episodes }] }] }` body shared by all three services. */
export function historyBody(refs: MediaRef[]) {
  const movies = refs
    .filter((ref) => ref.type === "movie")
    .map((ref) => ({ ids: { imdb: ref.imdb } }))
  const shows = new Map<string, Map<number, number[]>>()
  for (const ref of refs) {
    if (ref.type !== "episode") continue
    const seasons = shows.get(ref.imdb) ?? new Map<number, number[]>()
    seasons.set(ref.season, [...(seasons.get(ref.season) ?? []), ref.episode])
    shows.set(ref.imdb, seasons)
  }
  return {
    movies,
    shows: [...shows].map(([imdb, seasons]) => ({
      ids: { imdb },
      seasons: [...seasons].map(([number, episodes]) => ({
        number,
        episodes: episodes.map((episode) => ({ number: episode })),
      })),
    })),
  }
}

function scrobbleBody(ref: MediaRef, progress: number) {
  return ref.type === "movie"
    ? { movie: { ids: { imdb: ref.imdb } }, progress }
    : {
        show: { ids: { imdb: ref.imdb } },
        episode: { season: ref.season, number: ref.episode },
        progress,
      }
}

function listBody(ref: TitleRef, item: Record<string, unknown>) {
  return ref.type === "movie" ? { movies: [item] } : { shows: [item] }
}

function isImdbId(value: unknown): value is string {
  return typeof value === "string" && /^tt\d+$/.test(value)
}

function date(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

interface Ids {
  imdb?: string
  imdbid?: string
}

interface RemoteTitle {
  title?: string
  ids?: Ids
}

interface RemoteEpisode {
  season?: number
  number?: number
  /** Simkl names the episode number `episode` in playback rows. */
  episode?: number
  title?: string
  runtime?: number
}

interface PlaybackRow {
  progress?: number
  paused_at?: string
  type?: string
  movie?: RemoteTitle & { runtime?: number }
  show?: RemoteTitle
  episode?: RemoteEpisode
}

function imdbOf(title: RemoteTitle | undefined): string | undefined {
  const value = title?.ids?.imdb ?? title?.ids?.imdbid
  return isImdbId(value) ? value : undefined
}

/** Trakt, Simkl, and MDBList all return playback rows in nearly the same shape. */
export function parsePlayback(rows: PlaybackRow[] | undefined): RemotePlayback[] {
  return (rows ?? []).flatMap((row): RemotePlayback[] => {
    const pausedAt = date(row.paused_at)
    const progress = row.progress
    if (!pausedAt || typeof progress !== "number") return []
    if (row.type === "movie") {
      const imdb = imdbOf(row.movie)
      if (!imdb) return []
      return [
        {
          ref: { type: "movie", imdb },
          name: row.movie?.title ?? imdb,
          progress,
          pausedAt,
          runtimeMinutes: row.movie?.runtime,
        },
      ]
    }
    const imdb = imdbOf(row.show)
    const season = row.episode?.season
    const episode = row.episode?.number ?? row.episode?.episode
    if (!imdb || season === undefined || episode === undefined) return []
    return [
      {
        ref: { type: "episode", imdb, season, episode },
        name: row.show?.title ?? imdb,
        episodeTitle: row.episode?.title,
        progress,
        pausedAt,
        runtimeMinutes: row.episode?.runtime,
      },
    ]
  })
}

interface WatchedShow {
  show?: RemoteTitle
  seasons?: Array<{
    number?: number
    episodes?: Array<{ number?: number; last_watched_at?: string; watched_at?: string }>
  }>
}

function parseWatchedShows(rows: WatchedShow[] | undefined): RemoteWatched[] {
  return (rows ?? []).flatMap((row) => {
    const imdb = imdbOf(row.show)
    if (!imdb) return []
    return (row.seasons ?? []).flatMap((season) =>
      (season.episodes ?? []).flatMap((episode): RemoteWatched[] => {
        const watchedAt = date(episode.last_watched_at ?? episode.watched_at)
        if (season.number === undefined || episode.number === undefined || !watchedAt) return []
        return [
          {
            ref: { type: "episode", imdb, season: season.number, episode: episode.number },
            name: row.show?.title ?? imdb,
            watchedAt,
          },
        ]
      }),
    )
  })
}

export function createTrakt(
  config: { clientId: string; clientSecret: string },
  fetchImpl: Fetch = fetch,
): Provider {
  const base = "https://api.trakt.tv"
  const call = <T>(credentials: Credentials, path: string, init: RequestInit = {}) =>
    requestJson<T>(fetchImpl, `${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": config.clientId,
        authorization: `Bearer ${credentials.token}`,
      },
    })
  const tokens = (body: { access_token: string; refresh_token: string; expires_in: number }) => ({
    token: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  })
  // Trakt caps every list endpoint, so follow X-Pagination-Page-Count to the end.
  const pages = async <T>(credentials: Credentials, path: string, limit: number) => {
    const rows: T[] = []
    for (let page = 1; ; page++) {
      const separator = path.includes("?") ? "&" : "?"
      const result = await request(
        fetchImpl,
        `${base}${path}${separator}page=${page}&limit=${limit}`,
        {
          headers: {
            "content-type": "application/json",
            "trakt-api-version": "2",
            "trakt-api-key": config.clientId,
            authorization: `Bearer ${credentials.token}`,
          },
        },
      )
      rows.push(...((result.body as T[] | undefined) ?? []))
      if (page >= Number(result.headers.get("x-pagination-page-count") ?? page)) return rows
    }
  }

  return {
    id: "trakt",
    name: "Trakt",
    device: {
      async start() {
        const body = await requestJson<{
          device_code: string
          user_code: string
          verification_url: string
          interval: number
          expires_in: number
        }>(fetchImpl, `${base}/oauth/device/code`, postJson({ client_id: config.clientId }))
        return {
          deviceCode: body.device_code,
          userCode: body.user_code,
          verificationUrl: body.verification_url,
          interval: body.interval,
          expiresIn: body.expires_in,
        }
      },
      async poll(deviceCode) {
        try {
          const body = await requestJson<{
            access_token: string
            refresh_token: string
            expires_in: number
          }>(
            fetchImpl,
            `${base}/oauth/device/token`,
            postJson({
              code: deviceCode,
              client_id: config.clientId,
              client_secret: config.clientSecret,
            }),
          )
          return { status: "authorized", credentials: tokens(body) }
        } catch (error) {
          if (!(error instanceof ProviderError)) throw error
          if (error.status === 400) return { status: "pending" }
          if (error.status === 429) return { status: "slow_down" }
          if (error.status === 418) return { status: "denied" }
          if ([404, 409, 410].includes(error.status)) return { status: "expired" }
          throw error
        }
      },
      async refresh(credentials) {
        const body = await requestJson<{
          access_token: string
          refresh_token: string
          expires_in: number
        }>(
          fetchImpl,
          `${base}/oauth/token`,
          postJson({
            refresh_token: credentials.refreshToken,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
            grant_type: "refresh_token",
          }),
        )
        return tokens(body)
      },
    },
    async accountName(credentials) {
      const body = await call<{ user?: { username?: string } }>(credentials, "/users/settings")
      return body.user?.username ?? "Trakt"
    },
    async scrobble(credentials, action, ref, progress) {
      await call(credentials, `/scrobble/${action}`, postJson(scrobbleBody(ref, progress)))
    },
    async setWatched(credentials, refs, watched) {
      await call(
        credentials,
        watched ? "/sync/history" : "/sync/history/remove",
        postJson(historyBody(refs)),
      )
    },
    async setListed(credentials, ref, listed) {
      await call(
        credentials,
        listed ? "/sync/watchlist" : "/sync/watchlist/remove",
        postJson(listBody(ref, { ids: { imdb: ref.imdb } })),
      )
    },
    async activity(credentials) {
      const body = await call<{ all?: string }>(credentials, "/sync/last_activities")
      return body.all ?? ""
    },
    async pull(credentials) {
      const [movies, shows, watchlist, playback] = await Promise.all([
        pages<{ last_watched_at?: string; movie?: RemoteTitle }>(
          credentials,
          "/sync/watched/movies",
          250,
        ),
        // Season and episode history is only included with extended=progress.
        pages<WatchedShow>(credentials, "/sync/watched/shows?extended=progress", 100),
        pages<{ type?: string; movie?: RemoteTitle; show?: RemoteTitle }>(
          credentials,
          "/sync/watchlist",
          250,
        ),
        pages<PlaybackRow>(credentials, "/sync/playback?extended=full", 250),
      ])
      return {
        watched: [
          ...movies.flatMap((row): RemoteWatched[] => {
            const imdb = imdbOf(row.movie)
            const watchedAt = date(row.last_watched_at)
            return imdb && watchedAt
              ? [{ ref: { type: "movie", imdb }, name: row.movie?.title ?? imdb, watchedAt }]
              : []
          }),
          ...parseWatchedShows(shows),
        ],
        watchlist: watchlist.flatMap((row): RemoteListed[] => {
          const title =
            row.type === "movie" ? row.movie : row.type === "show" ? row.show : undefined
          const imdb = imdbOf(title)
          if (!imdb) return []
          return [
            {
              ref: { type: row.type === "movie" ? "movie" : "series", imdb },
              name: title?.title ?? imdb,
            },
          ]
        }),
        playback: parsePlayback(playback),
      }
    },
  }
}

export function createSimkl(config: { clientId: string }, fetchImpl: Fetch = fetch): Provider {
  const base = "https://api.simkl.com"
  const url = (path: string, query: Record<string, string> = {}) => {
    const target = new URL(path, base)
    for (const [key, value] of Object.entries({
      ...query,
      client_id: config.clientId,
      "app-name": "conduit",
      "app-version": process.env.CONDUIT_RELEASE_VERSION ?? "development",
    }))
      target.searchParams.set(key, value)
    return target.toString()
  }
  const call = <T>(
    credentials: Credentials,
    path: string,
    init: RequestInit = {},
    query?: Record<string, string>,
  ) =>
    requestJson<T>(fetchImpl, url(path, query), {
      ...init,
      headers: {
        "content-type": "application/json",
        "simkl-api-key": config.clientId,
        authorization: `Bearer ${credentials.token}`,
      },
    })
  const form = (body: Record<string, string>): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  })
  const tokens = (body: { access_token: string; refresh_token: string; expires_in: number }) => ({
    token: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  })

  return {
    id: "simkl",
    name: "Simkl",
    device: {
      async start() {
        const body = await requestJson<{
          device_code: string
          user_code: string
          verification_uri: string
          verification_uri_complete?: string
          interval: number
          expires_in: number
        }>(
          fetchImpl,
          `${base}/oauth2/device`,
          form({ client_id: config.clientId, scope: "media:read media:write" }),
        )
        return {
          deviceCode: body.device_code,
          userCode: body.user_code,
          verificationUrl: body.verification_uri_complete ?? body.verification_uri,
          interval: body.interval,
          expiresIn: body.expires_in,
        }
      },
      async poll(deviceCode) {
        const response = await fetchImpl(
          `${base}/oauth2/token`,
          form({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            client_id: config.clientId,
            device_code: deviceCode,
          }),
        )
        const body = (await response.json().catch(() => ({}))) as {
          access_token?: string
          refresh_token?: string
          expires_in?: number
          error?: string
        }
        if (response.ok && body.access_token && body.refresh_token && body.expires_in) {
          return {
            status: "authorized",
            credentials: tokens({
              access_token: body.access_token,
              refresh_token: body.refresh_token,
              expires_in: body.expires_in,
            }),
          }
        }
        if (body.error === "authorization_pending") return { status: "pending" }
        if (body.error === "slow_down") return { status: "slow_down" }
        if (body.error === "expired_token") return { status: "expired" }
        throw new ProviderError(response.status, `api.simkl.com returned ${response.status}`)
      },
      async refresh(credentials) {
        const body = await requestJson<{
          access_token: string
          refresh_token: string
          expires_in: number
        }>(
          fetchImpl,
          `${base}/oauth2/token`,
          form({
            grant_type: "refresh_token",
            client_id: config.clientId,
            refresh_token: credentials.refreshToken ?? "",
          }),
        )
        return tokens(body)
      },
    },
    async accountName(credentials) {
      const body = await call<{ user?: { name?: string } }>(credentials, "/users/settings")
      return body.user?.name ?? "Simkl"
    },
    async scrobble(credentials, action, ref, progress) {
      await call(credentials, `/scrobble/${action}`, postJson(scrobbleBody(ref, progress)))
    },
    async setWatched(credentials, refs, watched) {
      await call(
        credentials,
        watched ? "/sync/history" : "/sync/history/remove",
        postJson(historyBody(refs)),
      )
    },
    async setListed(credentials, ref, listed) {
      // Simkl removes list entries through /sync/history/remove, which also
      // erases watch history. Never risk that for a library removal.
      if (!listed) return
      await call(
        credentials,
        "/sync/add-to-list",
        postJson(listBody(ref, { to: "plantowatch", ids: { imdb: ref.imdb } })),
      )
    },
    async activity(credentials) {
      const body = await call<{ all?: string }>(credentials, "/sync/activities")
      return body.all ?? ""
    },
    async pull(credentials, since) {
      // Simkl suspends clients that download the whole library on a timer, so
      // later pulls only ask for items changed since the previous marker.
      const [items, playback] = await Promise.all([
        call<{
          movies?: Array<{ status?: string; last_watched_at?: string; movie?: RemoteTitle }>
          shows?: Array<WatchedShow & { status?: string }>
        }>(
          credentials,
          "/sync/all-items",
          {},
          {
            extended: "full",
            episode_watched_at: "yes",
            include_all_episodes: "original",
            ...(since ? { date_from: since } : {}),
          },
        ),
        call<PlaybackRow[]>(credentials, "/sync/playback"),
      ])
      const movies = items?.movies ?? []
      const shows = items?.shows ?? []
      return {
        watched: [
          ...movies.flatMap((row): RemoteWatched[] => {
            const imdb = imdbOf(row.movie)
            const watchedAt = date(row.last_watched_at)
            return row.status === "completed" && imdb && watchedAt
              ? [{ ref: { type: "movie", imdb }, name: row.movie?.title ?? imdb, watchedAt }]
              : []
          }),
          ...parseWatchedShows(shows),
        ],
        watchlist: [
          ...movies.map((row) => ({ row, title: row.movie, type: "movie" as const })),
          ...shows.map((row) => ({ row, title: row.show, type: "series" as const })),
        ].flatMap(({ row, title, type }): RemoteListed[] => {
          const imdb = imdbOf(title)
          return row.status === "plantowatch" && imdb
            ? [{ ref: { type, imdb }, name: title?.title ?? imdb }]
            : []
        }),
        playback: parsePlayback(playback),
      }
    },
  }
}

export function createMdblist(fetchImpl: Fetch = fetch): Provider {
  const base = "https://api.mdblist.com"
  const call = <T>(
    credentials: Credentials,
    path: string,
    init: RequestInit = {},
    query: Record<string, string> = {},
  ) => {
    const target = new URL(path, base)
    for (const [key, value] of Object.entries({ ...query, apikey: credentials.token }))
      target.searchParams.set(key, value)
    return requestJson<T>(fetchImpl, target.toString(), init)
  }
  const pages = async <T extends { pagination?: { next_cursor?: string | null } }>(
    credentials: Credentials,
    path: string,
  ) => {
    const results: T[] = []
    let cursor: string | null | undefined
    do {
      const page = await call<T>(
        credentials,
        path,
        {},
        { limit: "1000", ...(cursor ? { cursor } : {}) },
      )
      results.push(page)
      cursor = page.pagination?.next_cursor
    } while (cursor)
    return results
  }

  return {
    id: "mdblist",
    name: "MDBList",
    async accountName(credentials) {
      const body = await call<{ username?: string }>(credentials, "/user")
      return body.username ?? "MDBList"
    },
    async scrobble(credentials, action, ref, progress) {
      // MDBList nests the episode inside the show, unlike Trakt and Simkl.
      const body =
        ref.type === "movie"
          ? { movie: { ids: { imdb: ref.imdb } }, progress }
          : {
              show: {
                ids: { imdb: ref.imdb },
                season: { number: ref.season, episode: { number: ref.episode } },
              },
              progress,
            }
      await call(credentials, `/scrobble/${action}`, postJson(body))
    },
    async setWatched(credentials, refs, watched) {
      await call(
        credentials,
        watched ? "/sync/watched" : "/sync/watched/remove",
        postJson(historyBody(refs)),
      )
    },
    async setListed(credentials, ref, listed) {
      await call(
        credentials,
        `/watchlist/items/${listed ? "add" : "remove"}`,
        postJson(listBody(ref, { imdb: ref.imdb })),
      )
    },
    async activity(credentials) {
      return JSON.stringify(
        await call<Record<string, unknown>>(credentials, "/sync/last_activities"),
      )
    },
    async pull(credentials) {
      const [watchedPages, watchlistPages, playback] = await Promise.all([
        pages<{
          movies?: Array<{ watched_at?: string; last_watched_at?: string; movie?: RemoteTitle }>
          episodes?: Array<{
            last_watched_at?: string
            episode?: { season?: number; number?: number; show?: RemoteTitle }
          }>
          pagination?: { next_cursor?: string | null }
        }>(credentials, "/sync/watched"),
        pages<{
          movies?: Array<{ title?: string; imdb_id?: string }>
          shows?: Array<{ title?: string; imdb_id?: string }>
          pagination?: { next_cursor?: string | null }
        }>(credentials, "/watchlist/items"),
        call<PlaybackRow[]>(credentials, "/sync/playback"),
      ])
      return {
        watched: watchedPages.flatMap((page) => [
          ...(page.movies ?? []).flatMap((row): RemoteWatched[] => {
            const imdb = imdbOf(row.movie)
            const watchedAt = date(row.watched_at ?? row.last_watched_at)
            return imdb && watchedAt
              ? [{ ref: { type: "movie", imdb }, name: row.movie?.title ?? imdb, watchedAt }]
              : []
          }),
          ...(page.episodes ?? []).flatMap((row): RemoteWatched[] => {
            const imdb = imdbOf(row.episode?.show)
            const watchedAt = date(row.last_watched_at)
            const season = row.episode?.season
            const episode = row.episode?.number
            if (!imdb || !watchedAt || season === undefined || episode === undefined) return []
            return [
              {
                ref: { type: "episode", imdb, season, episode },
                name: row.episode?.show?.title ?? imdb,
                watchedAt,
              },
            ]
          }),
        ]),
        watchlist: watchlistPages.flatMap((page) =>
          [
            ...(page.movies ?? []).map((row) => ({ row, type: "movie" as const })),
            ...(page.shows ?? []).map((row) => ({ row, type: "series" as const })),
          ].flatMap(({ row, type }): RemoteListed[] =>
            isImdbId(row.imdb_id)
              ? [{ ref: { type, imdb: row.imdb_id }, name: row.title ?? row.imdb_id }]
              : [],
          ),
        ),
        playback: parsePlayback(playback),
      }
    },
  }
}
