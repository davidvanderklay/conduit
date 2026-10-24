import { Type } from "@sinclair/typebox"
import type { FastifyInstance, FastifyReply } from "fastify"
import {
  connectMigrationSource,
  MigrationError,
  readMigrationSource,
  type MigrationCredentials,
  type MigrationSession,
} from "../migration-sources.js"
import type { RouteContext } from "./context.js"
import { requireUser } from "./helpers.js"

const Secret = Type.String({ minLength: 1, maxLength: 4096 })

const MigrationSessionSchema = Type.Union([
  Type.Object({ source: Type.Literal("stremio"), authKey: Secret }),
  Type.Object({
    source: Type.Literal("nuvio"),
    backendUrl: Type.String({ format: "uri", maxLength: 2048 }),
    publishableKey: Secret,
    accessToken: Secret,
  }),
])

// Read-only bridge to Stremio and Nuvio. Credentials and session tokens are
// forwarded for the duration of a request and never stored. The client keeps
// the returned session in memory, reads a snapshot, then imports it through
// /v1/profiles/:profileId/import with mode "additive".
export function registerMigrationRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth } = context

  app.post(
    "/v1/migrations/connect",
    {
      schema: {
        body: Type.Union([
          Type.Object({ source: Type.Literal("stremio"), authKey: Secret }),
          Type.Object({
            source: Type.Literal("stremio"),
            email: Type.String({ minLength: 1, maxLength: 320 }),
            password: Secret,
          }),
          Type.Object({
            source: Type.Literal("nuvio"),
            email: Type.String({ minLength: 1, maxLength: 320 }),
            password: Secret,
            backendUrl: Type.Optional(Type.String({ format: "uri", maxLength: 2048 })),
          }),
        ]),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      reply.header("cache-control", "no-store")
      try {
        return await connectMigrationSource(request.body as MigrationCredentials)
      } catch (error) {
        return sendMigrationError(reply, error)
      }
    },
  )

  app.post(
    "/v1/migrations/read",
    {
      schema: {
        body: Type.Object({
          session: MigrationSessionSchema,
          profileId: Type.String({ minLength: 1, maxLength: 100 }),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const body = request.body as { session: MigrationSession; profileId: string }
      reply.header("cache-control", "no-store")
      try {
        return await readMigrationSource(body.session, body.profileId)
      } catch (error) {
        return sendMigrationError(reply, error)
      }
    },
  )
}

function sendMigrationError(reply: FastifyReply, error: unknown) {
  if (error instanceof MigrationError) {
    return error.status === 400 ? reply.badRequest(error.message) : reply.badGateway(error.message)
  }
  throw error
}
