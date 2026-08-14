import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Auth } from "./auth.js"
import type { Database } from "./db/index.js"
import { watchProgress } from "./db/schema.js"
import type { RouteContext } from "./route-modules/context.js"
import { registerProgressRoutes } from "./route-modules/progress-routes.js"

type ProgressRow = typeof watchProgress.$inferSelect

vi.mock("./route-modules/helpers.js", () => ({
  canAccessProfile: async () => true,
  requireUser: async () => ({ id: "owner", email: "owner@example.com" }),
  toProgressItem: (item: ProgressRow) => ({
    videoId: item.videoId,
    mediaType: item.mediaType,
    mediaId: item.mediaId,
    name: item.name,
    watched: item.watched,
    dismissed: item.dismissed,
    continueWatching: item.continueWatching,
    updatedAt: item.updatedAt.toISOString(),
  }),
}))

const profileId = "00000000-0000-4000-8000-000000000001"

describe("progress routes", () => {
  const apps: Awaited<ReturnType<typeof Fastify>>[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
  })

  it("removes every episode of a series from Continue Watching", async () => {
    const rows = [
      progressRow("s1e1", "2026-08-10T12:00:00Z"),
      progressRow("s1e2", "2026-08-12T12:00:00Z", 2),
      progressRow("other-show", "2026-08-11T12:00:00Z", 1, "other-show"),
    ]
    const database = fakeDatabase(rows)
    const app = Fastify()
    registerProgressRoutes(
      app,
      { auth: {} as Auth, db: database } as RouteContext,
    )
    apps.push(app)

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/profiles/${profileId}/progress/s1e2`,
      headers: { authorization: "Bearer owner" },
      payload: { dismissed: true },
    })

    expect(response.statusCode).toBe(200)
    expect(rows.filter((row) => row.mediaId === "show").every((row) => row.dismissed)).toBe(true)
    expect(rows.find((row) => row.mediaId === "other-show")?.dismissed).toBe(false)
  })
})

function progressRow(
  videoId: string,
  updatedAt: string,
  episode = 1,
  mediaId = "show",
): ProgressRow {
  return {
    profileId,
    videoId,
    mediaType: "series",
    mediaId,
    name: mediaId === "show" ? "Show" : "Other show",
    poster: null,
    videoTitle: `Episode ${episode}`,
    season: 1,
    episode,
    positionMs: 10_000,
    durationMs: 60_000,
    watched: false,
    dismissed: false,
    continueWatching: true,
    playbackSource: null,
    updatedAt: new Date(updatedAt),
  }
}

function fakeDatabase(rows: ProgressRow[]): Database {
  return {
    select: () => {
      let condition: unknown
      const builder = {
        from: () => builder,
        where: (next: unknown) => {
          condition = next
          return builder
        },
        limit: async (amount: number) => rows.filter((row) => matches(condition, row)).slice(0, amount),
      }
      return builder
    },
    update: () => {
      let values: Record<string, unknown> = {}
      let condition: unknown
      const builder = {
        set: (next: Record<string, unknown>) => {
          values = next
          return builder
        },
        where: (next: unknown) => {
          condition = next
          return {
            returning: async () => rows.filter((row) => matches(condition, row)).map((row) => {
              Object.assign(row, values)
              return row
            }),
          }
        },
      }
      return builder
    },
  } as unknown as Database
}

function matches(condition: unknown, row: ProgressRow): boolean {
  if (!containsValue(condition, row.profileId)) return false
  if (containsValue(condition, row.videoId)) return true
  return containsValue(condition, row.mediaType) && containsValue(condition, row.mediaId)
}

function containsValue(value: unknown, expected: string, seen = new WeakSet<object>()): boolean {
  if (value === expected) return true
  if (!value || typeof value !== "object" || seen.has(value)) return false
  seen.add(value)
  return Object.values(value).some((child) => containsValue(child, expected, seen))
}
