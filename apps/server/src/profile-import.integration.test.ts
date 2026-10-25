import { randomBytes } from "node:crypto"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import Fastify, { type FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Auth } from "./auth.js"
import type { Config } from "./config.js"
import { encryptSecret, stableSecretHash } from "./crypto.js"
import { createDatabase } from "./db/index.js"
import {
  addonInstallations,
  households,
  libraryItems,
  profiles,
  watchProgress,
} from "./db/schema.js"
import type { RouteContext } from "./route-modules/context.js"
import { registerProfileRoutes } from "./route-modules/profile-routes.js"

vi.mock("./route-modules/helpers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./route-modules/helpers.js")>()),
  canAccessProfile: async () => true,
  requireUser: async () => ({ id: "owner", email: "owner@example.com" }),
}))

const profileId = "00000000-0000-4000-8000-000000000011"
const householdId = "00000000-0000-4000-8000-000000000012"
const addonEncryptionKey = randomBytes(32)

describe("additive profile import", () => {
  let container: StartedPostgreSqlContainer
  let database: ReturnType<typeof createDatabase>
  let app: FastifyInstance

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start()
    database = createDatabase(container.getConnectionUri())
    await migrate(database.db, { migrationsFolder: "./drizzle" })
    await database.db.insert(households).values({ id: householdId, name: "Test" })
    await database.db.insert(profiles).values({ id: profileId, householdId, name: "Main" })
    app = Fastify()
    await app.register(import("@fastify/sensible"))
    registerProfileRoutes(app, {
      auth: {} as Auth,
      config: { addonEncryptionKey } as Config,
      db: database.db,
    } as RouteContext)
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await database?.pool.end()
    await container?.stop()
  })

  it("fills gaps without overwriting newer local data", async () => {
    const { db } = database
    await db
      .insert(libraryItems)
      .values({ profileId, mediaType: "movie", mediaId: "tt1", name: "Local name" })
    await db
      .insert(watchProgress)
      .values([
        progressRow("tt1", 50_000, "2025-06-01T00:00:00.000Z"),
        progressRow("tt2", 10_000, "2025-01-01T00:00:00.000Z"),
      ])
    const torrentio = "https://torrentio.example/mine/manifest.json"
    await db.insert(addonInstallations).values({
      profileId,
      manifestId: "torrentio",
      manifestUrlEncrypted: encryptSecret(torrentio, addonEncryptionKey),
      manifestUrlHash: stableSecretHash(torrentio, addonEncryptionKey),
      manifest: { id: "torrentio", name: "Torrentio" },
      position: 3,
    })

    const response = await app.inject({
      method: "POST",
      url: `/v1/profiles/${profileId}/import`,
      payload: {
        mode: "additive",
        data: {
          format: "conduit-profile",
          version: 1,
          exportedAt: "2026-01-01T00:00:00.000Z",
          profile: { name: "Stremio", isKids: true },
          library: [libraryEntry("tt1", "Imported name"), libraryEntry("tt3", "New title")],
          progress: [
            progressEntry("tt1", 1_000, "2025-01-01T00:00:00.000Z"),
            progressEntry("tt2", 90_000, "2025-03-01T00:00:00.000Z"),
            progressEntry("tt3", 5_000, "2025-03-01T00:00:00.000Z"),
          ],
          addons: [
            addonEntry("torrentio", "https://torrentio.example/theirs/manifest.json", 0),
            addonEntry("org.subs", "https://subs.example/manifest.json", 1),
          ],
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().added).toEqual({ library: 1, progress: 2, addons: 1 })

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId))
    expect(profile).toMatchObject({ name: "Main", isKids: false })
    const library = await db
      .select()
      .from(libraryItems)
      .where(eq(libraryItems.profileId, profileId))
    expect(library.map((item) => [item.mediaId, item.name]).sort()).toEqual([
      ["tt1", "Local name"],
      ["tt3", "New title"],
    ])
    const positions = Object.fromEntries(
      (await db.select().from(watchProgress).where(eq(watchProgress.profileId, profileId))).map(
        (item) => [item.videoId, item.positionMs],
      ),
    )
    expect(positions).toEqual({ tt1: 50_000, tt2: 90_000, tt3: 5_000 })
    const addons = await db
      .select()
      .from(addonInstallations)
      .where(eq(addonInstallations.profileId, profileId))
    expect(addons.map((addon) => [addon.manifestId, addon.position]).sort()).toEqual([
      ["org.subs", 5],
      ["torrentio", 3],
    ])
  })
})

function libraryEntry(mediaId: string, name: string) {
  return {
    mediaType: "movie",
    mediaId,
    name,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  }
}

function progressEntry(videoId: string, positionMs: number, updatedAt: string) {
  return {
    videoId,
    mediaType: "movie",
    mediaId: videoId,
    name: videoId,
    positionMs,
    durationMs: 100_000,
    watched: false,
    continueWatching: true,
    updatedAt,
  }
}

function progressRow(videoId: string, positionMs: number, updatedAt: string) {
  const { updatedAt: _, ...entry } = progressEntry(videoId, positionMs, updatedAt)
  return { ...entry, profileId, updatedAt: new Date(updatedAt) }
}

function addonEntry(manifestId: string, manifestUrl: string, position: number) {
  return {
    manifestId,
    manifestUrl,
    manifest: { id: manifestId, name: manifestId },
    position,
    enabled: true,
  }
}
