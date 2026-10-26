import { and, eq, inArray, sql } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { Config } from "../config.js"
import { decryptSecret, encryptSecret } from "../crypto.js"
import type { Database } from "../db/index.js"
import {
  integrationConnections,
  libraryItems,
  progressSyncState,
  watchProgress,
  type IntegrationProviderId,
} from "../db/schema.js"
import {
  AliasConflict,
  canonicalEpisodeKey as canonicalKey,
  resolveCanonicalTitle,
} from "../route-modules/progress-sync-routes.js"
import {
  createMdblist,
  createSimkl,
  createTrakt,
  ProviderError,
  requestJson,
  type Credentials,
  type Fetch,
  type MediaRef,
  type Provider,
  type RemoteLibrary,
  type ScrobbleAction,
  type TitleRef,
} from "./providers.js"

export const INTEGRATION_PROVIDERS = [
  "trakt",
  "simkl",
  "mdblist",
] as const satisfies readonly IntegrationProviderId[]

/** A progress write as the sync service sees it. */
export interface ProgressChange {
  previous?: { watched: boolean; positionMs: number }
  current: Pick<
    typeof watchProgress.$inferSelect,
    | "mediaType"
    | "mediaId"
    | "videoId"
    | "season"
    | "episode"
    | "positionMs"
    | "durationMs"
    | "watched"
  >
}

export interface IntegrationStatus {
  id: IntegrationProviderId
  name: string
  /** Device-code OAuth, or a pasted API key. */
  auth: "device" | "apiKey"
  /** False when the server operator has not configured the provider's client id. */
  available: boolean
  connection: { accountName: string; lastSyncedAt: string | null; lastError: string | null } | null
}

export class IntegrationRequestError extends Error {}

type Connection = typeof integrationConnections.$inferSelect
type ProgressRow = typeof watchProgress.$inferSelect

interface Options {
  providers: Partial<Record<IntegrationProviderId, Provider>>
  log: Pick<FastifyBaseLogger, "warn">
  fetch?: Fetch
  /** Gap between writes to one service. Trakt allows one write per second. */
  writeSpacingMs?: number
  /** Time without checkpoints before a playing scrobble is paused. */
  idleMs?: number
  /** How long history toggles wait to be batched into one request. */
  batchMs?: number
}

const SYNC_INTERVAL_MS = 15 * 60_000
const REFRESH_MARGIN_MS = 10 * 60_000
/** Shows watched elsewhere this recently show up as Next Up. */
const NEXT_UP_WINDOW_MS = 30 * 24 * 60 * 60_000
const CHUNK = 500

export function createIntegrationSync(
  db: Database,
  config: Config,
  log: Pick<FastifyBaseLogger, "warn">,
) {
  return new IntegrationSync(db, config.addonEncryptionKey, {
    log,
    providers: {
      ...(config.traktClientId && config.traktClientSecret
        ? {
            trakt: createTrakt({
              clientId: config.traktClientId,
              clientSecret: config.traktClientSecret,
            }),
          }
        : {}),
      ...(config.simklClientId ? { simkl: createSimkl({ clientId: config.simklClientId }) } : {}),
      mdblist: createMdblist(),
    },
  })
}

/**
 * Keeps each profile's connected services in step with conduit.
 *
 * Playback and library routes report changes through the `on*` methods, which
 * push to every connected service in the background. `sync` pulls remote
 * history, watchlists, and paused playback into the profile, and `start` runs
 * that pull on a timer.
 */
export class IntegrationSync {
  private readonly providers: Partial<Record<IntegrationProviderId, Provider>>
  private readonly log: Pick<FastifyBaseLogger, "warn">
  private readonly fetchImpl: Fetch
  private readonly writeSpacingMs: number
  private readonly idleMs: number
  private readonly batchMs: number
  private readonly sessions = new Map<string, NodeJS.Timeout>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly batches = new Map<string, MediaRef[]>()
  private readonly credentialLoads = new Map<string, Promise<Credentials>>()
  private readonly pulls = new Map<string, Promise<void>>()
  private timer?: NodeJS.Timeout

