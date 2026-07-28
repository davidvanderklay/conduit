import { Type } from "@sinclair/typebox"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { fromNodeHeaders } from "better-auth/node"
import type { Auth } from "./auth.js"
import type { Config } from "./config.js"
import { decryptSecret, encryptSecret, stableSecretHash } from "./crypto.js"
import type { Database } from "./db/index.js"
import { addonInstallations, householdMembers, households, profiles } from "./db/schema.js"

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
