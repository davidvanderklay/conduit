import { Type } from "@sinclair/typebox"
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import {
  progressAppliedOperations,
  progressCanonicalTitles,
  progressEvents,
  progressSyncState,
  progressTitleAliases,
  progressTitleDismissals,
  watchProgress,
} from "../db/schema.js"
import type { PlaybackSource } from "../playback-source.js"
import type { RouteContext } from "./context.js"
import { canAccessProfile, requireUser, toProgressItem } from "./helpers.js"

const identitySchema = Type.Object({
  canonicalTitleId: Type.Optional(Type.String({ format: "uuid" })),
  mediaType: Type.String({ minLength: 1, maxLength: 50 }),
  mediaId: Type.String({ minLength: 1, maxLength: 512 }),
  aliases: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 32 }),
  ),
  videoId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  season: Type.Optional(Type.Integer({ minimum: 0 })),
  episode: Type.Optional(Type.Integer({ minimum: 0 })),
})

const playbackSourceSchema = Type.Optional(
  Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
)

const operationSchema = Type.Union([
  Type.Object({
    type: Type.Literal("upsert"),
    identity: Type.Intersect([
      identitySchema,
      Type.Object({ videoId: Type.String({ minLength: 1, maxLength: 512 }) }),
    ]),
    name: Type.String({ minLength: 1, maxLength: 500 }),
    poster: Type.Optional(Type.String({ maxLength: 4096 })),
    videoTitle: Type.Optional(Type.String({ maxLength: 500 })),
    positionMs: Type.Integer({ minimum: 0 }),
    durationMs: Type.Integer({ minimum: 0 }),
    watched: Type.Boolean(),
    playbackSource: playbackSourceSchema,
    checkpointSessionId: Type.String({ minLength: 1, maxLength: 200 }),
    checkpointSequence: Type.Integer({ minimum: 1 }),
  }),
  Type.Object({
    type: Type.Union([Type.Literal("dismissTitle"), Type.Literal("restoreTitle")]),
    identity: identitySchema,
  }),
  Type.Object({ type: Type.Literal("deleteEpisode"), identity: identitySchema }),
  Type.Object({ type: Type.Literal("deleteTitle"), identity: identitySchema }),
])

interface ProgressIdentity {
  canonicalTitleId?: string
  mediaType: string
  mediaId: string
  aliases?: string[]
  videoId?: string
  season?: number
  episode?: number
}

type ProgressOperation =
  | {
      type: "upsert"
      identity: ProgressIdentity & { videoId: string }
      name: string
      poster?: string
      videoTitle?: string
      positionMs: number
      durationMs: number
      watched: boolean
      playbackSource?: PlaybackSource | null
      checkpointSessionId: string
      checkpointSequence: number
    }
  | {
      type: "dismissTitle" | "restoreTitle" | "deleteEpisode" | "deleteTitle"
      identity: ProgressIdentity
    }

class AliasConflict extends Error {}

