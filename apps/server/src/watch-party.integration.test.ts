import { randomUUID } from "node:crypto"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { buildApp } from "./app.js"
import { createDatabase } from "./db/index.js"
import { householdMembers, households, profiles, sessions, users } from "./db/schema.js"

describe("watch party access and concurrent membership", () => {
  let container: StartedPostgreSqlContainer
  let database: ReturnType<typeof createDatabase>
  let app: Awaited<ReturnType<typeof buildApp>>
  let origin: string
  const hostProfiles = Array.from({ length: 10 }, () => randomUUID())
  const guestProfile = randomUUID()
  const headers = { authorization: "Bearer host-test-token" }
  const guestHeaders = { authorization: "Bearer guest-test-token" }
  const sockets: WebSocket[] = []

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start()
    database = createDatabase(container.getConnectionUri())
    await migrate(database.db, { migrationsFolder: "./drizzle" })
    await database.db.insert(users).values([
      { id: "host", email: "host@test.invalid", name: "Host", role: "owner" },
      { id: "guest", email: "guest@test.invalid", name: "Guest" },
    ])
    await database.db.insert(sessions).values(
      ["host", "guest"].map((userId) => ({
        id: `${userId}-session`,
        token: `${userId}-test-token`,
        userId,
        expiresAt: new Date(Date.now() + 60_000),
      })),
    )
    const hostHousehold = randomUUID(),
      guestHousehold = randomUUID()
    await database.db.insert(households).values([
      { id: hostHousehold, name: "Host" },
      { id: guestHousehold, name: "Guest" },
    ])
    await database.db.insert(householdMembers).values([
      { householdId: hostHousehold, userId: "host", role: "owner" },
      { householdId: guestHousehold, userId: "guest", role: "owner" },
    ])
    await database.db
      .insert(profiles)
      .values([
        ...hostProfiles.map((id) => ({ id, householdId: hostHousehold, name: "Host profile" })),
        { id: guestProfile, householdId: guestHousehold, name: "Guest" },
      ])
    app = await buildApp(
      {
        databaseUrl: container.getConnectionUri(),
        authSecret: "watch-party-integration-secret-at-least-32-characters",
        authUrl: "http://localhost:3000",
        webOrigin: "http://localhost:5173",
        addonEncryptionKey: Buffer.alloc(32),
        port: 3000,
        bootstrapMode: "first-user",
        trustProxy: false,
      },
      database.db,
    )
    origin = await app.listen({ port: 0, host: "127.0.0.1" })
  }, 120_000)
  afterAll(async () => {
    sockets.forEach((socket) => socket.terminate())
    await app?.close()
    await database?.pool.end()
    await container?.stop()
  })

  async function create(profileId: string, mode = "private") {
    const response = await app.inject({
      method: "POST",
      url: "/v1/watch-parties",
      headers,
      payload: { profileId, mode },
    })
    expect(response.statusCode, response.body).toBe(201)
    return response.json<{ party: { id: string }; invite?: { url: string }; ticket: string }>()
  }
  it("serializes joins at the eight-member limit and rejects guest media changes", async () => {
    const party = await create(hostProfiles[0]!)
    const responses = await Promise.all(
      hostProfiles.slice(1).map((profileId) =>
        app.inject({
          method: "POST",
          url: `/v1/watch-parties/${party.party.id}/join`,
          headers,
          payload: { profileId },
        }),
      ),
    )
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(7)
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(2)
    const guestIndex = responses.findIndex((response) => response.statusCode === 200)
    const guest = hostProfiles[guestIndex + 1]!
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/watch-parties/${party.party.id}/media`,
          headers,
          payload: { profileId: guest, media: null },
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/watch-parties/${party.party.id}/join`,
          headers: guestHeaders,
          payload: { profileId: guestProfile },
        })
      ).statusCode,
    ).toBe(403)
    await app.inject({
      method: "POST",
      url: `/v1/watch-parties/${party.party.id}/end`,
      headers,
      payload: { profileId: hostProfiles[0] },
    })
  })
  it("consumes each invitation once and revokes previous links when replacing them", async () => {
    const party = await create(hostProfiles[0]!, "shared")
    const oldToken = party.invite!.url.split("/").at(-1)!
    const invite = await app.inject({
      method: "POST",
      url: `/v1/watch-parties/${party.party.id}/invites`,
      headers,
      payload: { profileId: hostProfiles[0] },
    })
    const token = invite.json<{ invite: { url: string } }>().invite.url.split("/").at(-1)!
    const accept = (value: string) =>
      app.inject({
        method: "POST",
        url: `/v1/watch-parties/invites/${value}/accept`,
        headers: guestHeaders,
        payload: { profileId: guestProfile },
      })
    expect((await accept(oldToken)).statusCode).toBe(400)
    const responses = await Promise.all([accept(token), accept(token)])
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400])
    const replacement = await app.inject({
      method: "POST",
      url: `/v1/watch-parties/${party.party.id}/invites`,
      headers,
      payload: { profileId: hostProfiles[0] },
    })
    expect(
      (await accept(replacement.json<{ invite: { url: string } }>().invite.url.split("/").at(-1)!))
        .statusCode,
    ).toBe(200)
    await app.inject({
      method: "POST",
      url: `/v1/watch-parties/${party.party.id}/end`,
      headers,
      payload: { profileId: hostProfiles[0] },
    })
  })
  it("rechecks the login session before consuming a websocket ticket", async () => {
    const party = await create(hostProfiles[0]!)
    await database.pool.query("DELETE FROM session WHERE id = 'host-session'")
    const socket = new WebSocket(
      `${origin.replace("http:", "ws:")}/v1/watch-parties/socket?ticket=${party.ticket}`,
    )
    sockets.push(socket)
    const error = await new Promise<Error>((resolve, reject) => {
      socket.once("error", resolve)
      socket.once("open", () => reject(Error("Revoked session opened a socket")))
    })
    expect(error).toBeInstanceOf(Error)
  })
})
