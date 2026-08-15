import { Type } from "@sinclair/typebox"
import { and, asc, eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { decryptSecret, encryptSecret, stableSecretHash } from "../crypto.js"
import { defaultAddonInstallations } from "../default-addons.js"
import {
  addonInstallations,
  householdMembers,
  households,
  libraryItems,
  profiles,
  watchProgress,
} from "../db/schema.js"
import {
  MAX_IMPORT_BYTES,
  PORTABLE_DATA_FORMAT,
  PORTABLE_DATA_VERSION,
  previewPortableData,
  validatePortableData,
  type PortableProfileData,
} from "../portable-data.js"
import type { RouteContext } from "./context.js"
import { canAccessProfile, normalizeManifestUrl, requireUser, toProgressItem } from "./helpers.js"
import { CONTINUE_WATCHING_ENTRY_POSITION_MS } from "./progress-routes.js"

export function registerProfileRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, config, db } = context

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
        await tx
          .insert(addonInstallations)
          .values(defaultAddonInstallations(profile!.id, config.addonEncryptionKey))
        return { household: household!, profile: profile! }
      })

      return reply.code(201).send(result)
    },
  )

  app.post(
    "/v1/households/:householdId/profiles",
    {
      schema: {
        params: Type.Object({ householdId: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 80, pattern: "\\S" }),
          isKids: Type.Optional(Type.Boolean()),
          usesPrimaryAddons: Type.Optional(Type.Boolean()),
          avatarColor: Type.Optional(Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" })),
          avatarUrl: Type.Optional(Type.String({ maxLength: 2048, pattern: "^https?://" })),
          copyAddonsFromProfileId: Type.Optional(Type.String({ format: "uuid" })),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { householdId } = request.params as { householdId: string }
      const body = request.body as {
        name: string
        isKids?: boolean
        usesPrimaryAddons?: boolean
        avatarColor?: string
        avatarUrl?: string
        copyAddonsFromProfileId?: string
      }

      const [membership] = await db
        .select({ householdId: householdMembers.householdId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.userId, user.id),
          ),
        )
        .limit(1)
      if (!membership) return reply.forbidden()

      let sourceAddons: Array<typeof addonInstallations.$inferSelect> = []
      if (body.copyAddonsFromProfileId) {
        const [sourceProfile] = await db
          .select({ householdId: profiles.householdId })
          .from(profiles)
          .where(eq(profiles.id, body.copyAddonsFromProfileId))
          .limit(1)
        if (!sourceProfile || sourceProfile.householdId !== householdId) {
          return reply.forbidden()
        }
        sourceAddons = await db
          .select()
          .from(addonInstallations)
          .where(eq(addonInstallations.profileId, body.copyAddonsFromProfileId))
          .orderBy(asc(addonInstallations.position))
      }

      const profile = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(profiles)
          .values({
            householdId,
            name: body.name.trim(),
            isKids: body.isKids ?? false,
            usesPrimaryAddons: body.usesPrimaryAddons ?? false,
            avatarColor: body.avatarColor,
            avatarUrl: body.avatarUrl,
          })
          .returning({ id: profiles.id, name: profiles.name, isKids: profiles.isKids, usesPrimaryAddons: profiles.usesPrimaryAddons, avatarColor: profiles.avatarColor, avatarUrl: profiles.avatarUrl })

        if (body.usesPrimaryAddons) {
          return created!
        } else if (body.copyAddonsFromProfileId) {
          if (sourceAddons.length === 0) return created!
          await tx.insert(addonInstallations).values(
            sourceAddons.map((addon) => ({
              profileId: created!.id,
              manifestId: addon.manifestId,
              manifestUrlEncrypted: addon.manifestUrlEncrypted,
              manifestUrlHash: addon.manifestUrlHash,
              manifest: addon.manifest,
              position: addon.position,
              enabled: addon.enabled,
            })),
          )
        } else {
          await tx
            .insert(addonInstallations)
            .values(defaultAddonInstallations(created!.id, config.addonEncryptionKey))
        }
        return created!
      })

      return reply.code(201).send({ profile })
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
            usesPrimaryAddons: Type.Optional(Type.Boolean()),
            avatarColor: Type.Optional(Type.Union([Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" }), Type.Null()])),
            avatarUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048, pattern: "^https?://" }), Type.Null()])),
          },
          { minProperties: 1 },
        ),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const body = request.body as { name?: string; isKids?: boolean; usesPrimaryAddons?: boolean; avatarColor?: string | null; avatarUrl?: string | null }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      const [profile] = await db
        .update(profiles)
        .set({
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.isKids !== undefined ? { isKids: body.isKids } : {}),
          ...(body.usesPrimaryAddons !== undefined ? { usesPrimaryAddons: body.usesPrimaryAddons } : {}),
          ...(body.avatarColor !== undefined ? { avatarColor: body.avatarColor } : {}),
          ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, profileId))
        .returning({ id: profiles.id, name: profiles.name, isKids: profiles.isKids, usesPrimaryAddons: profiles.usesPrimaryAddons, avatarColor: profiles.avatarColor, avatarUrl: profiles.avatarUrl })
      return { profile }
    },
  )

  app.get(
    "/v1/profiles/:profileId/export",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        querystring: Type.Object({
          includeSecrets: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const { includeSecrets = false } = request.query as { includeSecrets?: boolean }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1)
      if (!profile) return reply.notFound()
      const [library, progress, addons] = await Promise.all([
        db.select().from(libraryItems).where(eq(libraryItems.profileId, profileId)),
        db.select().from(watchProgress).where(eq(watchProgress.profileId, profileId)),
        db
          .select()
          .from(addonInstallations)
          .where(eq(addonInstallations.profileId, profileId))
          .orderBy(asc(addonInstallations.position), asc(addonInstallations.createdAt)),
      ])
      const archive: PortableProfileData = {
        format: PORTABLE_DATA_FORMAT,
        version: PORTABLE_DATA_VERSION,
        exportedAt: new Date().toISOString(),
        profile: { name: profile.name, isKids: profile.isKids },
        library: library.map((item) => ({
          mediaType: item.mediaType as "movie" | "series",
          mediaId: item.mediaId,
          name: item.name,
          ...(item.poster ? { poster: item.poster } : {}),
          ...(item.background ? { background: item.background } : {}),
          ...(item.description ? { description: item.description } : {}),
          ...(item.releaseInfo ? { releaseInfo: item.releaseInfo } : {}),
          ...(item.runtime ? { runtime: item.runtime } : {}),
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        progress: progress.map((item) => toProgressItem(item)),
        addons: addons.map((addon) => ({
          manifestId: addon.manifestId,
          ...(includeSecrets
            ? { manifestUrl: decryptSecret(addon.manifestUrlEncrypted, config.addonEncryptionKey) }
            : {}),
          manifest: addon.manifest,
          position: addon.position,
          enabled: addon.enabled,
        })),
      }
      reply.header("content-disposition", `attachment; filename="conduit-${profileId}.json"`)
      reply.header("cache-control", "no-store")
      return archive
    },
  )

  app.post(
    "/v1/profiles/:profileId/import/preview",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        body: Type.Unknown(),
      },
      bodyLimit: MAX_IMPORT_BYTES,
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      try {
        return previewPortableData(validatePortableData(request.body))
      } catch (error) {
        return reply.badRequest(error instanceof Error ? error.message : "invalid import")
      }
    },
  )

  app.post(
    "/v1/profiles/:profileId/import",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          mode: Type.Union([Type.Literal("merge"), Type.Literal("replace")]),
          data: Type.Unknown(),
        }),
      },
      bodyLimit: MAX_IMPORT_BYTES + 1024,
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const body = request.body as { mode: "merge" | "replace"; data: unknown }
      let data: PortableProfileData
      try {
        data = validatePortableData(body.data)
      } catch (error) {
        return reply.badRequest(error instanceof Error ? error.message : "invalid import")
      }

      await db.transaction(async (tx) => {
        if (body.mode === "replace") {
          await tx.delete(addonInstallations).where(eq(addonInstallations.profileId, profileId))
          await tx.delete(watchProgress).where(eq(watchProgress.profileId, profileId))
          await tx.delete(libraryItems).where(eq(libraryItems.profileId, profileId))
        }
        await tx
          .update(profiles)
          .set({ name: data.profile.name.trim(), isKids: data.profile.isKids, updatedAt: new Date() })
          .where(eq(profiles.id, profileId))
        for (const item of data.library) {
          const values = {
            profileId,
            mediaType: item.mediaType,
            mediaId: item.mediaId,
            name: item.name.trim(),
            poster: item.poster,
            background: item.background,
            description: item.description,
            releaseInfo: item.releaseInfo,
            runtime: item.runtime,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          }
          await tx
            .insert(libraryItems)
            .values(values)
            .onConflictDoUpdate({
              target: [libraryItems.profileId, libraryItems.mediaType, libraryItems.mediaId],
              set: values,
            })
        }
        for (const item of data.progress) {
          const values = {
            profileId,
            videoId: item.videoId,
            mediaType: item.mediaType,
            mediaId: item.mediaId,
            name: item.name.trim(),
            poster: item.poster,
            videoTitle: item.videoTitle,
            season: item.season,
            episode: item.episode,
            positionMs: item.positionMs,
            durationMs: item.durationMs,
            watched: item.watched,
            dismissed: item.dismissed ?? false,
            continueWatching: item.continueWatching ?? (
              item.watched || item.positionMs >= CONTINUE_WATCHING_ENTRY_POSITION_MS
            ),
            playbackSource: item.playbackSource,
            updatedAt: new Date(item.updatedAt),
          }
          await tx
            .insert(watchProgress)
            .values(values)
            .onConflictDoUpdate({
              target: [watchProgress.profileId, watchProgress.videoId],
              set: values,
            })
        }
        for (const addon of data.addons) {
          if (!addon.manifestUrl) continue
          const url = normalizeManifestUrl(addon.manifestUrl)
          const values = {
            profileId,
            manifestId: addon.manifestId,
            manifestUrlEncrypted: encryptSecret(url, config.addonEncryptionKey),
            manifestUrlHash: stableSecretHash(url, config.addonEncryptionKey),
            manifest: addon.manifest,
            position: addon.position,
            enabled: addon.enabled,
            updatedAt: new Date(),
          }
          await tx
            .insert(addonInstallations)
            .values(values)
            .onConflictDoUpdate({
              target: [addonInstallations.profileId, addonInstallations.manifestUrlHash],
              set: values,
            })
        }
      })
      return { imported: previewPortableData(data), mode: body.mode }
    },
  )
}
