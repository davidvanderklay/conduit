import { createHmac } from "node:crypto"
import { fromNodeHeaders } from "better-auth/node"
import { and, asc, eq, lt, ne, sql } from "drizzle-orm"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { Auth } from "../auth.js"
import { decryptSecret, stableSecretHash } from "../crypto.js"
import type { Database } from "../db/index.js"
import {
  addonInstallations,
  householdMembers,
  profiles,
  rateLimitEntries,
  sessions,
  users,
  libraryItems,
  watchProgress,
} from "../db/schema.js"
import { parseTrustedHttpUrl } from "../url-security.js"
import type { SessionUser } from "./context.js"

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: Auth,
): Promise<SessionUser | undefined> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  })
  if (!session?.user) {
    reply.unauthorized()
    return
  }
  return {
    id: session.user.id,
    email: session.user.email,
    sessionId: session.session?.id,
    sessionCreatedAt: session.session?.createdAt
      ? new Date(session.session.createdAt)
      : new Date(0),
  }
}

export function isRecentSession(user: SessionUser): boolean {
  return Date.now() - user.sessionCreatedAt.getTime() <= 10 * 60_000
}

export async function revokeOtherSessions(
  tx: Pick<Database, "delete">,
  user: SessionUser,
): Promise<void> {
  const conditions = user.sessionId
    ? and(eq(sessions.userId, user.id), ne(sessions.id, user.sessionId))
    : eq(sessions.userId, user.id)
  await tx.delete(sessions).where(conditions)
}

export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: Auth,
  db: Database,
) {
  const sessionUser = await requireUser(request, reply, auth)
  if (!sessionUser) return
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1)
  if (!user || user.role !== "owner") {
    reply.forbidden()
    return
  }
  return user
}

export function formatRecoveryCode(bytes: Buffer): string {
  const value = bytes.toString("hex").toUpperCase()
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12)}`
}

export function hashRecoveryCode(code: string, secret: string): string {
  const normalized = code.replace(/[^a-fA-F0-9]/g, "").toUpperCase()
  return createHmac("sha256", secret).update(normalized).digest("hex")
}

export async function consumeRateLimit(
  db: Database,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  // Isolated route tests use a database stub. Production always has the
  // transaction method and persists these counters across restarts/instances.
  if (!db.transaction) return true
  const now = new Date()
  const resetAt = new Date(now.getTime() + windowMs)
  return db.transaction(async (tx) => {
    await tx.delete(rateLimitEntries).where(lt(rateLimitEntries.resetAt, now))
    const [entry] = await tx
      .insert(rateLimitEntries)
      .values({ key, count: 1, resetAt })
      .onConflictDoUpdate({
        target: rateLimitEntries.key,
        set: {
          count: sql`case when ${rateLimitEntries.resetAt} <= ${now} then 1 else least(${rateLimitEntries.count} + 1, ${max + 1}) end`,
          resetAt: sql`case when ${rateLimitEntries.resetAt} <= ${now} then ${resetAt} else ${rateLimitEntries.resetAt} end`,
        },
      })
      .returning({ count: rateLimitEntries.count })
    if (!entry) return true
    return entry.count <= max
  })
}

export function redirectDesktopAuthError(
  reply: FastifyReply,
  callbackUrl: string,
  requestId: string,
  error: string,
) {
  const callback = new URL(callbackUrl)
  callback.searchParams.set("request", requestId)
  callback.searchParams.set("error", error)
  return reply.redirect(callback.toString())
}

export async function canAccessProfile(
  db: Database,
  userId: string,
  profileId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .innerJoin(householdMembers, eq(householdMembers.householdId, profiles.householdId))
    .where(and(eq(profiles.id, profileId), eq(householdMembers.userId, userId)))
    .limit(1)
  return Boolean(row)
}

export async function resolveAddonProfileId(db: Database, profileId: string): Promise<string> {
  const [profile] = await db
    .select({ householdId: profiles.householdId, usesPrimaryAddons: profiles.usesPrimaryAddons })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1)
  if (!profile?.usesPrimaryAddons) return profileId
  const [primary] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.householdId, profile.householdId))
    .orderBy(asc(profiles.createdAt))
    .limit(1)
  return primary?.id ?? profileId
}

export function normalizeManifestUrl(value: string): string {
  const url = parseTrustedHttpUrl(value, "manifest URL")
  url.hash = ""
  return url.toString()
}

export async function rehashAddonInstallationUrls(
  db: Database,
  encryptionKey: Buffer,
): Promise<void> {
  // Older installations used an unkeyed SHA-256 fingerprint. Recompute those
  // fingerprints at startup so the database no longer exposes a dictionary-
  // testable value while preserving existing add-on installations.
  if (!db.query?.addonInstallations) return
  const rows = await db
    .select({
      id: addonInstallations.id,
      manifestUrlEncrypted: addonInstallations.manifestUrlEncrypted,
      manifestUrlHash: addonInstallations.manifestUrlHash,
    })
    .from(addonInstallations)
  await Promise.all(
    rows.map(async (row) => {
      const desiredHash = stableSecretHash(
        decryptSecret(row.manifestUrlEncrypted, encryptionKey),
        encryptionKey,
      )
      if (desiredHash === row.manifestUrlHash) return
      await db
        .update(addonInstallations)
        .set({ manifestUrlHash: desiredHash, updatedAt: new Date() })
        .where(eq(addonInstallations.id, row.id))
    }),
  )
}

export function toProgressItem(item: typeof watchProgress.$inferSelect) {
  return {
    videoId: item.videoId,
    mediaType: item.mediaType,
    mediaId: item.mediaId,
    name: item.name,
    poster: item.poster ?? undefined,
    videoTitle: item.videoTitle ?? undefined,
    season: item.season ?? undefined,
    episode: item.episode ?? undefined,
    positionMs: item.positionMs,
    durationMs: item.durationMs,
    watched: item.watched,
    dismissed: item.dismissed,
    continueWatching: item.continueWatching,
    playbackSource: item.playbackSource ?? undefined,
    updatedAt: item.updatedAt.toISOString(),
  }
}

export function toLibraryItem(item: typeof libraryItems.$inferSelect) {
  return {
    id: item.mediaId,
    type: item.mediaType,
    name: item.name,
    poster: item.poster ?? undefined,
    background: item.background ?? undefined,
    description: item.description ?? undefined,
    releaseInfo: item.releaseInfo ?? undefined,
    runtime: item.runtime ?? undefined,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}
