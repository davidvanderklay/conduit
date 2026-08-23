import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import Fastify, { type FastifyInstance } from "fastify"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Auth } from "./auth.js"
import { createDatabase } from "./db/index.js"
import { households, profiles } from "./db/schema.js"
import type { RouteContext } from "./route-modules/context.js"
import { registerProgressSyncRoutes } from "./route-modules/progress-sync-routes.js"

vi.mock("./route-modules/helpers.js", () => ({
  canAccessProfile: async () => true,
  requireUser: async () => ({ id: "owner", email: "owner@example.com" }),
  toProgressItem: (item: Record<string, unknown>) => ({
    videoId: item.videoId,
    mediaType: item.mediaType,
    mediaId: item.mediaId,
    name: item.name,
    poster: item.poster,
    videoTitle: item.videoTitle,
    season: item.season,
    episode: item.episode,
    positionMs: item.positionMs,
    durationMs: item.durationMs,
    watched: item.watched,
    dismissed: item.dismissed,
    continueWatching: item.continueWatching,
    playbackSource: item.playbackSource,
    updatedAt: (item.updatedAt as Date).toISOString(),
  }),
}))

const profileId = "00000000-0000-4000-8000-000000000001"
const householdId = "00000000-0000-4000-8000-000000000002"

describe("incremental progress protocol", () => {
  let container: StartedPostgreSqlContainer
  let database: ReturnType<typeof createDatabase>
  let app: FastifyInstance

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start()
    database = createDatabase(container.getConnectionUri())
    await migrate(database.db, { migrationsFolder: "./drizzle" })
    await database.db.insert(households).values({ id: householdId, name: "Test" })
    await database.db.insert(profiles).values({ id: profileId, householdId, name: "Test" })
    app = Fastify()
    registerProgressSyncRoutes(app, { auth: {} as Auth, db: database.db } as RouteContext)
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await database?.pool.end()
    await container?.stop()
  })

  it("is idempotent, preserves snapshot boundaries, paginates deltas, and resolves aliases", async () => {
    const firstId = "10000000-0000-4000-8000-000000000001"
    const first = await operation(
      firstId,
      upsert("kitsu:13503", "kitsu:13503:1:1", 10_000, ["tt1234567"]),
    )
    const duplicate = await operation(
      firstId,
      upsert("kitsu:13503", "kitsu:13503:1:1", 10_000, ["tt1234567"]),
    )
    expect(duplicate.json()).toEqual(first.json())
    expect(first.json()).toMatchObject({ accepted: true, revision: 1 })

    await operation(
      "10000000-0000-4000-8000-000000000002",
      upsert("tt1234567", "tt1234567:1:1", 20_000),
    )

    const oldBoundary = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/progress/snapshot?boundary=1&generation=1`,
    })
    expect(oldBoundary.statusCode).toBe(200)
    expect(oldBoundary.json().items).toHaveLength(0)

    const delta = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/progress/changes?after=1&generation=1&limit=10`,
    })
    expect(delta.json()).toMatchObject({ nextCursor: 2, hasMore: false })
    expect(delta.json().events).toHaveLength(1)

    const currentSnapshot = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/progress/snapshot`,
    })
    expect(currentSnapshot.json().items).toHaveLength(1)
    expect(currentSnapshot.json().items[0]).toMatchObject({ positionMs: 20_000, revision: 2 })

    await operation("10000000-0000-4000-8000-000000000003", upsert("tt7654321", "tt7654321", 5_000))
    const firstPage = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/progress/changes?after=0&generation=1&limit=2`,
    })
    expect(firstPage.json()).toMatchObject({ nextCursor: 2, hasMore: true })
    const secondPage = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/progress/changes?after=2&generation=1&limit=2`,
    })
    expect(secondPage.json()).toMatchObject({ nextCursor: 3, hasMore: false })
    expect(secondPage.json().events).toHaveLength(1)

    await operation("10000000-0000-4000-8000-000000000004", {
      type: "deleteEpisode",
      identity: { mediaType: "series", mediaId: "tt1234567", season: 1, episode: 1 },
    })
    const tombstone = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/progress/changes?after=3&generation=1&limit=10`,
    })
    expect(tombstone.json().events[0]).toMatchObject({
      revision: 4,
      type: "deleteEpisode",
      payload: { kind: "deleteEpisode" },
    })

    const concurrent = await Promise.all([
      operation("10000000-0000-4000-8000-000000000005", {
        ...upsert("tt7654321", "tt7654321", 30_000),
        checkpointSessionId: "device-a",
      }),
      operation("10000000-0000-4000-8000-000000000006", {
        ...upsert("tt7654321", "tt7654321", 40_000),
        checkpointSessionId: "device-b",
      }),
    ])
    expect(concurrent.map((response) => response.json().revision).sort()).toEqual([5, 6])
    const concurrentEvents = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/progress/changes?after=4&generation=1&limit=10`,
    })
    const lastEvent = concurrentEvents.json().events.at(-1)
    const finalSnapshot = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/progress/snapshot`,
    })
    const movie = finalSnapshot
      .json()
      .items.find((item: { mediaId: string }) => item.mediaId === "tt7654321")
    expect(movie.positionMs).toBe(lastEvent.payload.item.positionMs)
  })

  async function operation(operationId: string, operation: Record<string, unknown>) {
    const response = await app.inject({
      method: "POST",
      url: `/v1/profiles/${profileId}/progress/operations`,
      payload: { operationId, operation },
    })
    expect(response.statusCode, response.body).toBe(200)
    return response
  }
})

function upsert(mediaId: string, videoId: string, positionMs: number, aliases: string[] = []) {
  return {
    type: "upsert",
    identity: {
      mediaType: videoId === mediaId ? "movie" : "series",
      mediaId,
      aliases,
      videoId,
      ...(videoId === mediaId ? {} : { season: 1, episode: 1 }),
    },
    name: "Title",
    positionMs,
    durationMs: 60_000,
    watched: false,
    checkpointSessionId: `session:${mediaId}`,
    checkpointSequence: 1,
  }
}
