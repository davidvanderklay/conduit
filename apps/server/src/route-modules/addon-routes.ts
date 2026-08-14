import { Type } from "@sinclair/typebox"
import { and, asc, eq, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { decryptSecret, encryptSecret, stableSecretHash } from "../crypto.js"
import { addonInstallations } from "../db/schema.js"
import { enrichDefaultManifest } from "../default-addons.js"
import type { RouteContext } from "./context.js"
import { canAccessProfile, normalizeManifestUrl, requireUser, resolveAddonProfileId } from "./helpers.js"

export function registerAddonRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, config, db } = context

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

      const effectiveProfileId = await resolveAddonProfileId(db, profileId)
      const addons = await db
        .select()
        .from(addonInstallations)
        .where(eq(addonInstallations.profileId, effectiveProfileId))
        .orderBy(asc(addonInstallations.position), asc(addonInstallations.createdAt))

      return {
        addons: addons.map((addon) => ({
          id: addon.id,
          manifestId: addon.manifestId,
          manifestUrl: decryptSecret(addon.manifestUrlEncrypted, config.addonEncryptionKey),
          manifest: enrichDefaultManifest(addon.manifest),
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
      if ((await resolveAddonProfileId(db, profileId)) !== profileId) {
        return reply.conflict("This profile uses the primary profile's add-ons")
      }
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
          manifestUrlHash: stableSecretHash(url, config.addonEncryptionKey),
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
      if ((await resolveAddonProfileId(db, profileId)) !== profileId) {
        return reply.conflict("This profile uses the primary profile's add-ons")
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
      if ((await resolveAddonProfileId(db, profileId)) !== profileId) {
        return reply.conflict("This profile uses the primary profile's add-ons")
      }

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
}