  constructor(
    private readonly db: Database,
    private readonly key: Buffer,
    options: Options,
  ) {
    this.providers = options.providers
    this.log = options.log
    this.fetchImpl = options.fetch ?? fetch
    this.writeSpacingMs = options.writeSpacingMs ?? 1_100
    this.idleMs = options.idleMs ?? 60_000
    this.batchMs = options.batchMs ?? 1_000
  }

  start() {
    this.timer ??= setInterval(() => void this.syncAll(), SYNC_INTERVAL_MS)
    this.timer.unref()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
    for (const session of this.sessions.values()) clearTimeout(session)
    this.sessions.clear()
  }

  async status(profileId: string): Promise<IntegrationStatus[]> {
    const rows = await this.db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.profileId, profileId))
    return INTEGRATION_PROVIDERS.map((id) => {
      const provider = this.providers[id]
      const row = rows.find((candidate) => candidate.provider === id)
      return {
        id,
        name: PROVIDER_NAMES[id],
        auth: id === "mdblist" ? "apiKey" : "device",
        available: Boolean(provider),
        connection: row
          ? {
              accountName: row.accountName,
              lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
              lastError: row.lastError,
            }
          : null,
      }
    })
  }

  /** Starts a device-code sign-in. `handle` is opaque to the client and only valid for this profile. */
  async startDevice(profileId: string, providerId: IntegrationProviderId) {
    const device = this.provider(providerId).device
    if (!device) throw new IntegrationRequestError(`${PROVIDER_NAMES[providerId]} uses an API key`)
    const code = await device.start().catch((error: unknown) => {
      if (error instanceof ProviderError && (error.status === 401 || error.status === 403))
        throw new IntegrationRequestError(
          `${PROVIDER_NAMES[providerId]} rejected this server's client id. Check the server settings.`,
        )
      throw error
    })
    return {
      userCode: code.userCode,
      verificationUrl: code.verificationUrl,
      interval: code.interval,
      expiresIn: code.expiresIn,
      handle: encryptSecret(
        JSON.stringify({ profileId, providerId, deviceCode: code.deviceCode }),
        this.key,
      ),
    }
  }

  async pollDevice(profileId: string, providerId: IntegrationProviderId, handle: string) {
    const provider = this.provider(providerId)
    if (!provider.device)
      throw new IntegrationRequestError("This service does not use device sign-in")
    let request: { profileId?: string; providerId?: string; deviceCode?: string }
    try {
      request = JSON.parse(decryptSecret(handle, this.key))
    } catch {
      throw new IntegrationRequestError("Invalid sign-in request")
    }
    if (request.profileId !== profileId || request.providerId !== providerId || !request.deviceCode)
      throw new IntegrationRequestError("Invalid sign-in request")
    const result = await provider.device.poll(request.deviceCode)
    if (result.status !== "authorized") return result.status
    await this.saveConnection(profileId, provider, result.credentials)
    return result.status
  }

  async connectApiKey(profileId: string, providerId: IntegrationProviderId, apiKey: string) {
    const provider = this.provider(providerId)
    if (provider.device) throw new IntegrationRequestError(`${provider.name} uses device sign-in`)
    try {
      await this.saveConnection(profileId, provider, { token: apiKey })
    } catch (error) {
      if (error instanceof ProviderError && (error.status === 401 || error.status === 403))
        throw new IntegrationRequestError(`${provider.name} rejected that API key`)
      throw error
    }
  }

  async disconnect(profileId: string, providerId: IntegrationProviderId) {
    await this.db
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.profileId, profileId),
          eq(integrationConnections.provider, providerId),
        ),
      )
  }

  /** Pulls one connection. Concurrent calls share the pull already running. */
  sync(profileId: string, providerId: IntegrationProviderId): Promise<void> {
    const key = `${profileId}:${providerId}`
    const running = this.pulls.get(key)
    if (running) return running
    const pull = this.pull(profileId, providerId).finally(() => this.pulls.delete(key))
    this.pulls.set(key, pull)
    return pull
  }

  /** Reports a playback checkpoint or a watched toggle that went through the progress API. */
  onProgress(profileId: string, { previous, current }: ProgressChange) {
    const ref = mediaRef(current)
    if (!ref) return
    const key = `${profileId}:${current.videoId}`
    const session = this.sessions.get(key)
    const progress =
      current.durationMs > 0
        ? Math.min(100, Math.round((current.positionMs / current.durationMs) * 10_000) / 100)
        : 0

    if (current.watched && !previous?.watched) {
      clearTimeout(session)
      this.sessions.delete(key)
      // Finishing playback scrobbles; a toggle without playback goes to history.
      if (session) this.scrobble(profileId, "stop", ref, Math.max(progress, 90))
      else this.setWatched(profileId, ref, true)
      return
    }
    // Web unmarks by resending the stored position and mobile by sending zero.
    // A rewatch checkpoint arrives mid-playback with a new position.
    if (
      !current.watched &&
      previous?.watched &&
      (current.positionMs === 0 || current.positionMs === previous.positionMs)
    ) {
      this.setWatched(profileId, ref, false)
      return
    }
    if (current.watched || current.durationMs <= 0) return

    // Clients only checkpoint while playing, so silence means pause or exit.
    if (!session) this.scrobble(profileId, "start", ref, progress)
    clearTimeout(session)
    const timer = setTimeout(() => {
      this.sessions.delete(key)
      this.scrobble(profileId, "pause", ref, progress)
    }, this.idleMs)
    timer.unref()
    this.sessions.set(key, timer)
  }

  /** Reports an explicit watched toggle from the PATCH progress API. */
  onWatched(profileId: string, row: ProgressChange["current"], watched: boolean) {
    const ref = mediaRef(row)
    if (ref) this.setWatched(profileId, ref, watched)
  }

  onListed(profileId: string, mediaType: "movie" | "series", mediaId: string, listed: boolean) {
    if (!isImdbId(mediaId)) return
    const ref: TitleRef = { type: mediaType, imdb: mediaId }
    this.dispatch(profileId, (connection, provider, queueKey) =>
      this.enqueue(queueKey, () =>
        this.withCredentials(connection, (credentials) =>
          provider.setListed(credentials, ref, listed),
        ),
      ),
    )
  }

  private provider(providerId: IntegrationProviderId): Provider {
    const provider = this.providers[providerId]
    if (!provider)
      throw new IntegrationRequestError(
        `${PROVIDER_NAMES[providerId]} is not configured on this server`,
      )
    return provider
  }

  private async saveConnection(profileId: string, provider: Provider, credentials: Credentials) {
    const accountName = await provider.accountName(credentials)
    const values = {
      profileId,
      provider: provider.id,
      accountName,
      credentialsEncrypted: encryptSecret(JSON.stringify(credentials), this.key),
      syncCursor: null,
      lastSyncedAt: null,
      lastError: null,
      updatedAt: new Date(),
    }
    await this.db
      .insert(integrationConnections)
      .values(values)
      .onConflictDoUpdate({
        target: [integrationConnections.profileId, integrationConnections.provider],
        set: values,
      })
    // Failures are logged and shown on the connection by `pull`.
    void this.sync(profileId, provider.id).catch(() => undefined)
  }

  private scrobble(profileId: string, action: ScrobbleAction, ref: MediaRef, progress: number) {
    this.dispatch(profileId, (connection, provider, queueKey) =>
      this.enqueue(queueKey, () =>
        this.withCredentials(connection, (credentials) =>
          provider.scrobble(credentials, action, ref, progress),
        ),
      ),
    )
  }

  /** Batches history toggles per connection so marking a season is one request. */
  private setWatched(profileId: string, ref: MediaRef, watched: boolean) {
    this.dispatch(profileId, (connection, provider, queueKey) => {
      const batchKey = `${queueKey}:${watched}`
      const pending = this.batches.get(batchKey)
      if (pending) {
        pending.push(ref)
        return
      }
      const refs = [ref]
      this.batches.set(batchKey, refs)
      this.enqueue(queueKey, async () => {
        await delay(this.batchMs)
        this.batches.delete(batchKey)
        await this.withCredentials(connection, (credentials) =>
          provider.setWatched(credentials, refs, watched),
        )
      })
    })
  }

  /** Calls `each` for every connected service of the profile, in the background. */
  private dispatch(
    profileId: string,
    each: (connection: Connection, provider: Provider, queueKey: string) => void,
  ) {
    void this.connections(profileId)
      .then((connections) => {
        for (const connection of connections) {
          const provider = this.providers[connection.provider]
          if (provider) each(connection, provider, `${profileId}:${connection.provider}`)
        }
      })
      .catch((error: unknown) => this.log.warn({ err: error }, "Integration push failed"))
  }

  private async connections(profileId: string): Promise<Connection[]> {
    return this.db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.profileId, profileId))
  }

  /** Runs writes to one service in order, spaced to respect its rate limit. */
  private enqueue(key: string, task: () => Promise<void>) {
    const next = (this.queues.get(key) ?? Promise.resolve())
      .then(task)
      .catch((error: unknown) => this.log.warn({ err: error }, "Integration push failed"))
      .then(() => delay(this.writeSpacingMs))
    this.queues.set(key, next)
    void next.then(() => {
      if (this.queues.get(key) === next) this.queues.delete(key)
    })
  }

  private async withCredentials<T>(
    connection: Pick<Connection, "profileId" | "provider">,
    run: (credentials: Credentials) => Promise<T>,
  ): Promise<T> {
    const credentials = await this.credentials(connection)
    try {
      return await run(credentials)
    } catch (error) {
      if (error instanceof ProviderError && (error.status === 401 || error.status === 403))
        await this.recordError(connection, "Access was revoked. Reconnect to resume syncing.")
      throw error
    }
  }

  /**
   * Reads credentials fresh from the database and refreshes OAuth tokens near
   * expiry. Concurrent callers share one load so a rotated refresh token is
   * never used twice.
   */
  private credentials(connection: Pick<Connection, "profileId" | "provider">) {
    const key = `${connection.profileId}:${connection.provider}`
    const pending = this.credentialLoads.get(key)
    if (pending) return pending
    const load = this.loadCredentials(connection).finally(() => this.credentialLoads.delete(key))
    this.credentialLoads.set(key, load)
    return load
  }

  private async loadCredentials(
    connection: Pick<Connection, "profileId" | "provider">,
  ): Promise<Credentials> {
    const [row] = await this.db
      .select({ credentialsEncrypted: integrationConnections.credentialsEncrypted })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.profileId, connection.profileId),
          eq(integrationConnections.provider, connection.provider),
        ),
      )
      .limit(1)
    if (!row) throw new IntegrationRequestError("This service is not connected")
    const credentials = JSON.parse(decryptSecret(row.credentialsEncrypted, this.key)) as Credentials
    const device = this.providers[connection.provider]?.device
    if (!device || !credentials.expiresAt || credentials.expiresAt - REFRESH_MARGIN_MS > Date.now())
      return credentials

    const next = await device.refresh(credentials).catch(async (error: unknown) => {
      if (error instanceof ProviderError && (error.status === 400 || error.status === 401))
        await this.recordError(connection, "Sign-in expired. Reconnect to resume syncing.")
      throw error
    })
    await this.db
      .update(integrationConnections)
      .set({
        credentialsEncrypted: encryptSecret(JSON.stringify(next), this.key),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.profileId, connection.profileId),
          eq(integrationConnections.provider, connection.provider),
        ),
      )
    return next
  }

  private async recordError(
    connection: Pick<Connection, "profileId" | "provider">,
    message: string,
  ) {
    await this.db
      .update(integrationConnections)
      .set({ lastError: message, updatedAt: new Date() })
      .where(
        and(
          eq(integrationConnections.profileId, connection.profileId),
          eq(integrationConnections.provider, connection.provider),
        ),
      )
  }

  private async syncAll() {
    const rows = await this.db
      .select({
        profileId: integrationConnections.profileId,
        provider: integrationConnections.provider,
      })
      .from(integrationConnections)
      .catch((error: unknown) => {
        this.log.warn({ err: error }, "Integration sync failed")
        return []
      })
    for (const row of rows) await this.sync(row.profileId, row.provider).catch(() => undefined)
  }

  private async pull(profileId: string, providerId: IntegrationProviderId) {
    const provider = this.provider(providerId)
    const [connection] = await this.db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.profileId, profileId),
          eq(integrationConnections.provider, providerId),
        ),
      )
      .limit(1)
    if (!connection) throw new IntegrationRequestError("This service is not connected")
    try {
      const cursor = await this.withCredentials(connection, async (credentials) => {
        const marker = await provider.activity(credentials)
        if (marker && marker === connection.syncCursor) return marker
        await this.apply(profileId, await provider.pull(credentials, connection.syncCursor))
        return marker || null
      })
      await this.db
        .update(integrationConnections)
        .set({ syncCursor: cursor, lastSyncedAt: new Date(), lastError: null })
        .where(
          and(
            eq(integrationConnections.profileId, profileId),
            eq(integrationConnections.provider, providerId),
          ),
        )
    } catch (error) {
      this.log.warn({ err: error, provider: providerId }, "Integration sync failed")
      if (!(error instanceof ProviderError && (error.status === 401 || error.status === 403)))
        await this.recordError(connection, `Sync failed: ${errorMessage(error)}`)
      throw error
    }
  }

  /**
   * Merges a remote library into the profile. Only adds or advances data:
   * remote removals never delete anything local, and a remote change only
   * replaces local progress that is older than it.
   */
  async apply(profileId: string, library: RemoteLibrary) {
    // Fetch missing runtimes before taking the profile's progress lock.
    const runtimes = new Map<string, number | undefined>()
    for (const item of library.playback) {
      if (item.runtimeMinutes) continue
      const key = videoIdOf(item.ref)
      if (!runtimes.has(key)) runtimes.set(key, await this.runtimeMinutes(item.ref))
    }
    const listed = library.watchlist.map((item) => ({
      profileId,
      mediaType: item.ref.type,
      mediaId: item.ref.imdb,
      name: item.name,
      poster: posterUrl(item.ref.imdb),
    }))

    await this.db.transaction(async (tx) => {
      for (const rows of chunks(listed)) {
        await tx.insert(libraryItems).values(rows).onConflictDoNothing()
      }
      if (!library.watched.length && !library.playback.length) return

      // Same lock and identity rules as client progress operations, so
      // imported rows can be dismissed and deleted like local ones.
      await tx.insert(progressSyncState).values({ profileId }).onConflictDoNothing()
      await tx
        .select()
        .from(progressSyncState)
        .where(eq(progressSyncState.profileId, profileId))
        .for("update")
      const titles = new Map<string, string | undefined>()
      for (const { ref } of [...library.watched, ...library.playback]) {
        const mediaType = ref.type === "movie" ? "movie" : "series"
        const key = `${mediaType}:${ref.imdb}`
        if (titles.has(key)) continue
        titles.set(
          key,
          await resolveCanonicalTitle(tx, profileId, { mediaType, mediaId: ref.imdb }).catch(
            (error: unknown) => {
              if (error instanceof AliasConflict) return undefined
              throw error
            },
          ),
        )
      }
      const identity = (ref: MediaRef) => {
        const canonicalTitleId = titles.get(
          `${ref.type === "movie" ? "movie" : "series"}:${ref.imdb}`,
        )
        const canonicalEpisodeKey = canonicalKey(
          ref.type === "episode" ? { season: ref.season, episode: ref.episode } : {},
        )
        return { canonicalTitleId, canonicalEpisodeKey }
      }

      const canonicalIds = [...new Set(titles.values())].filter((id) => id !== undefined)
      const videoIds = [
        ...new Set([...library.watched, ...library.playback].map((item) => videoIdOf(item.ref))),
      ]
      const byVideoId = new Map<string, ProgressRow>()
      const byCanonical = new Map<string, ProgressRow>()
      for (const ids of chunks(videoIds)) {
        const rows = await tx
          .select()
          .from(watchProgress)
          .where(and(eq(watchProgress.profileId, profileId), inArray(watchProgress.videoId, ids)))
        for (const row of rows) byVideoId.set(row.videoId, row)
      }
      for (const ids of chunks(canonicalIds)) {
        const rows = await tx
          .select()
          .from(watchProgress)
          .where(
            and(
              eq(watchProgress.profileId, profileId),
              inArray(watchProgress.canonicalTitleId, ids),
            ),
          )
        for (const row of rows)
          byCanonical.set(`${row.canonicalTitleId}:${row.canonicalEpisodeKey}`, row)
      }
      const localFor = (ref: MediaRef) => {
        const { canonicalTitleId, canonicalEpisodeKey } = identity(ref)
        return (
          (canonicalTitleId && byCanonical.get(`${canonicalTitleId}:${canonicalEpisodeKey}`)) ||
          byVideoId.get(videoIdOf(ref))
        )
      }

      const writes = new Map<string, ProgressWrite>()
      for (const item of library.playback) {
        const local = localFor(item.ref)
        if (local && local.updatedAt >= item.pausedAt) continue
        const durationMs =
          local?.durationMs ||
          (item.runtimeMinutes ?? runtimes.get(videoIdOf(item.ref)) ?? 0) * 60_000
        if (!durationMs) continue
        writes.set(local?.videoId ?? videoIdOf(item.ref), {
          ...rowIdentity(item.ref, item.name, item.episodeTitle),
          ...identity(item.ref),
          positionMs: Math.round((item.progress / 100) * durationMs),
          durationMs,
          watched: false,
          dismissed: false,
          continueWatching: true,
          updatedAt: item.pausedAt,
        })
      }

      const latestByShow = new Map<string, Date>()
      for (const item of library.watched) {
        if (item.ref.type !== "episode") continue
        const latest = latestByShow.get(item.ref.imdb)
        if (!latest || item.watchedAt > latest) latestByShow.set(item.ref.imdb, item.watchedAt)
      }
      const now = Date.now()
      for (const item of library.watched) {
        const local = localFor(item.ref)
        const videoId = local?.videoId ?? videoIdOf(item.ref)
        const planned = writes.get(videoId)
        if (local && local.updatedAt >= item.watchedAt) continue
        if (planned && planned.updatedAt >= item.watchedAt) continue
        const nextUp =
          item.ref.type === "episode" &&
          latestByShow.get(item.ref.imdb)?.getTime() === item.watchedAt.getTime() &&
          now - item.watchedAt.getTime() <= NEXT_UP_WINDOW_MS
        writes.set(videoId, {
          ...rowIdentity(item.ref, item.name),
          ...identity(item.ref),
          positionMs: local?.durationMs ?? 0,
          durationMs: local?.durationMs ?? 0,
          watched: true,
          dismissed: local?.dismissed ?? false,
          continueWatching: (local?.continueWatching ?? false) || nextUp,
          updatedAt: item.watchedAt,
        })
      }
      if (!writes.size) return

      // Bumping the generation makes incremental clients take a fresh snapshot.
      const [state] = await tx
        .update(progressSyncState)
        .set({
          revision: sql`${progressSyncState.revision} + 1`,
          generation: sql`${progressSyncState.generation} + 1`,
        })
        .where(eq(progressSyncState.profileId, profileId))
        .returning()
      const revision = state?.revision ?? 0
      for (const rows of chunks([...writes])) {
        await tx
          .insert(watchProgress)
          .values(rows.map(([videoId, values]) => ({ profileId, videoId, revision, ...values })))
          .onConflictDoUpdate({
            target: [watchProgress.profileId, watchProgress.videoId],
            set: {
              canonicalTitleId: sql`coalesce(excluded.canonical_title_id, ${watchProgress.canonicalTitleId})`,
              canonicalEpisodeKey: sql`coalesce(excluded.canonical_episode_key, ${watchProgress.canonicalEpisodeKey})`,
              positionMs: sql`excluded.position_ms`,
              durationMs: sql`excluded.duration_ms`,
              watched: sql`excluded.watched`,
              dismissed: sql`excluded.dismissed`,
              continueWatching: sql`excluded.continue_watching`,
              revision: sql`excluded.revision`,
              updatedAt: sql`excluded.updated_at`,
            },
            // Legacy progress writes do not take the lock above.
            setWhere: sql`${watchProgress.updatedAt} < excluded.updated_at`,
          })
      }
    })
  }

  /** Remote playback is a percentage; Cinemeta supplies the runtime when the service does not. */
  private async runtimeMinutes(ref: MediaRef): Promise<number | undefined> {
    const type = ref.type === "movie" ? "movie" : "series"
    try {
      const body = await requestJson<{ meta?: { runtime?: string } }>(
        this.fetchImpl,
        `https://v3-cinemeta.strem.io/meta/${type}/${ref.imdb}.json`,
      )
      const minutes = Number(body.meta?.runtime?.match(/\d+/)?.[0])
      return minutes > 0 ? minutes : undefined
    } catch {
      return undefined
    }
  }
}

