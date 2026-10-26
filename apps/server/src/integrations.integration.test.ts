import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { and, eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import Fastify, { type FastifyInstance } from "fastify"
import sensible from "@fastify/sensible"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Auth } from "./auth.js"
import { decryptSecret, encryptSecret } from "./crypto.js"
import { createDatabase } from "./db/index.js"
import {
  households,
  integrationConnections,
  libraryItems,
  profiles,
  progressSyncState,
  watchProgress,
} from "./db/schema.js"
import type { Credentials, Provider } from "./integrations/providers.js"
import { IntegrationSync } from "./integrations/service.js"
import type { RouteContext } from "./route-modules/context.js"
import { registerIntegrationRoutes } from "./route-modules/integration-routes.js"
import { registerProgressSyncRoutes } from "./route-modules/progress-sync-routes.js"

vi.mock("./route-modules/helpers.js", async (original) => ({
  ...(await original<typeof import("./route-modules/helpers.js")>()),
  canAccessProfile: async () => true,
  requireUser: async () => ({ id: "owner", email: "owner@example.com" }),
}))

const key = Buffer.alloc(32, 7)
const profileId = "00000000-0000-4000-8000-000000000001"
const householdId = "00000000-0000-4000-8000-000000000002"

function fakeProvider() {
  return {
    id: "trakt",
    name: "Trakt",
    device: {
      start: vi.fn(async () => ({
        deviceCode: "device-secret",
        userCode: "ABCD1234",
        verificationUrl: "https://trakt.tv/activate",
        interval: 5,
        expiresIn: 600,
      })),
      poll: vi.fn(async () => ({
        status: "authorized" as const,
        credentials: {
          token: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 86_400_000,
        },
      })),
      refresh: vi.fn<NonNullable<Provider["device"]>["refresh"]>(async () => ({
        token: "fresh",
        refreshToken: "refresh-2",
        expiresAt: Date.now() + 86_400_000,
      })),
    },
    accountName: vi.fn<Provider["accountName"]>(async () => "david"),
    scrobble: vi.fn<Provider["scrobble"]>(async () => undefined),
    setWatched: vi.fn<Provider["setWatched"]>(async () => undefined),
    setListed: vi.fn<Provider["setListed"]>(async () => undefined),
    activity: vi.fn<Provider["activity"]>(async () => "marker-1"),
    pull: vi.fn<Provider["pull"]>(async () => ({ watched: [], watchlist: [], playback: [] })),
  } satisfies Provider
}

