import { Type } from "@sinclair/typebox"
import { and, asc, desc, eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { libraryItems } from "../db/schema.js"
import type { RouteContext } from "./context.js"
import { canAccessProfile, requireUser, toLibraryItem } from "./helpers.js"

export function registerLibraryRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, db } = context

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
}
