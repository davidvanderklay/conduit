import type { FastifyInstance } from "fastify"
import { registerAddonRoutes } from "./route-modules/addon-routes.js"
import { registerAuthRoutes } from "./route-modules/auth-routes.js"
import { registerBootstrapRoutes } from "./route-modules/bootstrap-routes.js"
import type { RouteContext } from "./route-modules/context.js"
import { rehashAddonInstallationUrls } from "./route-modules/helpers.js"
import { registerLibraryRoutes } from "./route-modules/library-routes.js"
import { registerProfileRoutes } from "./route-modules/profile-routes.js"
import {
  filterContinueWatching,
  isPlaybackComplete,
  registerProgressRoutes,
  shouldKeepContinueWatching,
} from "./route-modules/progress-routes.js"

export async function registerRoutes(app: FastifyInstance, context: RouteContext) {
  await rehashAddonInstallationUrls(context.db, context.config.addonEncryptionKey)

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/v1/")) {
      reply.header("cache-control", "private, no-store")
    }
    return payload
  })

  app.get("/health", async () => ({ status: "ok" }))

  registerAuthRoutes(app, context)
  registerBootstrapRoutes(app, context)
  registerProfileRoutes(app, context)
  registerAddonRoutes(app, context)
  registerLibraryRoutes(app, context)
  registerProgressRoutes(app, context)
}

export { filterContinueWatching, isPlaybackComplete, shouldKeepContinueWatching }