describe("tracking service sync", () => {
  let container: StartedPostgreSqlContainer
  let database: ReturnType<typeof createDatabase>
  let provider: ReturnType<typeof fakeProvider>
  let sync: IntegrationSync
  let app: FastifyInstance

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start()
    database = createDatabase(container.getConnectionUri())
    await migrate(database.db, { migrationsFolder: "./drizzle" })
    await database.db.insert(households).values({ id: householdId, name: "Test" })
    await database.db.insert(profiles).values({ id: profileId, householdId, name: "Test" })
  }, 120_000)

  beforeEach(async () => {
    await app?.close()
    sync?.stop()
    await database.db.delete(integrationConnections)
    await database.db.delete(watchProgress)
    await database.db.delete(libraryItems)
    provider = fakeProvider()
    sync = new IntegrationSync(database.db, key, {
      providers: { trakt: provider },
      log: { warn: vi.fn() },
      // Runtime lookups stay offline; local durations cover these tests.
      fetch: async () => {
        throw new Error("offline")
      },
      writeSpacingMs: 0,
      idleMs: 100,
      batchMs: 50,
    })
    app = Fastify()
    await app.register(sensible)
    const context = { auth: {} as Auth, db: database.db, integrations: sync } as RouteContext
    registerProgressSyncRoutes(app, context)
    registerIntegrationRoutes(app, context)
  })

  afterAll(async () => {
    await app?.close()
    sync?.stop()
    await database?.pool.end()
    await container?.stop()
  })

  async function connect(credentials: Credentials = { token: "access" }) {
    await database.db.insert(integrationConnections).values({
      profileId,
      provider: "trakt",
      accountName: "david",
      credentialsEncrypted: encryptSecret(JSON.stringify(credentials), key),
    })
  }

  function upsert(
    videoId: string,
    positionMs: number,
    watched: boolean,
    sequence: number,
    session = "session",
  ) {
    return app.inject({
      method: "POST",
      url: `/v1/profiles/${profileId}/progress/operations`,
      payload: {
        operationId: crypto.randomUUID(),
        operation: {
          type: "upsert",
          identity: { mediaType: "series", mediaId: "tt0903747", videoId, season: 1, episode: 2 },
          name: "Breaking Bad",
          positionMs,
          durationMs: 100_000,
          watched,
          checkpointSessionId: session,
          checkpointSequence: sequence,
        },
      },
    })
  }

  const episode = { type: "episode", imdb: "tt0903747", season: 1, episode: 2 } as const

  it("connects through the device flow without exposing the device code", async () => {
    const started = await app.inject({
      method: "POST",
      url: `/v1/profiles/${profileId}/integrations/trakt/device`,
    })
    const body = started.json()
    expect(body).toMatchObject({
      userCode: "ABCD1234",
      verificationUrl: "https://trakt.tv/activate",
    })
    expect(JSON.stringify(body)).not.toContain("device-secret")

    const polled = await app.inject({
      method: "POST",
      url: `/v1/profiles/${profileId}/integrations/trakt/device/poll`,
      payload: { handle: body.handle },
    })
    expect(polled.json()).toEqual({ status: "authorized" })
    expect(provider.device.poll).toHaveBeenCalledWith("device-secret")

    const status = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/integrations`,
    })
    expect(status.json().integrations[0]).toMatchObject({
      id: "trakt",
      available: true,
      connection: { accountName: "david" },
    })
    expect(JSON.stringify(status.json())).not.toContain("access")
  })

  it("scrobbles playback: start, pause after silence, stop when finished", async () => {
    await connect()
    await upsert("tt0903747:1:2", 10_000, false, 1)
    await upsert("tt0903747:1:2", 25_000, false, 2)
    await vi.waitFor(() => expect(provider.scrobble).toHaveBeenCalledTimes(2))
    expect(provider.scrobble.mock.calls.map((call) => call.slice(1))).toEqual([
      ["start", episode, 10],
      ["pause", episode, 25],
    ])

    await upsert("tt0903747:1:2", 50_000, false, 3)
    await upsert("tt0903747:1:2", 100_000, true, 4)
    await vi.waitFor(() => expect(provider.scrobble).toHaveBeenCalledTimes(4))
    expect(provider.scrobble.mock.calls.slice(2).map((call) => call[1])).toEqual(["start", "stop"])
    expect(provider.setWatched).not.toHaveBeenCalled()
  })

  it("sends watched toggles as one batched history write", async () => {
    await connect()
    await Promise.all([
      upsert("tt0903747:1:2", 0, true, 1),
      app.inject({
        method: "POST",
        url: `/v1/profiles/${profileId}/progress/operations`,
        payload: {
          operationId: crypto.randomUUID(),
          operation: {
            type: "upsert",
            identity: { mediaType: "movie", mediaId: "tt0372784", videoId: "tt0372784" },
            name: "Batman Begins",
            positionMs: 0,
            durationMs: 0,
            watched: true,
            checkpointSessionId: "toggle",
            checkpointSequence: 1,
          },
        },
      }),
    ])
    await vi.waitFor(() => expect(provider.setWatched).toHaveBeenCalledTimes(1))
    expect(provider.setWatched.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([episode, { type: "movie", imdb: "tt0372784" }]),
    )

    // Mobile unmarks with position zero; a rewatch checkpoint keeps scrobbling.
    await upsert("tt0903747:1:2", 0, false, 1, "manual:unwatch")
    await vi.waitFor(() => expect(provider.setWatched).toHaveBeenCalledTimes(2))
    expect(provider.setWatched.mock.calls[1]?.slice(1)).toEqual([[episode], false])
    expect(provider.scrobble).not.toHaveBeenCalled()
  })

  it("refreshes an expiring token once for concurrent pulls and writes", async () => {
    await connect({ token: "old", refreshToken: "refresh", expiresAt: Date.now() + 60_000 })
    sync.onListed(profileId, "movie", "tt0372784", true)
    await sync.sync(profileId, "trakt")
    await vi.waitFor(() => expect(provider.setListed).toHaveBeenCalledTimes(1))
    expect(provider.device.refresh).toHaveBeenCalledTimes(1)
    expect(provider.setListed.mock.calls[0]?.[0].token).toBe("fresh")
    expect(provider.activity.mock.calls[0]?.[0].token).toBe("fresh")
    const [row] = await database.db.select().from(integrationConnections)
    expect(JSON.parse(decryptSecret(row!.credentialsEncrypted, key))).toMatchObject({
      token: "fresh",
    })
  })

  it("merges a remote library without overwriting newer local progress", async () => {
    await connect()
    const now = Date.now()
    await database.db.insert(watchProgress).values([
      {
        profileId,
        videoId: "tt1375666",
        mediaType: "movie",
        mediaId: "tt1375666",
        name: "Inception",
        positionMs: 600_000,
        durationMs: 8_880_000,
        continueWatching: true,
        updatedAt: new Date(now),
      },
      {
        profileId,
        videoId: "tt0111161",
        mediaType: "movie",
        mediaId: "tt0111161",
        name: "The Shawshank Redemption",
        positionMs: 600_000,
        durationMs: 8_520_000,
        continueWatching: true,
        updatedAt: new Date(now - 7_200_000),
      },
    ])
    const [before] = await database.db.select().from(progressSyncState)
    provider.pull.mockResolvedValueOnce({
      watchlist: [{ ref: { type: "series", imdb: "tt0158552" }, name: "Charmed" }],
      watched: [
        {
          ref: { type: "episode", imdb: "tt0903747", season: 1, episode: 1 },
          name: "Breaking Bad",
          watchedAt: new Date(now - 2 * 86_400_000),
        },
        { ref: episode, name: "Breaking Bad", watchedAt: new Date(now - 86_400_000) },
      ],
      playback: [
        {
          ref: { type: "movie", imdb: "tt0372784" },
          name: "Batman Begins",
          progress: 50,
          pausedAt: new Date(now - 3_600_000),
          runtimeMinutes: 140,
        },
        // Older than the local checkpoint, so the local position stays.
        {
          ref: { type: "movie", imdb: "tt1375666" },
          name: "Inception",
          progress: 5,
          pausedAt: new Date(now - 60_000),
          runtimeMinutes: 148,
        },
        // Paused elsewhere after the local checkpoint, so it moves forward.
        {
          ref: { type: "movie", imdb: "tt0111161" },
          name: "The Shawshank Redemption",
          progress: 50,
          pausedAt: new Date(now - 60_000),
        },
      ],
    })

    await sync.sync(profileId, "trakt")

    const rows = await database.db
      .select()
      .from(watchProgress)
      .where(eq(watchProgress.profileId, profileId))
    const byId = new Map(rows.map((row) => [row.videoId, row]))
    expect(byId.get("tt0372784")).toMatchObject({
      positionMs: 4_200_000,
      durationMs: 8_400_000,
      continueWatching: true,
      watched: false,
    })
    expect(byId.get("tt1375666")).toMatchObject({ positionMs: 600_000 })
    expect(byId.get("tt0111161")).toMatchObject({ positionMs: 4_260_000 })
    // Only the latest episode of a recently watched show feeds Next Up.
    expect(byId.get("tt0903747:1:1")).toMatchObject({ watched: true, continueWatching: false })
    expect(byId.get("tt0903747:1:2")).toMatchObject({ watched: true, continueWatching: true })
    expect(
      await database.db
        .select()
        .from(libraryItems)
        .where(and(eq(libraryItems.profileId, profileId), eq(libraryItems.mediaId, "tt0158552"))),
    ).toHaveLength(1)
    const [after] = await database.db.select().from(progressSyncState)
    expect(after!.generation).toBe((before?.generation ?? 1) + 1)

    // A newer remote rewatch of a watched episode feeds Next Up again.
    provider.activity.mockResolvedValueOnce("marker-rewatch")
    provider.pull.mockResolvedValueOnce({
      watchlist: [],
      playback: [],
      watched: [
        {
          ref: { type: "episode", imdb: "tt0903747", season: 1, episode: 1 },
          name: "Breaking Bad",
          watchedAt: new Date(now - 60_000),
        },
      ],
    })
    await sync.sync(profileId, "trakt")
    const [rewatched] = await database.db
      .select()
      .from(watchProgress)
      .where(
        and(eq(watchProgress.profileId, profileId), eq(watchProgress.videoId, "tt0903747:1:1")),
      )
    expect(rewatched).toMatchObject({ watched: true, continueWatching: true })

    // Imported rows carry canonical identity, so client dismissals reach them.
    expect(byId.get("tt0372784")?.canonicalTitleId).toBeTruthy()
    await app.inject({
      method: "POST",
      url: `/v1/profiles/${profileId}/progress/operations`,
      payload: {
        operationId: crypto.randomUUID(),
        operation: {
          type: "dismissTitle",
          identity: { mediaType: "movie", mediaId: "tt0372784", videoId: "tt0372784" },
        },
      },
    })
    const [dismissed] = await database.db
      .select()
      .from(watchProgress)
      .where(and(eq(watchProgress.profileId, profileId), eq(watchProgress.videoId, "tt0372784")))
    expect(dismissed?.dismissed).toBe(true)

    // An unchanged activity marker skips the pull.
    await sync.sync(profileId, "trakt")
    await sync.sync(profileId, "trakt")
    expect(provider.pull).toHaveBeenCalledTimes(3)
    const [connection] = await database.db.select().from(integrationConnections)
    expect(connection).toMatchObject({ syncCursor: "marker-1", lastError: null })
  })
})
