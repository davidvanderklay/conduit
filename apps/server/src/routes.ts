import { Type } from "@sinclair/typebox"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { fromNodeHeaders } from "better-auth/node"
import type { Auth } from "./auth.js"
import type { Config } from "./config.js"
import { decryptSecret, encryptSecret, stableSecretHash } from "./crypto.js"
import type { Database } from "./db/index.js"
import {
  addonInstallations,
  householdMembers,
  households,
  libraryItems,
  profiles,
  watchProgress,
} from "./db/schema.js"

interface RouteContext {
  auth: Auth
  config: Config
  db: Database
}

interface SessionUser {
  id: string
}

export async function registerRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, config, db } = context

  app.get("/health", async () => ({ status: "ok" }))

  app.get("/v1/bootstrap", async (request, reply) => {
    const user = await requireUser(request, reply, auth)
    if (!user) return

    const memberships = await db
      .select({
        householdId: households.id,
        householdName: households.name,
        role: householdMembers.role,
      })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .where(eq(householdMembers.userId, user.id))

    const householdIds = memberships.map((membership) => membership.householdId)
    const profileRows =
      householdIds.length === 0
        ? []
        : await db
            .select()
            .from(profiles)
            .where(inArray(profiles.householdId, householdIds))
            .orderBy(asc(profiles.createdAt))

    return {
      households: memberships.map((membership) => ({
        id: membership.householdId,
        name: membership.householdName,
        role: membership.role,
        profiles: profileRows
          .filter((profile) => profile.householdId === membership.householdId)
          .map((profile) => ({
            id: profile.id,
            name: profile.name,
            isKids: profile.isKids,
          })),
      })),
    }
  })

  app.post(
    "/v1/households",
    {
      schema: {
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 80 }),
          profileName: Type.String({ minLength: 1, maxLength: 80 }),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const body = request.body as { name: string; profileName: string }

      const result = await db.transaction(async (tx) => {
        const [household] = await tx
          .insert(households)
          .values({ name: body.name.trim() })
          .returning()
        await tx.insert(householdMembers).values({
          householdId: household!.id,
          userId: user.id,
          role: "owner",
        })
        const [profile] = await tx
          .insert(profiles)
          .values({
            householdId: household!.id,
            name: body.profileName.trim(),
          })
          .returning()
        return { household: household!, profile: profile! }
      })

      return reply.code(201).send(result)
    },
  )

  app.patch(
    "/v1/profiles/:profileId",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        body: Type.Object(
          {
            name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
            isKids: Type.Optional(Type.Boolean()),
          },
          { minProperties: 1 },
        ),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const body = request.body as { name?: string; isKids?: boolean }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      const [profile] = await db
        .update(profiles)
        .set({
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.isKids !== undefined ? { isKids: body.isKids } : {}),
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, profileId))
        .returning({ id: profiles.id, name: profiles.name, isKids: profiles.isKids })
      return { profile }
    },
  )

  app.get(
    "/v1/profiles/:profileId/addons",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) {
        return reply.forbidden()
      }

      const addons = await db
        .select()
        .from(addonInstallations)
        .where(eq(addonInstallations.profileId, profileId))
        .orderBy(asc(addonInstallations.position), asc(addonInstallations.createdAt))

      return {
        addons: addons.map((addon) => ({
          id: addon.id,
          manifestId: addon.manifestId,
          manifestUrl: decryptSecret(addon.manifestUrlEncrypted, config.addonEncryptionKey),
          manifest: addon.manifest,
          position: addon.position,
          enabled: addon.enabled,
        })),
      }
    },
  )

  app.post(
    "/v1/profiles/:profileId/addons",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          manifestUrl: Type.String({ format: "uri", maxLength: 4096 }),
          manifest: Type.Record(Type.String(), Type.Unknown()),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const body = request.body as {
        manifestUrl: string
        manifest: Record<string, unknown>
      }
      if (!(await canAccessProfile(db, user.id, profileId))) {
        return reply.forbidden()
      }

      const manifestId = typeof body.manifest.id === "string" ? body.manifest.id.trim() : ""
      const manifestName = typeof body.manifest.name === "string" ? body.manifest.name.trim() : ""
      if (!manifestId || !manifestName) {
        return reply.badRequest("manifest must include a non-empty id and name")
      }
      const url = normalizeManifestUrl(body.manifestUrl)
      const [position] = await db
        .select({
          value: sql<number>`coalesce(max(${addonInstallations.position}), -1) + 1`,
        })
        .from(addonInstallations)
        .where(eq(addonInstallations.profileId, profileId))

      const [addon] = await db
        .insert(addonInstallations)
        .values({
          profileId,
          manifestId,
          manifestUrlEncrypted: encryptSecret(url, config.addonEncryptionKey),
          manifestUrlHash: stableSecretHash(url),
          manifest: body.manifest,
          position: Number(position?.value ?? 0),
        })
        .onConflictDoUpdate({
          target: [addonInstallations.profileId, addonInstallations.manifestUrlHash],
          set: {
            manifestId,
            manifest: body.manifest,
            manifestUrlEncrypted: encryptSecret(url, config.addonEncryptionKey),
            enabled: true,
            updatedAt: new Date(),
          },
        })
        .returning()

      return reply.code(201).send({ id: addon!.id })
    },
  )

  app.delete(
    "/v1/profiles/:profileId/addons/:addonId",
    {
      schema: {
        params: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          addonId: Type.String({ format: "uuid" }),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, addonId } = request.params as {
        profileId: string
        addonId: string
      }
      if (!(await canAccessProfile(db, user.id, profileId))) {
        return reply.forbidden()
      }

      await db
        .delete(addonInstallations)
        .where(and(eq(addonInstallations.id, addonId), eq(addonInstallations.profileId, profileId)))
      return reply.code(204).send()
    },
  )

  app.patch(
    "/v1/profiles/:profileId/addons/:addonId",
    {
      schema: {
        params: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          addonId: Type.String({ format: "uuid" }),
        }),
        body: Type.Object(
          {
            enabled: Type.Optional(Type.Boolean()),
            position: Type.Optional(Type.Integer({ minimum: 0 })),
          },
          { minProperties: 1 },
        ),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, addonId } = request.params as { profileId: string; addonId: string }
      const body = request.body as { enabled?: boolean; position?: number }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      await db.transaction(async (tx) => {
        if (body.position !== undefined) {
          const rows = await tx
            .select({ id: addonInstallations.id })
            .from(addonInstallations)
            .where(eq(addonInstallations.profileId, profileId))
            .orderBy(asc(addonInstallations.position), asc(addonInstallations.createdAt))
          const current = rows.findIndex((row) => row.id === addonId)
          if (current >= 0) {
            const [moved] = rows.splice(current, 1)
            rows.splice(Math.min(body.position, rows.length), 0, moved!)
            await Promise.all(
              rows.map((row, position) =>
                tx
                  .update(addonInstallations)
                  .set({ position, updatedAt: new Date() })
                  .where(
                    and(
                      eq(addonInstallations.id, row.id),
                      eq(addonInstallations.profileId, profileId),
                    ),
                  ),
              ),
            )
          }
        }
        if (body.enabled !== undefined) {
          await tx
            .update(addonInstallations)
            .set({ enabled: body.enabled, updatedAt: new Date() })
            .where(
              and(
                eq(addonInstallations.id, addonId),
                eq(addonInstallations.profileId, profileId),
              ),
            )
        }
      })
      return reply.code(204).send()
    },
  )

  app.get(
    "/v1/profiles/:profileId/library",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        querystring: Type.Object({
          type: Type.Optional(Type.Union([Type.Literal("movie"), Type.Literal("series")])),
          sort: Type.Optional(
            Type.Union([
              Type.Literal("added-desc"),
              Type.Literal("added-asc"),
              Type.Literal("title-asc"),
              Type.Literal("title-desc"),
            ]),
          ),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const query = request.query as {
        type?: "movie" | "series"
        sort?: "added-desc" | "added-asc" | "title-asc" | "title-desc"
      }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      const sort = query.sort ?? "added-desc"
      const order =
        sort === "added-asc"
          ? asc(libraryItems.createdAt)
          : sort === "title-asc"
            ? asc(libraryItems.name)
            : sort === "title-desc"
              ? desc(libraryItems.name)
              : desc(libraryItems.createdAt)
      const items = await db
        .select()
        .from(libraryItems)
        .where(
          query.type
            ? and(eq(libraryItems.profileId, profileId), eq(libraryItems.mediaType, query.type))
            : eq(libraryItems.profileId, profileId),
        )
        .orderBy(order)

      return { items: items.map(toLibraryItem) }
    },
  )

  app.put(
    "/v1/profiles/:profileId/library/:mediaType/:mediaId",
    {
      schema: {
        params: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          mediaType: Type.Union([Type.Literal("movie"), Type.Literal("series")]),
          mediaId: Type.String({ minLength: 1, maxLength: 512 }),
        }),
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 500 }),
          poster: Type.Optional(Type.String({ maxLength: 4096 })),
          background: Type.Optional(Type.String({ maxLength: 4096 })),
          description: Type.Optional(Type.String({ maxLength: 20_000 })),
          releaseInfo: Type.Optional(Type.String({ maxLength: 200 })),
          runtime: Type.Optional(Type.String({ maxLength: 200 })),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, mediaType, mediaId } = request.params as {
        profileId: string
        mediaType: "movie" | "series"
        mediaId: string
      }
      const body = request.body as {
        name: string
        poster?: string
        background?: string
        description?: string
        releaseInfo?: string
        runtime?: string
      }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      const values = {
        profileId,
        mediaType,
        mediaId,
        name: body.name.trim(),
        poster: body.poster,
        background: body.background,
        description: body.description,
        releaseInfo: body.releaseInfo,
        runtime: body.runtime,
      }
      const [item] = await db
        .insert(libraryItems)
        .values(values)
        .onConflictDoUpdate({
          target: [libraryItems.profileId, libraryItems.mediaType, libraryItems.mediaId],
          set: { ...values, updatedAt: new Date() },
        })
        .returning()

      return { item: toLibraryItem(item!) }
    },
  )

  app.delete(
    "/v1/profiles/:profileId/library/:mediaType/:mediaId",
    {
      schema: {
        params: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          mediaType: Type.Union([Type.Literal("movie"), Type.Literal("series")]),
          mediaId: Type.String({ minLength: 1, maxLength: 512 }),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, mediaType, mediaId } = request.params as {
        profileId: string
        mediaType: "movie" | "series"
        mediaId: string
      }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      await db
        .delete(libraryItems)
        .where(
          and(
            eq(libraryItems.profileId, profileId),
            eq(libraryItems.mediaType, mediaType),
            eq(libraryItems.mediaId, mediaId),
          ),
        )
      return reply.code(204).send()
    },
  )

  app.get(
    "/v1/profiles/:profileId/progress",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        querystring: Type.Object({
          view: Type.Optional(Type.Union([Type.Literal("continue"), Type.Literal("history")])),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const { view = "history", limit = 50 } = request.query as {
        view?: "continue" | "history"
        limit?: number
      }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      const staleAfter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      const rows = await db
        .select()
        .from(watchProgress)
        .where(
          view === "continue"
            ? and(
                eq(watchProgress.profileId, profileId),
                eq(watchProgress.watched, false),
                sql`${watchProgress.positionMs} >= 30000`,
                sql`${watchProgress.updatedAt} >= ${staleAfter}`,
              )
            : eq(watchProgress.profileId, profileId),
        )
        .orderBy(desc(watchProgress.updatedAt))
        .limit(limit)
      return { items: rows.map(toProgressItem) }
    },
  )

  app.get(
    "/v1/profiles/:profileId/progress/:videoId",
    {
      schema: {
        params: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          videoId: Type.String({ minLength: 1, maxLength: 512 }),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, videoId } = request.params as { profileId: string; videoId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const [item] = await db
        .select()
        .from(watchProgress)
        .where(and(eq(watchProgress.profileId, profileId), eq(watchProgress.videoId, videoId)))
        .limit(1)
      return { item: item ? toProgressItem(item) : null }
    },
  )

  app.put(
    "/v1/profiles/:profileId/progress/:videoId",
    {
      schema: {
        params: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          videoId: Type.String({ minLength: 1, maxLength: 512 }),
        }),
        body: Type.Object({
          mediaType: Type.String({ minLength: 1, maxLength: 50 }),
          mediaId: Type.String({ minLength: 1, maxLength: 512 }),
          name: Type.String({ minLength: 1, maxLength: 500 }),
          poster: Type.Optional(Type.String({ maxLength: 4096 })),
          videoTitle: Type.Optional(Type.String({ maxLength: 500 })),
          season: Type.Optional(Type.Integer({ minimum: 0 })),
          episode: Type.Optional(Type.Integer({ minimum: 0 })),
          positionMs: Type.Integer({ minimum: 0 }),
          durationMs: Type.Integer({ minimum: 0 }),
          watched: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, videoId } = request.params as { profileId: string; videoId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const body = request.body as ProgressBody
      const watched = body.watched ?? isPlaybackComplete(body.positionMs, body.durationMs)
      const values = {
        profileId,
        videoId,
        mediaType: body.mediaType,
        mediaId: body.mediaId,
        name: body.name.trim(),
        poster: body.poster,
        videoTitle: body.videoTitle,
        season: body.season,
        episode: body.episode,
        positionMs: watched ? body.durationMs || body.positionMs : body.positionMs,
        durationMs: body.durationMs,
        watched,
        updatedAt: new Date(),
      }
      const [item] = await db
        .insert(watchProgress)
        .values(values)
        .onConflictDoUpdate({
          target: [watchProgress.profileId, watchProgress.videoId],
          set: values,
        })
        .returning()
      return { item: toProgressItem(item!) }
    },
  )

  app.patch(
    "/v1/profiles/:profileId/progress/:videoId",
    {
      schema: {
        params: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          videoId: Type.String({ minLength: 1, maxLength: 512 }),
        }),
        body: Type.Object({ watched: Type.Boolean() }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, videoId } = request.params as { profileId: string; videoId: string }
      const { watched } = request.body as { watched: boolean }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const [item] = await db
        .update(watchProgress)
        .set({
          watched,
          ...(watched ? { positionMs: sql`${watchProgress.durationMs}` } : { positionMs: 0 }),
          updatedAt: new Date(),
        })
        .where(and(eq(watchProgress.profileId, profileId), eq(watchProgress.videoId, videoId)))
        .returning()
      if (!item) return reply.notFound()
      return { item: toProgressItem(item) }
    },
  )

  app.delete(
    "/v1/profiles/:profileId/progress/:videoId",
    {
      schema: {
        params: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          videoId: Type.String({ minLength: 1, maxLength: 512 }),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, videoId } = request.params as { profileId: string; videoId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      await db
        .delete(watchProgress)
        .where(and(eq(watchProgress.profileId, profileId), eq(watchProgress.videoId, videoId)))
      return reply.code(204).send()
    },
  )
}

interface ProgressBody {
  mediaType: string
  mediaId: string
  name: string
  poster?: string
  videoTitle?: string
  season?: number
  episode?: number
  positionMs: number
  durationMs: number
  watched?: boolean
}

export function isPlaybackComplete(positionMs: number, durationMs: number): boolean {
  if (durationMs <= 0) return false
  return (
    positionMs / durationMs >= 0.9 ||
    (durationMs >= 600_000 && durationMs - positionMs <= 120_000)
  )
}

function toProgressItem(item: typeof watchProgress.$inferSelect) {
  return {
    videoId: item.videoId,
    mediaType: item.mediaType,
    mediaId: item.mediaId,
    name: item.name,
    poster: item.poster ?? undefined,
    videoTitle: item.videoTitle ?? undefined,
    season: item.season ?? undefined,
    episode: item.episode ?? undefined,
    positionMs: item.positionMs,
    durationMs: item.durationMs,
    watched: item.watched,
    updatedAt: item.updatedAt.toISOString(),
  }
}

function toLibraryItem(item: typeof libraryItems.$inferSelect) {
  return {
    id: item.mediaId,
    type: item.mediaType,
    name: item.name,
    poster: item.poster ?? undefined,
    background: item.background ?? undefined,
    description: item.description ?? undefined,
    releaseInfo: item.releaseInfo ?? undefined,
    runtime: item.runtime ?? undefined,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: Auth,
): Promise<SessionUser | undefined> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  })
  if (!session?.user) {
    reply.unauthorized()
    return
  }
  return { id: session.user.id }
}

async function canAccessProfile(db: Database, userId: string, profileId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .innerJoin(householdMembers, eq(householdMembers.householdId, profiles.householdId))
    .where(and(eq(profiles.id, profileId), eq(householdMembers.userId, userId)))
    .limit(1)
  return Boolean(row)
}

function normalizeManifestUrl(value: string): string {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("manifest URL must use HTTP or HTTPS")
  }
  url.hash = ""
  return url.toString()
}
