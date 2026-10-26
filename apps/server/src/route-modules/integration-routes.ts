import { Type } from "@sinclair/typebox"
import type { FastifyInstance, FastifyReply } from "fastify"
import type { IntegrationProviderId } from "../db/schema.js"
import { ProviderError } from "../integrations/providers.js"
import { INTEGRATION_PROVIDERS, IntegrationRequestError } from "../integrations/service.js"
import type { RouteContext } from "./context.js"
import { canAccessProfile, requireUser } from "./helpers.js"

const params = Type.Object({
  profileId: Type.String({ format: "uuid" }),
  provider: Type.Union(INTEGRATION_PROVIDERS.map((id) => Type.Literal(id))),
})

type Params = { profileId: string; provider: IntegrationProviderId }

/** Connect, sync, and disconnect Trakt, Simkl, and MDBList per profile. */
export function registerIntegrationRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, db, integrations } = context
  if (!integrations) return

  app.get(
    "/v1/profiles/:profileId/integrations",
    { schema: { params: Type.Object({ profileId: Type.String({ format: "uuid" }) }) } },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      return { integrations: await integrations.status(profileId) }
    },
  )

  app.post(
    "/v1/profiles/:profileId/integrations/:provider/device",
    { schema: { params } },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, provider } = request.params as Params
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      return handle(reply, () => integrations.startDevice(profileId, provider))
    },
  )

  app.post(
    "/v1/profiles/:profileId/integrations/:provider/device/poll",
    {
      schema: {
        params,
        body: Type.Object({ handle: Type.String({ minLength: 1, maxLength: 4096 }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, provider } = request.params as Params
      const { handle: deviceHandle } = request.body as { handle: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      return handle(reply, async () => ({
        status: await integrations.pollDevice(profileId, provider, deviceHandle),
      }))
    },
  )

  app.put(
    "/v1/profiles/:profileId/integrations/:provider",
    {
      schema: {
        params,
        body: Type.Object({ apiKey: Type.String({ minLength: 1, maxLength: 512 }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, provider } = request.params as Params
      const { apiKey } = request.body as { apiKey: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      return handle(reply, async () => {
        await integrations.connectApiKey(profileId, provider, apiKey.trim())
        return reply.code(204).send()
      })
    },
  )

  app.post(
    "/v1/profiles/:profileId/integrations/:provider/sync",
    { schema: { params } },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, provider } = request.params as Params
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      // Pull failures are stored on the connection; the client reads them from status.
      await integrations.sync(profileId, provider).catch(() => undefined)
      return { integrations: await integrations.status(profileId) }
    },
  )

  app.delete(
    "/v1/profiles/:profileId/integrations/:provider",
    { schema: { params } },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, provider } = request.params as Params
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      await integrations.disconnect(profileId, provider)
      return reply.code(204).send()
    },
  )
}

async function handle<T>(reply: FastifyReply, run: () => Promise<T>) {
  try {
    return await run()
  } catch (error) {
    if (error instanceof IntegrationRequestError) return reply.badRequest(error.message)
    if (error instanceof ProviderError) return reply.badGateway(error.message)
    throw error
  }
}
