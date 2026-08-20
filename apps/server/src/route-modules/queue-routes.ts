import { Type } from "@sinclair/typebox"
import { asc, eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { playbackQueueItems } from "../db/schema.js"
import type { RouteContext } from "./context.js"
import { canAccessProfile, requireUser } from "./helpers.js"

const queueItemSchema = Type.Object({
  mediaType: Type.Union([Type.Literal("movie"), Type.Literal("series")]),
  mediaId: Type.String({ minLength: 1, maxLength: 512 }),
  videoId: Type.String({ minLength: 1, maxLength: 512 }),
  name: Type.String({ minLength: 1, maxLength: 500 }),
  poster: Type.Optional(Type.String({ maxLength: 4096 })),
  artwork: Type.Optional(Type.String({ maxLength: 4096 })),
  videoTitle: Type.Optional(Type.String({ maxLength: 500 })),
  season: Type.Optional(Type.Integer({ minimum: 0 })),
  episode: Type.Optional(Type.Integer({ minimum: 0 })),
})

export type QueueInput = {
  mediaType: "movie" | "series"
  mediaId: string
  videoId: string
  name: string
  poster?: string
  artwork?: string
  videoTitle?: string
  season?: number
  episode?: number
}

export function normalizeQueueItems(items: QueueInput[]): QueueInput[] {
  const unique = new Map<string, QueueInput>()
  for (const item of items) {
    const key = `${item.mediaType}\u0000${item.mediaId}\u0000${item.videoId}`
    if (!unique.has(key)) unique.set(key, { ...item, name: item.name.trim() })
  }
  return [...unique.values()]
}

export function registerQueueRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, db } = context

  app.get(
    "/v1/profiles/:profileId/queue",
    { schema: { params: Type.Object({ profileId: Type.String({ format: "uuid" }) }) } },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const items = await db
        .select()
        .from(playbackQueueItems)
        .where(eq(playbackQueueItems.profileId, profileId))
        .orderBy(asc(playbackQueueItems.position))
      return {
        items: items.map(
          ({
            mediaType,
            mediaId,
            videoId,
            name,
            poster,
            artwork,
            videoTitle,
            season,
            episode,
          }) => ({
            mediaType,
            mediaId,
            videoId,
            name,
            ...(poster ? { poster } : {}),
            ...(artwork ? { artwork } : {}),
            ...(videoTitle ? { videoTitle } : {}),
            ...(season === null ? {} : { season }),
            ...(episode === null ? {} : { episode }),
          }),
        ),
      }
    },
  )

  app.put(
    "/v1/profiles/:profileId/queue",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        body: Type.Object({ items: Type.Array(queueItemSchema, { maxItems: 200 }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const body = request.body as { items: QueueInput[] }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const items = normalizeQueueItems(body.items)
      await db.transaction(async (tx) => {
        await tx.delete(playbackQueueItems).where(eq(playbackQueueItems.profileId, profileId))
        if (items.length > 0) {
          await tx
            .insert(playbackQueueItems)
            .values(items.map((item, position) => ({ ...item, profileId, position })))
        }
      })
      return { items }
    },
  )
}