export function registerProgressSyncRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, db } = context

  app.post(
    "/v1/profiles/:profileId/progress/operations",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          operationId: Type.String({ format: "uuid" }),
          operation: operationSchema,
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const { operationId, operation } = request.body as {
        operationId: string
        operation: ProgressOperation
      }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      try {
        return await db.transaction(async (tx) => {
          await tx.insert(progressSyncState).values({ profileId }).onConflictDoNothing()
          await tx
            .select()
            .from(progressSyncState)
            .where(eq(progressSyncState.profileId, profileId))
            .for("update")

          const [duplicate] = await tx
            .select({ result: progressAppliedOperations.result })
            .from(progressAppliedOperations)
            .where(
              and(
                eq(progressAppliedOperations.profileId, profileId),
                eq(progressAppliedOperations.operationId, operationId),
              ),
            )
            .limit(1)
          if (duplicate) return duplicate.result

          const [state] = await tx
            .select()
            .from(progressSyncState)
            .where(eq(progressSyncState.profileId, profileId))
            .limit(1)
          if (!state) throw new Error("Progress sync state was not created")
          const canonicalTitleId = await resolveCanonicalTitle(tx, profileId, operation.identity)
          const episodeKey = canonicalEpisodeKey(operation.identity)

          if (operation.type === "upsert") {
            const [existing] = await tx
              .select()
              .from(watchProgress)
              .where(
                and(
                  eq(watchProgress.profileId, profileId),
                  eq(watchProgress.canonicalTitleId, canonicalTitleId),
                  eq(watchProgress.canonicalEpisodeKey, episodeKey),
                ),
              )
              .limit(1)
            if (
              existing?.checkpointSessionId === operation.checkpointSessionId &&
              existing.checkpointSequence !== null &&
              operation.checkpointSequence <= existing.checkpointSequence
            ) {
              const result = {
                accepted: false,
                reason: "staleCheckpoint",
                generation: state.generation,
                revision: state.revision,
              }
              await tx
                .insert(progressAppliedOperations)
                .values({
                  profileId,
                  operationId,
                  revision: state.revision,
                  generation: state.generation,
                  result,
                })
              return result
            }
          }

          const revision = state.revision + 1
          await tx
            .update(progressSyncState)
            .set({ revision })
            .where(eq(progressSyncState.profileId, profileId))
          const payload = await applyOperation(
            tx,
            profileId,
            canonicalTitleId,
            episodeKey,
            revision,
            operation,
          )
          const result = {
            accepted: true,
            generation: state.generation,
            revision,
            event: { revision, type: operation.type, payload },
          }
          await tx
            .insert(progressEvents)
            .values({
              profileId,
              revision,
              generation: state.generation,
              operationId,
              type: operation.type,
              payload,
            })
          await tx
            .insert(progressAppliedOperations)
            .values({ profileId, operationId, revision, generation: state.generation, result })
          return result
        })
      } catch (error) {
        if (error instanceof AliasConflict) return reply.conflict(error.message)
        throw error
      }
    },
  )

  app.get(
    "/v1/profiles/:profileId/progress/snapshot",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        querystring: Type.Object({
          boundary: Type.Optional(Type.Integer({ minimum: 0 })),
          generation: Type.Optional(Type.Integer({ minimum: 1 })),
          afterVideoId: Type.Optional(Type.String({ maxLength: 512 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const query = request.query as {
        boundary?: number
        generation?: number
        afterVideoId?: string
        limit?: number
      }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const [state] = await db
        .select()
        .from(progressSyncState)
        .where(eq(progressSyncState.profileId, profileId))
        .limit(1)
      const current = state ?? { profileId, revision: 0, generation: 1 }
      if (query.generation !== undefined && query.generation !== current.generation)
        return reply.code(409).send({ error: "generationChanged", generation: current.generation })
      if (query.boundary !== undefined && query.boundary > current.revision)
        return reply.badRequest("Invalid snapshot boundary")
      const boundary = query.boundary ?? current.revision
      const limit = query.limit ?? 200
      const rows = await db
        .select()
        .from(watchProgress)
        .where(
          and(
            eq(watchProgress.profileId, profileId),
            lte(watchProgress.revision, boundary),
            query.afterVideoId ? gt(watchProgress.videoId, query.afterVideoId) : undefined,
          ),
        )
        .orderBy(asc(watchProgress.videoId))
        .limit(limit + 1)
      const items = rows.slice(0, limit)
      return {
        generation: current.generation,
        boundary,
        items: items.map(syncProgressItem),
        nextAfterVideoId: rows.length > limit ? items.at(-1)?.videoId : null,
      }
    },
  )

  app.get(
    "/v1/profiles/:profileId/progress/changes",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        querystring: Type.Object({
          after: Type.Integer({ minimum: 0 }),
          generation: Type.Integer({ minimum: 1 }),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const {
        after,
        generation,
        limit = 200,
      } = request.query as { after: number; generation: number; limit?: number }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const [state] = await db
        .select()
        .from(progressSyncState)
        .where(eq(progressSyncState.profileId, profileId))
        .limit(1)
      const current = state ?? { revision: 0, generation: 1 }
      if (generation !== current.generation)
        return reply.code(409).send({ error: "generationChanged", generation: current.generation })
      const rows = await db
        .select()
        .from(progressEvents)
        .where(
          and(
            eq(progressEvents.profileId, profileId),
            eq(progressEvents.generation, generation),
            gt(progressEvents.revision, after),
          ),
        )
        .orderBy(asc(progressEvents.revision))
        .limit(limit + 1)
      const events = rows
        .slice(0, limit)
        .map(({ operationId: _operationId, profileId: _profileId, ...event }) => event)
      return {
        generation,
        events,
        nextCursor: events.at(-1)?.revision ?? after,
        hasMore: rows.length > limit,
      }
    },
  )
}

type ProgressTransaction = Parameters<Parameters<RouteContext["db"]["transaction"]>[0]>[0]

async function resolveCanonicalTitle(
  tx: ProgressTransaction,
  profileId: string,
  identity: ProgressIdentity,
): Promise<string> {
  const aliases = [...new Set([identity.mediaId, ...(identity.aliases ?? [])])]
  if (identity.canonicalTitleId) {
    const [canonical] = await tx
      .select({ id: progressCanonicalTitles.id })
      .from(progressCanonicalTitles)
      .where(
        and(
          eq(progressCanonicalTitles.id, identity.canonicalTitleId),
          eq(progressCanonicalTitles.profileId, profileId),
          eq(progressCanonicalTitles.mediaType, identity.mediaType),
        ),
      )
      .limit(1)
    if (!canonical) throw new AliasConflict("Canonical title does not belong to this profile")
    await tx
      .insert(progressTitleAliases)
      .values(
        aliases.map((alias) => ({
          profileId,
          mediaType: identity.mediaType,
          alias,
          canonicalTitleId: canonical.id,
        })),
      )
      .onConflictDoNothing()
    const conflicts = await tx
      .select({ canonicalTitleId: progressTitleAliases.canonicalTitleId })
      .from(progressTitleAliases)
      .where(
        and(
          eq(progressTitleAliases.profileId, profileId),
          eq(progressTitleAliases.mediaType, identity.mediaType),
          inArray(progressTitleAliases.alias, aliases),
        ),
      )
    if (conflicts.some((match) => match.canonicalTitleId !== canonical.id))
      throw new AliasConflict("An alias already belongs to another canonical title")
    return canonical.id
  }
  const matches = await tx
    .select({ canonicalTitleId: progressTitleAliases.canonicalTitleId })
    .from(progressTitleAliases)
    .where(
      and(
        eq(progressTitleAliases.profileId, profileId),
        eq(progressTitleAliases.mediaType, identity.mediaType),
        inArray(progressTitleAliases.alias, aliases),
      ),
    )
  const canonicalIds = [...new Set(matches.map((match) => match.canonicalTitleId))]
  if (canonicalIds.length > 1)
    throw new AliasConflict("Aliases resolve to conflicting canonical titles")
  let canonicalTitleId = canonicalIds[0]
  if (!canonicalTitleId) {
    const [created] = await tx
      .insert(progressCanonicalTitles)
      .values({ profileId, mediaType: identity.mediaType })
      .returning({ id: progressCanonicalTitles.id })
    if (!created) throw new Error("Canonical title was not created")
    canonicalTitleId = created.id
  }
  await tx
    .insert(progressTitleAliases)
    .values(
      aliases.map((alias) => ({
        profileId,
        mediaType: identity.mediaType,
        alias,
        canonicalTitleId,
      })),
    )
    .onConflictDoNothing()
  const conflicts = await tx
    .select({ canonicalTitleId: progressTitleAliases.canonicalTitleId })
    .from(progressTitleAliases)
    .where(
      and(
        eq(progressTitleAliases.profileId, profileId),
        eq(progressTitleAliases.mediaType, identity.mediaType),
        inArray(progressTitleAliases.alias, aliases),
      ),
    )
  if (conflicts.some((match) => match.canonicalTitleId !== canonicalTitleId))
    throw new AliasConflict("An alias already belongs to another canonical title")
  return canonicalTitleId
}

function canonicalEpisodeKey(identity: ProgressIdentity): string {
  return identity.season === undefined && identity.episode === undefined
    ? "movie"
    : `s${identity.season ?? 0}:e${identity.episode ?? 0}`
}

async function applyOperation(
  tx: ProgressTransaction,
  profileId: string,
  canonicalTitleId: string,
  episodeKey: string,
  revision: number,
  operation: ProgressOperation,
): Promise<Record<string, unknown>> {
  const identity = {
    canonicalTitleId,
    canonicalEpisodeKey: episodeKey,
    mediaType: operation.identity.mediaType,
    mediaId: operation.identity.mediaId,
    season: operation.identity.season,
    episode: operation.identity.episode,
  }
  if (operation.type === "upsert") {
    const [canonicalExisting] = await tx
      .select()
      .from(watchProgress)
      .where(
        and(
          eq(watchProgress.profileId, profileId),
          eq(watchProgress.canonicalTitleId, canonicalTitleId),
          eq(watchProgress.canonicalEpisodeKey, episodeKey),
        ),
      )
      .limit(1)
    const [legacyExisting] = canonicalExisting
      ? []
      : await tx
          .select()
          .from(watchProgress)
          .where(
            and(
              eq(watchProgress.profileId, profileId),
              eq(watchProgress.videoId, operation.identity.videoId),
            ),
          )
          .limit(1)
    const existing = canonicalExisting ?? legacyExisting
    await tx
      .insert(progressTitleDismissals)
      .values({ profileId, canonicalTitleId, dismissed: false, revision, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [progressTitleDismissals.profileId, progressTitleDismissals.canonicalTitleId],
        set: { dismissed: false, revision, updatedAt: new Date() },
      })
    const values = {
      profileId,
      videoId: operation.identity.videoId,
      ...identity,
      revision,
      name: operation.name.trim(),
      poster: operation.poster,
      videoTitle: operation.videoTitle,
      positionMs: operation.watched
        ? operation.durationMs || operation.positionMs
        : operation.positionMs,
      durationMs: operation.durationMs,
      watched: operation.watched,
      dismissed: false,
      continueWatching: true,
      playbackSource: operation.playbackSource,
      checkpointSessionId: operation.checkpointSessionId,
      checkpointSequence: operation.checkpointSequence,
      checkpointUpdatedAt: new Date(),
      updatedAt: new Date(),
    }
    const [row] = existing
      ? await tx
          .update(watchProgress)
          .set(values)
          .where(
            and(
              eq(watchProgress.profileId, profileId),
              eq(watchProgress.videoId, existing.videoId),
            ),
          )
          .returning()
      : await tx.insert(watchProgress).values(values).returning()
    if (!row) throw new Error("Progress row was not persisted")
    return { kind: "upsert", item: syncProgressItem(row) }
  }
  if (operation.type === "dismissTitle" || operation.type === "restoreTitle") {
    const dismissed = operation.type === "dismissTitle"
    await tx
      .insert(progressTitleDismissals)
      .values({ profileId, canonicalTitleId, dismissed, revision, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [progressTitleDismissals.profileId, progressTitleDismissals.canonicalTitleId],
        set: { dismissed, revision, updatedAt: new Date() },
      })
    await tx
      .update(watchProgress)
      .set({ dismissed, revision, updatedAt: new Date() })
      .where(
        and(
          eq(watchProgress.profileId, profileId),
          eq(watchProgress.canonicalTitleId, canonicalTitleId),
        ),
      )
    return {
      kind: operation.type,
      canonicalTitleId,
      mediaType: operation.identity.mediaType,
      aliases: [operation.identity.mediaId, ...(operation.identity.aliases ?? [])],
    }
  }
  if (operation.type === "deleteEpisode") {
    await tx
      .delete(watchProgress)
      .where(
        and(
          eq(watchProgress.profileId, profileId),
          eq(watchProgress.canonicalTitleId, canonicalTitleId),
          eq(watchProgress.canonicalEpisodeKey, episodeKey),
        ),
      )
    return { kind: "deleteEpisode", ...identity }
  }
  await tx
    .delete(watchProgress)
    .where(
      and(
        eq(watchProgress.profileId, profileId),
        eq(watchProgress.canonicalTitleId, canonicalTitleId),
      ),
    )
  return { kind: "deleteTitle", canonicalTitleId, mediaType: operation.identity.mediaType }
}

function syncProgressItem(row: typeof watchProgress.$inferSelect) {
  return {
    ...toProgressItem(row),
    canonicalTitleId: row.canonicalTitleId,
    canonicalEpisodeKey: row.canonicalEpisodeKey,
    revision: row.revision,
  }
}
