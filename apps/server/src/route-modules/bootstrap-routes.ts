import type { FastifyInstance } from "fastify"
import { asc, eq, inArray } from "drizzle-orm"
import { householdMembers, households, profiles } from "../db/schema.js"
import type { RouteContext } from "./context.js"
import { requireUser } from "./helpers.js"

export function registerBootstrapRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, db } = context

  app.get("/v1/bootstrap", async (request, reply) => {
    const user = await requireUser(request, reply, auth)
    if (!user) return

    const memberships = await db
      .select({
        householdId: households.id,
        householdName: households.name,
        role: householdMembers.role,
      })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .where(eq(householdMembers.userId, user.id))

    const householdIds = memberships.map((membership) => membership.householdId)
    const profileRows =
      householdIds.length === 0
        ? []
        : await db
            .select()
            .from(profiles)
            .where(inArray(profiles.householdId, householdIds))
            .orderBy(asc(profiles.createdAt))

    return {
      user: { email: user.email },
      households: memberships.map((membership) => ({
        id: membership.householdId,
        name: membership.householdName,
        role: membership.role,
        profiles: profileRows
          .filter((profile) => profile.householdId === membership.householdId)
          .map((profile) => ({
            id: profile.id,
            name: profile.name,
            isKids: profile.isKids,
            usesPrimaryAddons: profile.usesPrimaryAddons,
            avatarColor: profile.avatarColor,
            avatarUrl: profile.avatarUrl,
          })),
      })),
    }
  })
}
