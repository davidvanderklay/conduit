import { Type } from "@sinclair/typebox"
import { createHash, randomBytes } from "node:crypto"
import { and, eq, inArray, isNull, gt, lt } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import type { Database } from "../db/index.js"
import {
  profiles,
  sessions,
  householdMembers,
  watchParties,
  watchPartyInvites,
  watchPartyMembers,
  type WatchPartyMedia,
} from "../db/schema.js"
import { WatchPartyHub } from "../watch-party.js"
import type { RouteContext } from "./context.js"
import { requireUser, canAccessProfile, consumeRateLimit } from "./helpers.js"
const MAX_WATCH_PARTY_MEMBERS = 8
const WATCH_PARTY_TTL_MS = 24 * 60 * 60 * 1000
const watchPartyMediaSchema = Type.Object({
  type: Type.Union([Type.Literal("movie"), Type.Literal("series")]),
  mediaId: Type.String({ minLength: 1, maxLength: 300 }),
  videoId: Type.String({ minLength: 1, maxLength: 300 }),
  title: Type.String({ minLength: 1, maxLength: 300 }),
  poster: Type.Optional(Type.String({ maxLength: 4096 })),
  videoTitle: Type.Optional(Type.String({ maxLength: 300 })),
  season: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
  episode: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
})