type ProgressWrite = Omit<
  typeof watchProgress.$inferInsert,
  "profileId" | "videoId" | "revision"
> & { updatedAt: Date }

const PROVIDER_NAMES: Record<IntegrationProviderId, string> = {
  trakt: "Trakt",
  simkl: "Simkl",
  mdblist: "MDBList",
}

function isImdbId(value: string): boolean {
  return /^tt\d+$/.test(value)
}

/** Only Cinemeta-style IMDb ids can be matched on the tracking services. */
export function mediaRef(row: ProgressChange["current"]): MediaRef | undefined {
  if (!isImdbId(row.mediaId)) return
  if (row.mediaType === "movie") return { type: "movie", imdb: row.mediaId }
  if (row.mediaType !== "series" || row.season == null || row.episode == null) return
  return { type: "episode", imdb: row.mediaId, season: row.season, episode: row.episode }
}

export function videoIdOf(ref: MediaRef): string {
  return ref.type === "movie" ? ref.imdb : `${ref.imdb}:${ref.season}:${ref.episode}`
}

function rowIdentity(ref: MediaRef, name: string, episodeTitle?: string) {
  return {
    mediaType: ref.type === "movie" ? "movie" : "series",
    mediaId: ref.imdb,
    name,
    poster: posterUrl(ref.imdb),
    videoTitle: episodeTitle,
    season: ref.type === "episode" ? ref.season : undefined,
    episode: ref.type === "episode" ? ref.episode : undefined,
  }
}

function posterUrl(imdb: string) {
  return `https://images.metahub.space/poster/medium/${imdb}/img`
}

function chunks<T>(items: T[]): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += CHUNK)
    result.push(items.slice(index, index + CHUNK))
  return result
}

function delay(ms: number) {
  return ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error"
}
