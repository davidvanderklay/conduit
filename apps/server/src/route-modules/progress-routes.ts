import { Type } from "@sinclair/typebox"
import { and, asc, desc, eq, notLike, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { watchProgress } from "../db/schema.js"
import type { PlaybackSource } from "../playback-source.js"
import type { RouteContext } from "./context.js"
import { canAccessProfile, requireUser, toProgressItem } from "./helpers.js"

export function registerProgressRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, db } = context

  app.get(
    "/v1/profiles/:profileId/progress",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        querystring: Type.Object({
          view: Type.Optional(
            Type.Union([
              Type.Literal("continue"),
              Type.Literal("history"),
              Type.Literal("status"),
            ]),
          ),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const { view = "history", limit = 50 } = request.query as {
        view?: "continue" | "history" | "status"
        limit?: number
      }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      const staleAfter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      const rows =
        view === "continue"
          ? await db
              .selectDistinctOn([watchProgress.mediaType, watchProgress.mediaId])
              .from(watchProgress)
              .where(
                and(
                  eq(watchProgress.profileId, profileId),
                  notLike(watchProgress.videoId, `${LEGACY_COMPLETION_MARKER_PREFIX}%`),
                  eq(watchProgress.dismissed, false),
                  sql`${watchProgress.updatedAt} >= ${staleAfter}`,
                ),
              )
              .orderBy(
                asc(watchProgress.mediaType),
                asc(watchProgress.mediaId),
                desc(watchProgress.updatedAt),
              )
          : view === "status"
            ? await db
                .select()
                .from(watchProgress)
                .where(eq(watchProgress.profileId, profileId))
                .orderBy(desc(watchProgress.updatedAt))
                .limit(limit)
            : await db
                .select()
                .from(watchProgress)
                .where(
                  and(
                    eq(watchProgress.profileId, profileId),
                    notLike(watchProgress.videoId, `${LEGACY_COMPLETION_MARKER_PREFIX}%`),
                  ),
                )
                .orderBy(desc(watchProgress.updatedAt))
                .limit(limit)
      const visibleRows =
        view === "continue" ? filterContinueWatching(rows, limit) : rows
      return { items: visibleRows.map(toProgressItem) }
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
          dismissed: Type.Optional(Type.Boolean()),
          playbackSource: playbackSourceSchema,
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
        dismissed: body.dismissed ?? false,
        ...(body.playbackSource !== undefined
          ? { playbackSource: body.playbackSource }
          : {}),
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
        body: Type.Object({
          watched: Type.Optional(Type.Boolean()),
          dismissed: Type.Optional(Type.Boolean()),
        }, { minProperties: 1 }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, videoId } = request.params as { profileId: string; videoId: string }
      const { watched, dismissed } = request.body as { watched?: boolean; dismissed?: boolean }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const [item] = await db
        .update(watchProgress)
        .set({
          ...(watched !== undefined ? { watched } : {}),
          ...(watched === true ? { positionMs: sql`${watchProgress.durationMs}` } : {}),
          ...(watched === false ? { positionMs: 0 } : {}),
          ...(dismissed !== undefined ? { dismissed } : {}),
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

const LEGACY_COMPLETION_MARKER_PREFIX = "conduit:completion:"

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
  dismissed?: boolean
  playbackSource?: PlaybackSource
}

const playbackSourceSchema = Type.Optional(
  Type.Object(
    {
      addonId: Type.String({ minLength: 1, maxLength: 200 }),
      sourceKey: Type.String({ minLength: 1, maxLength: 1200 }),
      kind: Type.Union([Type.Literal("url"), Type.Literal("torrent"), Type.Literal("other")]),
      infoHash: Type.Optional(Type.String({ maxLength: 200 })),
      fileIdx: Type.Optional(Type.String({ maxLength: 100 })),
      name: Type.Optional(Type.String({ maxLength: 500 })),
      title: Type.Optional(Type.String({ maxLength: 500 })),
      filename: Type.Optional(Type.String({ maxLength: 500 })),
      bingeGroup: Type.Optional(Type.String({ maxLength: 500 })),
    },
    { additionalProperties: false },
  ),
)

export function isPlaybackComplete(positionMs: number, durationMs: number): boolean {
  if (
    !Number.isFinite(positionMs) ||
    !Number.isFinite(durationMs) ||
    positionMs < 0 ||
    durationMs <= 0
  ) return false
  return (
    positionMs / durationMs >= 0.9 ||
    (durationMs >= 600_000 && durationMs - positionMs <= 120_000)
  )
}

export function filterContinueWatching<
  T extends { mediaType?: string; positionMs: number; watched: boolean; updatedAt: Date },
>(items: T[], limit: number): T[] {
  return items
    .filter((item) =>
      (item.mediaType === "series" && item.watched) ||
      (!item.watched && item.positionMs >= 30_000))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit)
}