export function registerWatchPartyRoutes(app: FastifyInstance, { auth, config, db }: RouteContext) {
  const watchPartyHub = new WatchPartyHub({
    authorize: async (actor) => {
      if (!actor.sessionId) return false
      const [session] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.id, actor.sessionId),
            eq(sessions.userId, actor.userId),
            gt(sessions.expiresAt, new Date()),
          ),
        )
        .limit(1)
      if (!session) return false
      const [member] = await db
        .select({ role: watchPartyMembers.role })
        .from(watchPartyMembers)
        .innerJoin(watchParties, eq(watchParties.id, watchPartyMembers.partyId))
        .where(
          and(
            eq(watchPartyMembers.partyId, actor.partyId),
            eq(watchPartyMembers.userId, actor.userId),
            eq(watchPartyMembers.profileId, actor.profileId),
            isNull(watchPartyMembers.leftAt),
            eq(watchParties.status, "active"),
            gt(watchParties.expiresAt, new Date()),
          ),
        )
        .limit(1)
      return (
        member?.role === actor.role && (await canAccessProfile(db, actor.userId, actor.profileId))
      )
    },
    onHostExpired: async (partyId) => {
      await db
        .update(watchParties)
        .set({ status: "ended", endedAt: new Date(), updatedAt: new Date() })
        .where(eq(watchParties.id, partyId))
    },
    onError: (error) => app.log.error(error, "Watch party operation failed"),
  })
  watchPartyHub.attach(app.server)
  const expirationTimer = setInterval(() => {
    void expireWatchParties(db, watchPartyHub).catch((error: unknown) =>
      app.log.error(error, "Party expiration failed"),
    )
  }, 60_000)
  expirationTimer.unref()
  app.addHook("onClose", async () => {
    clearInterval(expirationTimer)
    watchPartyHub.close()
  })
  app.get("/v1/watch-parties/capabilities", async () => ({
    protocolVersion: 1,
    maxMembers: MAX_WATCH_PARTY_MEMBERS,
  }))
  app.get(
    "/v1/watch-parties",
    {
      schema: {
        querystring: Type.Object({
          profileId: Type.String({ format: "uuid" }),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.query as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      await expireWatchParties(db, watchPartyHub)

      const hostProfile = db
        .select({ id: profiles.id })
        .from(profiles)
        .innerJoin(householdMembers, eq(householdMembers.householdId, profiles.householdId))
        .where(eq(householdMembers.userId, user.id))
      const hosted = await db
        .select()
        .from(watchParties)
        .where(
          and(inArray(watchParties.hostProfileId, hostProfile), eq(watchParties.status, "active")),
        )
      const memberRows = await db
        .select({ partyId: watchPartyMembers.partyId })
        .from(watchPartyMembers)
        .where(and(eq(watchPartyMembers.userId, user.id), isNull(watchPartyMembers.leftAt)))
      const parties = new Map(hosted.map((party) => [party.id, party]))
      for (const row of memberRows) {
        if (parties.has(row.partyId)) continue
        const [party] = await db
          .select()
          .from(watchParties)
          .where(and(eq(watchParties.id, row.partyId), eq(watchParties.status, "active")))
          .limit(1)
        if (party) parties.set(party.id, party)
      }
      return {
        parties: await Promise.all(
          [...parties.values()].map((party) => partySummary(db, party, profileId, user.id)),
        ),
      }
    },
  )

  app.post(
    "/v1/watch-parties",
    {
      schema: {
        body: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          mode: Type.Union([Type.Literal("private"), Type.Literal("shared")]),
          media: Type.Optional(watchPartyMediaSchema),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const body = request.body as {
        profileId: string
        mode: "private" | "shared"
        media?: WatchPartyMedia
      }
      if (!(await canAccessProfile(db, user.id, body.profileId))) return reply.forbidden()
      await expireWatchParties(db, watchPartyHub)
      const expiresAt = new Date(Date.now() + WATCH_PARTY_TTL_MS)
      let party: typeof watchParties.$inferSelect
      try {
        party = await db.transaction(async (tx) => {
          await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.id, body.profileId))
            .for("update")
          const [existing] = await tx
            .select({ id: watchParties.id })
            .from(watchParties)
            .where(
              and(
                eq(watchParties.hostProfileId, body.profileId),
                eq(watchParties.status, "active"),
              ),
            )
            .limit(1)
          if (existing)
            throw new WatchPartyError("This profile already hosts an active watch party", 409)
          const [created] = await tx
            .insert(watchParties)
            .values({
              hostUserId: user.id,
              hostProfileId: body.profileId,
              mode: body.mode,
              media: body.media,
              expiresAt,
            })
            .returning()
          await tx.insert(watchPartyMembers).values({
            partyId: created!.id,
            userId: user.id,
            profileId: body.profileId,
            role: "host",
          })
          return created!
        })
      } catch (cause: unknown) {
        if (cause instanceof WatchPartyError)
          return reply.code(cause.statusCode).send({ message: cause.message })
        throw cause
      }
      if (party.media) watchPartyHub.seedMedia(party.id, party.media)
      const invite =
        body.mode === "shared"
          ? await createWatchPartyInvite(db, config.webOrigin, party.id, user.id)
          : undefined
      return reply.code(201).send({
        party: await partySummary(db, party, body.profileId, user.id),
        invite,
        ...(await partyTicket(
          watchPartyHub,
          party.id,
          user.id,
          body.profileId,
          user.sessionId,
          "host",
        )),
      })
    },
  )

  app.post(
    "/v1/watch-parties/:partyId/join",
    {
      schema: {
        params: Type.Object({ partyId: Type.String({ format: "uuid" }) }),
        body: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { partyId } = request.params as { partyId: string }
      const { profileId } = request.body as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      await expireWatchParties(db, watchPartyHub)
      let party: typeof watchParties.$inferSelect
      let role: "host" | "guest"
      try {
        const joined = await db.transaction(async (tx) => {
          const [party] = await tx
            .select()
            .from(watchParties)
            .where(eq(watchParties.id, partyId))
            .for("update")
            .limit(1)
          if (!party || party.status !== "active" || party.expiresAt <= new Date())
            throw new WatchPartyError("Watch party not found", 404)
          const [existing] = await tx
            .select()
            .from(watchPartyMembers)
            .where(
              and(
                eq(watchPartyMembers.partyId, partyId),
                eq(watchPartyMembers.profileId, profileId),
              ),
            )
            .limit(1)
          if (existing && existing.userId !== user.id)
            throw new WatchPartyError(
              "This profile is already in the party. Choose another profile.",
              409,
            )
          if (!(await canAccessProfile(db, user.id, party.hostProfileId)) && !existing)
            throw new WatchPartyError("Accept an invitation before joining this party", 403)
          const members = await tx
            .select()
            .from(watchPartyMembers)
            .where(and(eq(watchPartyMembers.partyId, partyId), isNull(watchPartyMembers.leftAt)))
          if (
            members.length >= MAX_WATCH_PARTY_MEMBERS &&
            !members.some((member) => member.profileId === profileId)
          )
            throw new WatchPartyError("This party is full", 409)
          const role =
            party.hostUserId === user.id && party.hostProfileId === profileId
              ? ("host" as const)
              : ("guest" as const)
          await tx
            .insert(watchPartyMembers)
            .values({ partyId, userId: user.id, profileId, role })
            .onConflictDoUpdate({
              target: [watchPartyMembers.partyId, watchPartyMembers.profileId],
              set: { leftAt: null, lastSeenAt: new Date(), role },
            })
          return { party, role }
        })
        party = joined.party
        role = joined.role
      } catch (cause: unknown) {
        if (cause instanceof WatchPartyError)
          return reply.code(cause.statusCode).send({ message: cause.message })
        throw cause
      }
      if (party.media) watchPartyHub.seedMedia(party.id, party.media)
      return {
        party: await partySummary(db, party, profileId, user.id),
        ...(await partyTicket(watchPartyHub, party.id, user.id, profileId, user.sessionId, role)),
      }
    },
  )

  app.post(
    "/v1/watch-parties/invites/:token/accept",
    {
      schema: {
        params: Type.Object({ token: Type.String({ minLength: 32, maxLength: 100 }) }),
        body: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      if (!(await consumeRateLimit(db, `watch-party-invite:${request.ip}`, 20, 60_000))) {
        return reply.tooManyRequests("Too many invitation attempts. Try again later.")
      }
      await expireWatchParties(db, watchPartyHub)
      const { token } = request.params as { token: string }
      const { profileId } = request.body as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const tokenHash = hashWatchPartyToken(token)
      let accepted: typeof watchParties.$inferSelect | undefined
      try {
        accepted = await db.transaction(async (tx) => {
          const [candidate] = await tx
            .select({ invite: watchPartyInvites, party: watchParties })
            .from(watchPartyInvites)
            .innerJoin(watchParties, eq(watchParties.id, watchPartyInvites.partyId))
            .where(eq(watchPartyInvites.tokenHash, tokenHash))
            .for("update")
            .limit(1)
          if (
            !candidate ||
            candidate.invite.revokedAt ||
            candidate.invite.consumedAt ||
            candidate.invite.expiresAt <= new Date() ||
            candidate.party.status !== "active" ||
            candidate.party.expiresAt <= new Date()
          )
            return undefined
          if (candidate.party.hostUserId === user.id)
            throw new WatchPartyError("The host account cannot accept its own invitation", 403)
          const members = await tx
            .select()
            .from(watchPartyMembers)
            .where(
              and(
                eq(watchPartyMembers.partyId, candidate.party.id),
                isNull(watchPartyMembers.leftAt),
              ),
            )
          const existing = await tx
            .select()
            .from(watchPartyMembers)
            .where(
              and(
                eq(watchPartyMembers.partyId, candidate.party.id),
                eq(watchPartyMembers.profileId, profileId),
              ),
            )
            .limit(1)
          if (existing[0] && existing[0].userId !== user.id)
            throw new WatchPartyError("This profile is already in the party", 409)
          if (
            members.length >= MAX_WATCH_PARTY_MEMBERS &&
            !members.some((member) => member.profileId === profileId)
          )
            throw new WatchPartyError("This party is full", 409)
          await tx
            .update(watchPartyInvites)
            .set({ consumedAt: new Date() })
            .where(
              and(
                eq(watchPartyInvites.id, candidate.invite.id),
                isNull(watchPartyInvites.consumedAt),
              ),
            )
          await tx
            .insert(watchPartyMembers)
            .values({
              partyId: candidate.party.id,
              userId: user.id,
              profileId,
              role: "guest",
            })
            .onConflictDoUpdate({
              target: [watchPartyMembers.partyId, watchPartyMembers.profileId],
              set: { leftAt: null, lastSeenAt: new Date() },
            })
          return candidate.party
        })
      } catch (cause: unknown) {
        if (cause instanceof WatchPartyError)
          return reply.code(cause.statusCode).send({ message: cause.message })
        throw cause
      }
      if (!accepted)
        return reply.badRequest("This invitation is expired, revoked, already used, or unavailable")
      if (accepted.media) watchPartyHub.seedMedia(accepted.id, accepted.media)
      return {
        party: await partySummary(db, accepted, profileId, user.id),
        ...(await partyTicket(watchPartyHub, accepted.id, user.id, profileId, user.sessionId)),
      }
    },
  )

  app.post(
    "/v1/watch-parties/:partyId/invites",
    {
      schema: {
        params: Type.Object({ partyId: Type.String({ format: "uuid" }) }),
        body: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { partyId } = request.params as { partyId: string }
      const { profileId } = request.body as { profileId: string }
      await expireWatchParties(db, watchPartyHub)
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const [party] = await db
        .select()
        .from(watchParties)
        .where(eq(watchParties.id, partyId))
        .limit(1)
      if (!party || party.status !== "active" || party.expiresAt <= new Date())
        return reply.notFound("Party not found")
      if (party.hostUserId !== user.id || party.hostProfileId !== profileId)
        return reply.forbidden()
      if (party.mode !== "shared")
        return reply.conflict("Private parties cannot invite another account")
      return { invite: await createWatchPartyInvite(db, config.webOrigin, partyId, user.id) }
    },
  )

  app.post(
    "/v1/watch-parties/:partyId/ticket",
    {
      schema: {
        params: Type.Object({ partyId: Type.String({ format: "uuid" }) }),
        body: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { partyId } = request.params as { partyId: string }
      const { profileId } = request.body as { profileId: string }
      await expireWatchParties(db, watchPartyHub)
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const [member] = await db
        .select({ role: watchPartyMembers.role })
        .from(watchPartyMembers)
        .where(
          and(
            eq(watchPartyMembers.partyId, partyId),
            eq(watchPartyMembers.userId, user.id),
            eq(watchPartyMembers.profileId, profileId),
            isNull(watchPartyMembers.leftAt),
          ),
        )
        .limit(1)
      const [party] = await db
        .select()
        .from(watchParties)
        .where(and(eq(watchParties.id, partyId), eq(watchParties.status, "active")))
        .limit(1)
      if (!member || !party) return reply.forbidden("You are not an active member of this party")
      await db
        .update(watchPartyMembers)
        .set({ leftAt: null, lastSeenAt: new Date() })
        .where(
          and(
            eq(watchPartyMembers.partyId, partyId),
            eq(watchPartyMembers.userId, user.id),
            eq(watchPartyMembers.profileId, profileId),
          ),
        )
      if (party.media) watchPartyHub.seedMedia(party.id, party.media)
      return partyTicket(watchPartyHub, party.id, user.id, profileId, user.sessionId, member.role)
    },
  )

  app.patch(
    "/v1/watch-parties/:partyId/media",
    {
      schema: {
        params: Type.Object({ partyId: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          media: Type.Union([watchPartyMediaSchema, Type.Null()]),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { partyId } = request.params as { partyId: string }
      const { profileId, media } = request.body as {
        profileId: string
        media: WatchPartyMedia | null
      }
      const [party] = await db
        .select()
        .from(watchParties)
        .where(eq(watchParties.id, partyId))
        .limit(1)
      if (!party || party.status !== "active" || party.expiresAt <= new Date())
        return reply.notFound("Party not found")
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      if (party.hostUserId !== user.id || party.hostProfileId !== profileId)
        return reply.forbidden()
      const [updated] = await db
        .update(watchParties)
        .set({ media, updatedAt: new Date() })
        .where(and(eq(watchParties.id, partyId), eq(watchParties.status, "active")))
        .returning()
      watchPartyHub.publishMedia(partyId, media)
      return { party: await partySummary(db, updated ?? { ...party, media }, profileId, user.id) }
    },
  )

  app.post(
    "/v1/watch-parties/:partyId/leave",
    {
      schema: {
        params: Type.Object({ partyId: Type.String({ format: "uuid" }) }),
        body: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { partyId } = request.params as { partyId: string }
      const { profileId } = request.body as { profileId: string }
      await expireWatchParties(db, watchPartyHub)
      const [member] = await db
        .select()
        .from(watchPartyMembers)
        .where(
          and(
            eq(watchPartyMembers.partyId, partyId),
            eq(watchPartyMembers.userId, user.id),
            eq(watchPartyMembers.profileId, profileId),
            isNull(watchPartyMembers.leftAt),
          ),
        )
        .limit(1)
      if (!member) return reply.notFound("Party membership not found")
      if (member.role === "host") return reply.conflict("The host must end the party")
      await db
        .update(watchPartyMembers)
        .set({ leftAt: new Date() })
        .where(
          and(
            eq(watchPartyMembers.partyId, partyId),
            eq(watchPartyMembers.userId, user.id),
            eq(watchPartyMembers.profileId, profileId),
          ),
        )
      watchPartyHub.removeActor(partyId, user.id, profileId)
      return reply.code(204).send()
    },
  )

  app.post(
    "/v1/watch-parties/:partyId/end",
    {
      schema: {
        params: Type.Object({ partyId: Type.String({ format: "uuid" }) }),
        body: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { partyId } = request.params as { partyId: string }
      const { profileId } = request.body as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const [party] = await db
        .select()
        .from(watchParties)
        .where(eq(watchParties.id, partyId))
        .limit(1)
      if (!party) return reply.notFound("Party not found")
      if (party.hostUserId !== user.id || party.hostProfileId !== profileId)
        return reply.forbidden()
      const endedAt = new Date()
      await db.transaction(async (tx) => {
        await tx
          .update(watchParties)
          .set({ status: "ended", endedAt, updatedAt: endedAt })
          .where(and(eq(watchParties.id, partyId), eq(watchParties.status, "active")))
        await tx
          .update(watchPartyInvites)
          .set({ revokedAt: endedAt })
          .where(and(eq(watchPartyInvites.partyId, partyId), isNull(watchPartyInvites.revokedAt)))
      })
      watchPartyHub.removeParty(partyId)
      return reply.code(204).send()
    },
  )
}

class WatchPartyError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
  }
}

async function activePartyMembers(db: Database, partyId: string) {
  return db
    .select()
    .from(watchPartyMembers)
    .where(and(eq(watchPartyMembers.partyId, partyId), isNull(watchPartyMembers.leftAt)))
}

async function partySummary(
  db: Database,
  party: typeof watchParties.$inferSelect,
  viewerProfileId: string,
  viewerUserId: string,
) {
  const members = await activePartyMembers(db, party.id)
  return {
    id: party.id,
    mode: party.mode,
    status: party.status,
    isHost:
      party.hostUserId === viewerUserId &&
      party.hostProfileId === viewerProfileId &&
      members.some((member) => member.profileId === viewerProfileId && member.role === "host"),
    hostProfileId: party.hostProfileId,
    media: party.media ?? undefined,
    memberCount: members.length,
    members: members.map((member) => ({
      profileId: member.profileId,
      role: member.role,
    })),
    createdAt: party.createdAt.toISOString(),
    expiresAt: party.expiresAt.toISOString(),
  }
}

function partyTicket(
  hub: WatchPartyHub,
  partyId: string,
  userId: string,
  profileId: string,
  sessionId: string | undefined,
  role: "host" | "guest" = "guest",
) {
  return {
    ...hub.createTicket({ partyId, userId, profileId, sessionId, role }),
    socketPath: "/v1/watch-parties/socket",
  }
}

async function createWatchPartyInvite(
  db: Database,
  webOrigin: string,
  partyId: string,
  userId: string,
) {
  const now = new Date()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await db
    .update(watchPartyInvites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(watchPartyInvites.partyId, partyId),
        isNull(watchPartyInvites.revokedAt),
        isNull(watchPartyInvites.consumedAt),
      ),
    )
  const token = randomBytes(32).toString("base64url")
  await db.insert(watchPartyInvites).values({
    partyId,
    createdByUserId: userId,
    tokenHash: hashWatchPartyToken(token),
    expiresAt,
  })
  return {
    url: `${webOrigin.replace(/\/$/, "")}/party/${token}`,
    expiresAt: expiresAt.toISOString(),
  }
}

function hashWatchPartyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

async function expireWatchParties(db: Database, hub: WatchPartyHub): Promise<void> {
  const expired = await db
    .update(watchParties)
    .set({ status: "ended", endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(watchParties.status, "active"), lt(watchParties.expiresAt, new Date())))
    .returning({ id: watchParties.id })
  for (const party of expired) hub.removeParty(party.id, "Party expired")
}
