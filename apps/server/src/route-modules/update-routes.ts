import type { FastifyInstance } from "fastify"
import type { RouteContext } from "./context.js"
import { requireOwner, requireUser } from "./helpers.js"
import { ServerUpdates } from "../updates.js"

export function registerUpdateRoutes(app: FastifyInstance, { auth, db }: RouteContext) {
  const updates = new ServerUpdates()
  updates.start()
  app.addHook("onClose", async () => updates.close())
  app.get("/v1/system/info", async (request, reply) => {
    if (!(await requireUser(request, reply, auth))) return
    return { ...updates.getStatus(), isOwner: false }
  })
  app.get("/v1/admin/updates", async (request, reply) => {
    if (!(await requireOwner(request, reply, auth, db))) return
    return { ...updates.getStatus(), isOwner: true }
  })
  app.post("/v1/admin/updates/check", async (request, reply) => {
    if (!(await requireOwner(request, reply, auth, db))) return
    return { ...(await updates.check()), isOwner: true }
  })
}
