import { afterEach, describe, expect, it, vi } from "vitest"
import type { Config } from "./config.js"
import type { Database } from "./db/index.js"
import { libraryItems, profiles } from "./db/schema.js"

vi.mock("./auth.js", () => ({
  createAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        headers.get("authorization") === "Bearer owner"
          ? { user: { id: "owner" } }
          : null,
    },
    handler: async () => new Response(null, { status: 404 }),
  }),
}))

const { buildApp } = await import("./app.js")

const config: Config = {
  databaseUrl: "postgresql://unused",
  authSecret: "test-secret-that-is-at-least-32-characters",
  authUrl: "http://localhost:3000",
  addonEncryptionKey: Buffer.alloc(32),
  webOrigin: "http://localhost:5173",
  port: 3000,
  bootstrapMode: "first-user",
}
const profileId = "00000000-0000-4000-8000-000000000001"
const otherProfileId = "00000000-0000-4000-8000-000000000002"

describe("profile library routes", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
  })

  it("upserts the same title idempotently and returns cached metadata", async () => {
    const database = fakeDatabase()
    const app = await buildApp(config, database.db)
    apps.push(app)
    const url = `/v1/profiles/${profileId}/library/movie/tt123`
    const first = await app.inject({
      method: "PUT",
      url,
      headers: { authorization: "Bearer owner" },
      payload: { name: "First title", poster: "https://example.com/first.jpg" },
    })
    const second = await app.inject({
      method: "PUT",
      url,
      headers: { authorization: "Bearer owner" },
      payload: { name: "Updated title", poster: "https://example.com/updated.jpg" },
    })
    const list = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/library`,
      headers: { authorization: "Bearer owner" },
    })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(list.statusCode).toBe(200)
    expect(list.json().items).toHaveLength(1)
    expect(list.json().items[0]).toMatchObject({
      id: "tt123",
      type: "movie",
      name: "Updated title",
      poster: "https://example.com/updated.jpg",
    })
  })

  it("removes titles idempotently", async () => {
    const database = fakeDatabase()
    const app = await buildApp(config, database.db)
    apps.push(app)
    const url = `/v1/profiles/${profileId}/library/series/show-1`
    await app.inject({
      method: "PUT",
      url,
      headers: { authorization: "Bearer owner" },
      payload: { name: "A show" },
    })

    expect(
      (await app.inject({ method: "DELETE", url, headers: { authorization: "Bearer owner" } }))
        .statusCode,
    ).toBe(204)
    expect(
      (await app.inject({ method: "DELETE", url, headers: { authorization: "Bearer owner" } }))
        .statusCode,
    ).toBe(204)
  })

  it("rejects unauthenticated and inaccessible profiles", async () => {
    const app = await buildApp(config, fakeDatabase().db)
    apps.push(app)

    const unauthenticated = await app.inject({
      method: "GET",
      url: `/v1/profiles/${profileId}/library`,
    })
    const forbidden = await app.inject({
      method: "GET",
      url: `/v1/profiles/${otherProfileId}/library`,
      headers: { authorization: "Bearer owner" },
    })

    expect(unauthenticated.statusCode).toBe(401)
    expect(forbidden.statusCode).toBe(403)
  })
})

function fakeDatabase() {
  type Row = typeof libraryItems.$inferSelect
  const rows = new Map<string, Row>()
  let selectedTable: unknown
  let accessAllowed = true

  const db = {
    select: () => ({
      from(table: unknown) {
        selectedTable = table
        return this
      },
      innerJoin() {
        return this
      },
      where(condition: unknown) {
        if (selectedTable === profiles) accessAllowed = containsValue(condition, profileId)
        return this
      },
      limit: async () => (selectedTable === profiles && accessAllowed ? [{ id: profileId }] : []),
      orderBy: async () => [...rows.values()],
    }),
    insert: () => ({
      values(value: Omit<Row, "createdAt" | "updatedAt">) {
        return {
          onConflictDoUpdate: () => ({
            returning: async () => {
              const key = `${value.profileId}:${value.mediaType}:${value.mediaId}`
              const previous = rows.get(key)
              const now = new Date()
              const row = {
                ...value,
                createdAt: previous?.createdAt ?? now,
                updatedAt: now,
              } as Row
              rows.set(key, row)
              return [row]
            },
          }),
        }
      },
    }),
    delete: () => ({
      where: async () => {
        rows.clear()
      },
    }),
  } as unknown as Database

  return { db, rows }
}

function containsValue(value: unknown, expected: string, seen = new WeakSet<object>()): boolean {
  if (value === expected) return true
  if (!value || typeof value !== "object" || seen.has(value)) return false
  seen.add(value)
  return Object.values(value).some((child) => containsValue(child, expected, seen))
}
