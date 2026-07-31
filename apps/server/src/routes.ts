import { Type } from "@sinclair/typebox"
import { randomBytes, createHmac } from "node:crypto"
import { hashPassword } from "better-auth/crypto"
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, notLike, sql } from "drizzle-orm"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { fromNodeHeaders } from "better-auth/node"
import type { Auth } from "./auth.js"
import type { Config } from "./config.js"
import { decryptSecret, encryptSecret, stableSecretHash } from "./crypto.js"
import type { Database } from "./db/index.js"
import type { RuntimeAuthSettings } from "./instance-auth.js"
import { hashAdminRecoveryToken } from "./admin-recovery.js"
import {
  accounts,
  adminRecoveryTokens,
  addonInstallations,
  desktopAuthRequests,
  householdMembers,
  households,
  libraryItems,
  profiles,
  instanceSettings,
  recoveryCodes,
  sessions,
  users,
  watchProgress,
} from "./db/schema.js"
import {
  DESKTOP_AUTH_TTL_MS,
  hashDesktopCode,
  pkceChallenge,
  secureEqual,
  validPkceVerifier,
  validateLoopbackCallback,
} from "./desktop-auth.js"
import {
  PORTABLE_DATA_FORMAT,
  PORTABLE_DATA_VERSION,
  MAX_IMPORT_BYTES,
  previewPortableData,
  validatePortableData,
  type PortableProfileData,
} from "./portable-data.js"

interface RouteContext {
  auth: Auth
  authSettings: RuntimeAuthSettings
  config: Config
  db: Database
}

interface SessionUser {
  id: string
}

const LEGACY_COMPLETION_MARKER_PREFIX = "conduit:completion:"

export async function registerRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, authSettings, config, db } = context
  const recoveryAttempts = new Map<string, { count: number; resetAt: number }>()
  const desktopAuthAttempts = new Map<string, { count: number; resetAt: number }>()

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/v1/")) {
      reply.header("cache-control", "private, no-store")
    }
    return payload
  })

  app.get("/health", async () => ({ status: "ok" }))

  app.get("/v1/auth/config", async () => {
    const existing = await db.select({ id: users.id }).from(users).limit(1)
    return {
      needsOwner: existing.length === 0,
      localRegistration: existing.length === 0 || authSettings.registrationMode === "open",
      oidc: authSettings.oidc
        ? {
            enabled: true,
            provider: authSettings.oidc.provider,
            displayName: authSettings.oidc.displayName,
          }
        : { enabled: false },
    }
  })

  app.post(
    "/v1/auth/desktop/start",
    {
      schema: {
        body: Type.Object({
          callbackUrl: Type.String({ maxLength: 200 }),
          codeChallenge: Type.String({ minLength: 43, maxLength: 128 }),
        }),
      },
    },
    async (request, reply) => {
      if (!consumeRecoveryAttempt(desktopAuthAttempts, request.ip)) {
        return reply.tooManyRequests("Too many desktop sign-in attempts. Try again later.")
      }
      const body = request.body as { callbackUrl: string; codeChallenge: string }
      let callbackUrl: string
      try {
        callbackUrl = validateLoopbackCallback(body.callbackUrl)
      } catch (cause) {
        return reply.badRequest(cause instanceof Error ? cause.message : "Invalid callback")
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge)) {
        return reply.badRequest("Invalid PKCE challenge")
      }
      const id = randomBytes(32).toString("base64url")
      const expiresAt = new Date(Date.now() + DESKTOP_AUTH_TTL_MS)
      await db
        .delete(desktopAuthRequests)
        .where(lt(desktopAuthRequests.expiresAt, new Date()))
      await db.insert(desktopAuthRequests).values({
        id,
        callbackUrl,
        codeChallenge: body.codeChallenge,
        expiresAt,
      })
      return { requestId: id, expiresAt: expiresAt.toISOString() }
    },
  )

  app.get("/v1/auth/desktop/authorize", async (request, reply) => {
    const query = request.query as { request?: string }
    if (!query.request) return reply.badRequest("Missing desktop authentication request")
    const [handoff] = await db
      .select({ callbackUrl: desktopAuthRequests.callbackUrl })
      .from(desktopAuthRequests)
      .where(
        and(
          eq(desktopAuthRequests.id, query.request),
          isNull(desktopAuthRequests.usedAt),
          isNull(desktopAuthRequests.userId),
          gt(desktopAuthRequests.expiresAt, new Date()),
        ),
      )
      .limit(1)
    if (!handoff) return reply.unauthorized("This desktop sign-in request is invalid or expired")
    if (!authSettings.oidc) {
      return redirectDesktopAuthError(reply, handoff.callbackUrl, query.request, "oauth_disabled")
    }

    const requestId = encodeURIComponent(query.request)
    const callbackURL = `${config.authUrl.replace(/\/$/, "")}/v1/auth/desktop/complete?request=${requestId}`
    const errorCallbackURL = `${config.authUrl.replace(/\/$/, "")}/v1/auth/desktop/error?request=${requestId}`
    const authPath =
      authSettings.oidc.provider === "google"
        ? "/api/auth/sign-in/social"
        : "/api/auth/sign-in/oauth2"
    const body =
      authSettings.oidc.provider === "google"
        ? {
            provider: "google",
            callbackURL,
            errorCallbackURL,
            newUserCallbackURL: callbackURL,
          }
        : {
            providerId: "conduit-oidc",
            callbackURL,
            errorCallbackURL,
            newUserCallbackURL: callbackURL,
          }
    const headers = fromNodeHeaders(request.headers)
    headers.set("content-type", "application/json")
    headers.set("origin", new URL(config.authUrl).origin)
    const response = await auth.handler(
      new Request(new URL(authPath, config.authUrl), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    )
    const cookies = response.headers.getSetCookie()
    if (cookies.length > 0) reply.header("set-cookie", cookies)
    const result = (await response.json().catch(() => null)) as {
      url?: unknown
      message?: unknown
    } | null
    if (!response.ok || typeof result?.url !== "string") {
      request.log.error(
        { statusCode: response.status, message: result?.message },
        "unable to start desktop OAuth",
      )
      return redirectDesktopAuthError(
        reply,
        handoff.callbackUrl,
        query.request,
        "oauth_start_failed",
      )
    }
    return reply.redirect(result.url)
  })

  app.get("/v1/auth/desktop/complete", async (request, reply) => {
    const query = request.query as { request?: string }
    if (!query.request) return reply.badRequest("Missing desktop authentication request")
    const user = await requireUser(request, reply, auth)
    if (!user) return
    const code = randomBytes(32).toString("base64url")
    const [handoff] = await db
      .update(desktopAuthRequests)
      .set({
        userId: user.id,
        codeHash: hashDesktopCode(code, config.authSecret),
      })
      .where(
        and(
          eq(desktopAuthRequests.id, query.request),
          isNull(desktopAuthRequests.usedAt),
          isNull(desktopAuthRequests.userId),
          gt(desktopAuthRequests.expiresAt, new Date()),
        ),
      )
      .returning({ callbackUrl: desktopAuthRequests.callbackUrl })
    if (!handoff) return reply.unauthorized("This desktop sign-in request is invalid or expired")
    const callback = new URL(handoff.callbackUrl)
    callback.searchParams.set("request", query.request)
    callback.searchParams.set("code", code)
    return reply.redirect(callback.toString())
  })

  app.get("/v1/auth/desktop/error", async (request, reply) => {
    const query = request.query as { request?: string; error?: string }
    if (!query.request) return reply.badRequest("Missing desktop authentication request")
    const [handoff] = await db
      .select({ callbackUrl: desktopAuthRequests.callbackUrl })
      .from(desktopAuthRequests)
      .where(
        and(
          eq(desktopAuthRequests.id, query.request),
          isNull(desktopAuthRequests.usedAt),
          gt(desktopAuthRequests.expiresAt, new Date()),
        ),
      )
      .limit(1)
    if (!handoff) return reply.unauthorized("This desktop sign-in request is invalid or expired")
    const callback = new URL(handoff.callbackUrl)
    callback.searchParams.set("request", query.request)
    callback.searchParams.set("error", query.error ?? "oauth_failed")
    return reply.redirect(callback.toString())
  })

  app.post(
    "/v1/auth/desktop/exchange",
    {
      schema: {
        body: Type.Object({
          requestId: Type.String({ minLength: 32, maxLength: 100 }),
          code: Type.String({ minLength: 32, maxLength: 100 }),
          verifier: Type.String({ minLength: 43, maxLength: 128 }),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as { requestId: string; code: string; verifier: string }
      if (!validPkceVerifier(body.verifier)) return reply.badRequest("Invalid PKCE verifier")
      const codeHash = hashDesktopCode(body.code, config.authSecret)
      const challenge = pkceChallenge(body.verifier)
      const token = randomBytes(32).toString("base64url")
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const exchanged = await db.transaction(async (tx) => {
        const [handoff] = await tx
          .select({
            codeHash: desktopAuthRequests.codeHash,
            codeChallenge: desktopAuthRequests.codeChallenge,
            userId: desktopAuthRequests.userId,
          })
          .from(desktopAuthRequests)
          .where(
            and(
              eq(desktopAuthRequests.id, body.requestId),
              isNull(desktopAuthRequests.usedAt),
              gt(desktopAuthRequests.expiresAt, new Date()),
            ),
          )
          .for("update")
          .limit(1)
        if (
          !handoff?.userId ||
          !handoff.codeHash ||
          !secureEqual(handoff.codeHash, codeHash) ||
          !secureEqual(handoff.codeChallenge, challenge)
        ) {
          return false
        }
        await tx
          .update(desktopAuthRequests)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(desktopAuthRequests.id, body.requestId),
              isNull(desktopAuthRequests.usedAt),
            ),
          )
        await tx.insert(sessions).values({
          id: randomBytes(24).toString("base64url"),
          token,
          userId: handoff.userId,
          expiresAt,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? "Conduit desktop",
        })
        return true
      })
      if (!exchanged) return reply.unauthorized("This desktop sign-in code is invalid or expired")
      return { token, expiresAt: expiresAt.toISOString() }
    },
  )

  app.get("/v1/auth/methods", async (request, reply) => {
    const user = await requireUser(request, reply, auth)
    if (!user) return
    const rows = await db
      .select({
        providerId: accounts.providerId,
        hasPassword: sql<boolean>`${accounts.password} is not null`,
      })
      .from(accounts)
      .where(eq(accounts.userId, user.id))
    return {
      passwordEnabled: rows.some((row) => row.providerId === "credential" && row.hasPassword),
      linkedProviders: [...new Set(rows.filter((row) => row.providerId !== "credential").map((row) => row.providerId))],
      configuredProvider: authSettings.oidc?.provider ?? null,
      configuredProviderName: authSettings.oidc?.displayName ?? null,
    }
  })

  app.put(
    "/v1/auth/password-mode",
    {
      schema: {
        body: Type.Object({
          enabled: Type.Boolean(),
          password: Type.Optional(Type.String({ minLength: 8, maxLength: 128 })),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const body = request.body as { enabled: boolean; password?: string }
      const [credential] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
        .limit(1)

      if (!body.enabled) {
        const [oauthAccount] = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.userId, user.id), ne(accounts.providerId, "credential")))
          .limit(1)
        if (!oauthAccount) {
          return reply.badRequest("Link an OAuth provider before disabling your password")
        }
        if (!credential) return { passwordEnabled: false }
        await db
          .update(accounts)
          .set({ password: null, updatedAt: new Date() })
          .where(eq(accounts.id, credential.id))
        return { passwordEnabled: false }
      }

      if (!body.password) return reply.badRequest("A new password is required")
      const password = await hashPassword(body.password)
      if (credential) {
        await db
          .update(accounts)
          .set({ password, updatedAt: new Date() })
          .where(eq(accounts.id, credential.id))
      } else {
        await db.insert(accounts).values({
          id: randomBytes(24).toString("base64url"),
          accountId: user.id,
          providerId: "credential",
          userId: user.id,
          password,
        })
      }
      return { passwordEnabled: true }
    },
  )

  app.post(
    "/v1/auth/admin-recovery/inspect",
    {
      schema: {
        body: Type.Object({ token: Type.String({ minLength: 32, maxLength: 128 }) }),
      },
    },
    async (request, reply) => {
      const { token } = request.body as { token: string }
      const tokenHash = hashAdminRecoveryToken(token, config.authSecret)
      const [row] = await db
        .select({ email: users.email, expiresAt: adminRecoveryTokens.expiresAt })
        .from(adminRecoveryTokens)
        .innerJoin(users, eq(users.id, adminRecoveryTokens.userId))
        .where(
          and(
            eq(adminRecoveryTokens.tokenHash, tokenHash),
            isNull(adminRecoveryTokens.usedAt),
            gt(adminRecoveryTokens.expiresAt, new Date()),
          ),
        )
        .limit(1)
      if (!row) return reply.unauthorized("This recovery link is invalid or expired")
      return row
    },
  )

  app.post(
    "/v1/auth/admin-recovery/password",
    {
      schema: {
        body: Type.Object({
          token: Type.String({ minLength: 32, maxLength: 128 }),
          password: Type.String({ minLength: 8, maxLength: 128 }),
        }),
      },
    },
    async (request, reply) => {
      const { token, password } = request.body as { token: string; password: string }
      const tokenHash = hashAdminRecoveryToken(token, config.authSecret)
      const passwordHash = await hashPassword(password)
      const recovered = await db.transaction(async (tx) => {
        const [recovery] = await tx
          .update(adminRecoveryTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(adminRecoveryTokens.tokenHash, tokenHash),
              isNull(adminRecoveryTokens.usedAt),
              gt(adminRecoveryTokens.expiresAt, new Date()),
            ),
          )
          .returning({ userId: adminRecoveryTokens.userId })
        if (!recovery) return false
        const [credential] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(eq(accounts.userId, recovery.userId), eq(accounts.providerId, "credential")),
          )
          .limit(1)
        if (credential) {
          await tx
            .update(accounts)
            .set({ password: passwordHash, updatedAt: new Date() })
            .where(eq(accounts.id, credential.id))
        } else {
          await tx.insert(accounts).values({
            id: randomBytes(24).toString("base64url"),
            accountId: recovery.userId,
            providerId: "credential",
            userId: recovery.userId,
            password: passwordHash,
          })
        }
        await tx.delete(sessions).where(eq(sessions.userId, recovery.userId))
        return true
      })
      if (!recovered) return reply.unauthorized("This recovery link is invalid or expired")
      return { recovered: true }
    },
  )

  app.get("/v1/admin/auth", async (request, reply) => {
    const user = await requireOwner(request, reply, auth, db)
    if (!user) return
    const row = await db.query.instanceSettings.findFirst({
      where: eq(instanceSettings.id, "default"),
    })
    return {
      registrationMode: row?.registrationMode ?? "closed",
      oauthProvider: row?.oauthProvider ?? "google",
      oidcEnabled: row?.oidcEnabled ?? false,
      oidcIssuer: row?.oidcIssuer ?? "",
      oidcClientId: row?.oidcClientId ?? "",
      oidcDisplayName: row?.oidcDisplayName ?? "Single sign-on",
      oidcScopes: row?.oidcScopes ?? "openid email",
      oidcAutoRegister: row?.oidcAutoRegister ?? false,
      hasClientSecret: Boolean(row?.oidcClientSecretEncrypted),
      googleCallbackUrl: `${config.authUrl.replace(/\/$/, "")}/api/auth/callback/google`,
      oidcCallbackUrl: `${config.authUrl.replace(/\/$/, "")}/api/auth/oauth2/callback/conduit-oidc`,
    }
  })

  app.put(
    "/v1/admin/auth",
    {
      schema: {
        body: Type.Object({
          registrationMode: Type.Union([Type.Literal("open"), Type.Literal("closed")]),
          oauthProvider: Type.Union([Type.Literal("google"), Type.Literal("oidc")]),
          oidcEnabled: Type.Boolean(),
          oidcIssuer: Type.String({ maxLength: 1000 }),
          oidcClientId: Type.String({ maxLength: 500 }),
          oidcClientSecret: Type.Optional(Type.String({ maxLength: 2000 })),
          oidcDisplayName: Type.String({ minLength: 1, maxLength: 80 }),
          oidcScopes: Type.String({ minLength: 1, maxLength: 500 }),
          oidcAutoRegister: Type.Boolean(),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireOwner(request, reply, auth, db)
      if (!user) return
      const body = request.body as {
        registrationMode: "open" | "closed"
        oauthProvider: "google" | "oidc"
        oidcEnabled: boolean
        oidcIssuer: string
        oidcClientId: string
        oidcClientSecret?: string
        oidcDisplayName: string
        oidcScopes: string
        oidcAutoRegister: boolean
      }
      if (body.oidcEnabled && body.oauthProvider === "oidc") {
        try {
          const issuer = new URL(body.oidcIssuer)
          if (!["http:", "https:"].includes(issuer.protocol)) throw new Error()
        } catch {
          return reply.badRequest("OIDC issuer must be a valid HTTP(S) URL")
        }
      }
      if (body.oidcEnabled && !body.oidcClientId.trim()) {
        return reply.badRequest("OAuth client ID is required")
      }
      const current = await db.query.instanceSettings.findFirst({
        where: eq(instanceSettings.id, "default"),
      })
      if (body.oidcEnabled && !body.oidcClientSecret?.trim() && !current?.oidcClientSecretEncrypted) {
        return reply.badRequest("OIDC client secret is required")
      }
      const displayName =
        body.oauthProvider === "google" ? "Continue with Google" : body.oidcDisplayName.trim()
      const scopes = body.oauthProvider === "google" ? "openid email" : body.oidcScopes.trim()
      await db
        .insert(instanceSettings)
        .values({
          id: "default",
          registrationMode: body.registrationMode,
          oauthProvider: body.oauthProvider,
          oidcEnabled: body.oidcEnabled,
          oidcIssuer: body.oidcIssuer.trim() || null,
          oidcClientId: body.oidcClientId.trim() || null,
          ...(body.oidcClientSecret?.trim()
            ? {
                oidcClientSecretEncrypted: encryptSecret(
                  body.oidcClientSecret.trim(),
                  config.addonEncryptionKey,
                ),
              }
            : {}),
          oidcDisplayName: displayName,
          oidcScopes: scopes,
          oidcAutoRegister: body.oidcAutoRegister,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: instanceSettings.id,
          set: {
            registrationMode: body.registrationMode,
            oauthProvider: body.oauthProvider,
            oidcEnabled: body.oidcEnabled,
            oidcIssuer: body.oidcIssuer.trim() || null,
            oidcClientId: body.oidcClientId.trim() || null,
            ...(body.oidcClientSecret?.trim()
              ? {
                  oidcClientSecretEncrypted: encryptSecret(
                    body.oidcClientSecret.trim(),
                    config.addonEncryptionKey,
                  ),
                }
              : {}),
            oidcDisplayName: displayName,
            oidcScopes: scopes,
            oidcAutoRegister: body.oidcAutoRegister,
            updatedAt: new Date(),
          },
        })
      return { saved: true, restartRequired: true }
    },
  )

  app.post("/v1/auth/recovery-codes", async (request, reply) => {
    const user = await requireUser(request, reply, auth)
    if (!user) return
    const codes = Array.from({ length: 10 }, () => formatRecoveryCode(randomBytes(8)))
    await db.transaction(async (tx) => {
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id))
      await tx.insert(recoveryCodes).values(
        codes.map((code) => ({
          userId: user.id,
          codeHash: hashRecoveryCode(code, config.authSecret),
        })),
      )
    })
    return { codes }
  })

  app.post(
    "/v1/auth/recover",
    {
      schema: {
        body: Type.Object({
          email: Type.String({ format: "email", maxLength: 320 }),
          code: Type.String({ minLength: 8, maxLength: 40 }),
          password: Type.String({ minLength: 8, maxLength: 128 }),
        }),
      },
    },
    async (request, reply) => {
      if (!consumeRecoveryAttempt(recoveryAttempts, request.ip)) {
        return reply.tooManyRequests("Too many recovery attempts. Try again later.")
      }
      const body = request.body as { email: string; code: string; password: string }
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, body.email.trim().toLowerCase()))
        .limit(1)
      if (!user) return reply.unauthorized("Invalid email or recovery code")
      const [credential] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
        .limit(1)
      if (!credential) return reply.unauthorized("Invalid email or recovery code")
      const codeHash = hashRecoveryCode(body.code, config.authSecret)
      const passwordHash = await hashPassword(body.password)
      const recovered = await db.transaction(async (tx) => {
        const [code] = await tx
          .update(recoveryCodes)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(recoveryCodes.userId, user.id),
              eq(recoveryCodes.codeHash, codeHash),
              isNull(recoveryCodes.usedAt),
            ),
          )
          .returning({ id: recoveryCodes.id })
        if (!code) return false
        await tx
          .update(accounts)
          .set({ password: passwordHash, updatedAt: new Date() })
          .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
        await tx.delete(sessions).where(eq(sessions.userId, user.id))
        return true
      })
      if (!recovered) return reply.unauthorized("Invalid email or recovery code")
      return { recovered: true }
    },
  )

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
          })),
      })),
    }
  })

  app.post(
    "/v1/households",
    {
      schema: {
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 80 }),
          profileName: Type.String({ minLength: 1, maxLength: 80 }),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const body = request.body as { name: string; profileName: string }

      const result = await db.transaction(async (tx) => {
        const [household] = await tx
          .insert(households)
          .values({ name: body.name.trim() })
          .returning()
        await tx.insert(householdMembers).values({
          householdId: household!.id,
          userId: user.id,
          role: "owner",
        })
        const [profile] = await tx
          .insert(profiles)
          .values({
            householdId: household!.id,
            name: body.profileName.trim(),
          })
          .returning()
        return { household: household!, profile: profile! }
      })

      return reply.code(201).send(result)
    },
  )

  app.post(
    "/v1/households/:householdId/profiles",
    {
      schema: {
        params: Type.Object({ householdId: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 80, pattern: "\\S" }),
          isKids: Type.Optional(Type.Boolean()),
          copyAddonsFromProfileId: Type.Optional(Type.String({ format: "uuid" })),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { householdId } = request.params as { householdId: string }
      const body = request.body as {
        name: string
        isKids?: boolean
        copyAddonsFromProfileId?: string
      }

      const [membership] = await db
        .select({ householdId: householdMembers.householdId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.userId, user.id),
          ),
        )
        .limit(1)
      if (!membership) return reply.forbidden()

      let sourceAddons: Array<typeof addonInstallations.$inferSelect> = []
      if (body.copyAddonsFromProfileId) {
        const [sourceProfile] = await db
          .select({ householdId: profiles.householdId })
          .from(profiles)
          .where(eq(profiles.id, body.copyAddonsFromProfileId))
          .limit(1)
        if (!sourceProfile || sourceProfile.householdId !== householdId) {
          return reply.forbidden()
        }
        sourceAddons = await db
          .select()
          .from(addonInstallations)
          .where(eq(addonInstallations.profileId, body.copyAddonsFromProfileId))
          .orderBy(asc(addonInstallations.position))
      }

      const profile = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(profiles)
          .values({
            householdId,
            name: body.name.trim(),
            isKids: body.isKids ?? false,
          })
          .returning({ id: profiles.id, name: profiles.name, isKids: profiles.isKids })

        if (sourceAddons.length > 0) {
          await tx.insert(addonInstallations).values(
            sourceAddons.map((addon) => ({
              profileId: created!.id,
              manifestId: addon.manifestId,
              manifestUrlEncrypted: addon.manifestUrlEncrypted,
              manifestUrlHash: addon.manifestUrlHash,
              manifest: addon.manifest,
              position: addon.position,
              enabled: addon.enabled,
            })),
          )
        }
        return created!
      })

      return reply.code(201).send({ profile })
    },
  )

  app.patch(
    "/v1/profiles/:profileId",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        body: Type.Object(
          {
            name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
            isKids: Type.Optional(Type.Boolean()),
          },
          { minProperties: 1 },
        ),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const body = request.body as { name?: string; isKids?: boolean }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      const [profile] = await db
        .update(profiles)
        .set({
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.isKids !== undefined ? { isKids: body.isKids } : {}),
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, profileId))
        .returning({ id: profiles.id, name: profiles.name, isKids: profiles.isKids })
      return { profile }
    },
  )

  app.get(
    "/v1/profiles/:profileId/export",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        querystring: Type.Object({
          includeSecrets: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const { includeSecrets = false } = request.query as { includeSecrets?: boolean }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1)
      if (!profile) return reply.notFound()
      const [library, progress, addons] = await Promise.all([
        db.select().from(libraryItems).where(eq(libraryItems.profileId, profileId)),
        db.select().from(watchProgress).where(eq(watchProgress.profileId, profileId)),
        db
          .select()
          .from(addonInstallations)
          .where(eq(addonInstallations.profileId, profileId))
          .orderBy(asc(addonInstallations.position), asc(addonInstallations.createdAt)),
      ])
      const archive: PortableProfileData = {
        format: PORTABLE_DATA_FORMAT,
        version: PORTABLE_DATA_VERSION,
        exportedAt: new Date().toISOString(),
        profile: { name: profile.name, isKids: profile.isKids },
        library: library.map((item) => ({
          mediaType: item.mediaType as "movie" | "series",
          mediaId: item.mediaId,
          name: item.name,
          ...(item.poster ? { poster: item.poster } : {}),
          ...(item.background ? { background: item.background } : {}),
          ...(item.description ? { description: item.description } : {}),
          ...(item.releaseInfo ? { releaseInfo: item.releaseInfo } : {}),
          ...(item.runtime ? { runtime: item.runtime } : {}),
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        progress: progress.map((item) => toProgressItem(item)),
        addons: addons.map((addon) => ({
          manifestId: addon.manifestId,
          ...(includeSecrets
            ? { manifestUrl: decryptSecret(addon.manifestUrlEncrypted, config.addonEncryptionKey) }
            : {}),
          manifest: addon.manifest,
          position: addon.position,
          enabled: addon.enabled,
        })),
      }
      reply.header("content-disposition", `attachment; filename="conduit-${profileId}.json"`)
      reply.header("cache-control", "no-store")
      return archive
    },
  )

  app.post(
    "/v1/profiles/:profileId/import/preview",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        body: Type.Unknown(),
      },
      bodyLimit: MAX_IMPORT_BYTES,
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      try {
        return previewPortableData(validatePortableData(request.body))
      } catch (error) {
        return reply.badRequest(error instanceof Error ? error.message : "invalid import")
      }
    },
  )

  app.post(
    "/v1/profiles/:profileId/import",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          mode: Type.Union([Type.Literal("merge"), Type.Literal("replace")]),
          data: Type.Unknown(),
        }),
      },
      bodyLimit: MAX_IMPORT_BYTES + 1024,
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()
      const body = request.body as { mode: "merge" | "replace"; data: unknown }
      let data: PortableProfileData
      try {
        data = validatePortableData(body.data)
      } catch (error) {
        return reply.badRequest(error instanceof Error ? error.message : "invalid import")
      }

      await db.transaction(async (tx) => {
        if (body.mode === "replace") {
          await tx.delete(addonInstallations).where(eq(addonInstallations.profileId, profileId))
          await tx.delete(watchProgress).where(eq(watchProgress.profileId, profileId))
          await tx.delete(libraryItems).where(eq(libraryItems.profileId, profileId))
        }
        await tx
          .update(profiles)
          .set({ name: data.profile.name.trim(), isKids: data.profile.isKids, updatedAt: new Date() })
          .where(eq(profiles.id, profileId))
        for (const item of data.library) {
          const values = {
            profileId,
            mediaType: item.mediaType,
            mediaId: item.mediaId,
            name: item.name.trim(),
            poster: item.poster,
            background: item.background,
            description: item.description,
            releaseInfo: item.releaseInfo,
            runtime: item.runtime,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          }
          await tx
            .insert(libraryItems)
            .values(values)
            .onConflictDoUpdate({
              target: [libraryItems.profileId, libraryItems.mediaType, libraryItems.mediaId],
              set: values,
            })
        }
        for (const item of data.progress) {
          const values = {
            profileId,
            videoId: item.videoId,
            mediaType: item.mediaType,
            mediaId: item.mediaId,
            name: item.name.trim(),
            poster: item.poster,
            videoTitle: item.videoTitle,
            season: item.season,
            episode: item.episode,
            positionMs: item.positionMs,
            durationMs: item.durationMs,
            watched: item.watched,
            dismissed: item.dismissed ?? false,
            updatedAt: new Date(item.updatedAt),
          }
          await tx
            .insert(watchProgress)
            .values(values)
            .onConflictDoUpdate({
              target: [watchProgress.profileId, watchProgress.videoId],
              set: values,
            })
        }
        for (const addon of data.addons) {
          if (!addon.manifestUrl) continue
          const url = normalizeManifestUrl(addon.manifestUrl)
          const values = {
            profileId,
            manifestId: addon.manifestId,
            manifestUrlEncrypted: encryptSecret(url, config.addonEncryptionKey),
            manifestUrlHash: stableSecretHash(url),
            manifest: addon.manifest,
            position: addon.position,
            enabled: addon.enabled,
            updatedAt: new Date(),
          }
          await tx
            .insert(addonInstallations)
            .values(values)
            .onConflictDoUpdate({
              target: [addonInstallations.profileId, addonInstallations.manifestUrlHash],
              set: values,
            })
        }
      })
      return { imported: previewPortableData(data), mode: body.mode }
    },
  )

  app.get(
    "/v1/profiles/:profileId/addons",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      if (!(await canAccessProfile(db, user.id, profileId))) {
        return reply.forbidden()
      }

      const addons = await db
        .select()
        .from(addonInstallations)
        .where(eq(addonInstallations.profileId, profileId))
        .orderBy(asc(addonInstallations.position), asc(addonInstallations.createdAt))

      return {
        addons: addons.map((addon) => ({
          id: addon.id,
          manifestId: addon.manifestId,
          manifestUrl: decryptSecret(addon.manifestUrlEncrypted, config.addonEncryptionKey),
          manifest: addon.manifest,
          position: addon.position,
          enabled: addon.enabled,
        })),
      }
    },
  )

  app.post(
    "/v1/profiles/:profileId/addons",
    {
      schema: {
        params: Type.Object({ profileId: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          manifestUrl: Type.String({ format: "uri", maxLength: 4096 }),
          manifest: Type.Record(Type.String(), Type.Unknown()),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId } = request.params as { profileId: string }
      const body = request.body as {
        manifestUrl: string
        manifest: Record<string, unknown>
      }
      if (!(await canAccessProfile(db, user.id, profileId))) {
        return reply.forbidden()
      }

      const manifestId = typeof body.manifest.id === "string" ? body.manifest.id.trim() : ""
      const manifestName = typeof body.manifest.name === "string" ? body.manifest.name.trim() : ""
      if (!manifestId || !manifestName) {
        return reply.badRequest("manifest must include a non-empty id and name")
      }
      const url = normalizeManifestUrl(body.manifestUrl)
      const [position] = await db
        .select({
          value: sql<number>`coalesce(max(${addonInstallations.position}), -1) + 1`,
        })
        .from(addonInstallations)
        .where(eq(addonInstallations.profileId, profileId))

      const [addon] = await db
        .insert(addonInstallations)
        .values({
          profileId,
          manifestId,
          manifestUrlEncrypted: encryptSecret(url, config.addonEncryptionKey),
          manifestUrlHash: stableSecretHash(url),
          manifest: body.manifest,
          position: Number(position?.value ?? 0),
        })
        .onConflictDoUpdate({
          target: [addonInstallations.profileId, addonInstallations.manifestUrlHash],
          set: {
            manifestId,
            manifest: body.manifest,
            manifestUrlEncrypted: encryptSecret(url, config.addonEncryptionKey),
            enabled: true,
            updatedAt: new Date(),
          },
        })
        .returning()

      return reply.code(201).send({ id: addon!.id })
    },
  )

  app.delete(
    "/v1/profiles/:profileId/addons/:addonId",
    {
      schema: {
        params: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          addonId: Type.String({ format: "uuid" }),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, addonId } = request.params as {
        profileId: string
        addonId: string
      }
      if (!(await canAccessProfile(db, user.id, profileId))) {
        return reply.forbidden()
      }

      await db
        .delete(addonInstallations)
        .where(and(eq(addonInstallations.id, addonId), eq(addonInstallations.profileId, profileId)))
      return reply.code(204).send()
    },
  )

  app.patch(
    "/v1/profiles/:profileId/addons/:addonId",
    {
      schema: {
        params: Type.Object({
          profileId: Type.String({ format: "uuid" }),
          addonId: Type.String({ format: "uuid" }),
        }),
        body: Type.Object(
          {
            enabled: Type.Optional(Type.Boolean()),
            position: Type.Optional(Type.Integer({ minimum: 0 })),
          },
          { minProperties: 1 },
        ),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      const { profileId, addonId } = request.params as { profileId: string; addonId: string }
      const body = request.body as { enabled?: boolean; position?: number }
      if (!(await canAccessProfile(db, user.id, profileId))) return reply.forbidden()

      await db.transaction(async (tx) => {
        if (body.position !== undefined) {
          const rows = await tx
            .select({ id: addonInstallations.id })
            .from(addonInstallations)
            .where(eq(addonInstallations.profileId, profileId))
            .orderBy(asc(addonInstallations.position), asc(addonInstallations.createdAt))
          const current = rows.findIndex((row) => row.id === addonId)
          if (current >= 0) {
            const [moved] = rows.splice(current, 1)
            rows.splice(Math.min(body.position, rows.length), 0, moved!)
            await Promise.all(
              rows.map((row, position) =>
                tx
                  .update(addonInstallations)
                  .set({ position, updatedAt: new Date() })
                  .where(
                    and(
                      eq(addonInstallations.id, row.id),
                      eq(addonInstallations.profileId, profileId),
                    ),
                  ),
              ),
            )
          }
        }
        if (body.enabled !== undefined) {
          await tx
            .update(addonInstallations)
            .set({ enabled: body.enabled, updatedAt: new Date() })
            .where(
              and(
                eq(addonInstallations.id, addonId),
                eq(addonInstallations.profileId, profileId),
              ),
            )
        }
      })
      return reply.code(204).send()
    },
  )

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
}

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

function toProgressItem(item: typeof watchProgress.$inferSelect) {
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
    updatedAt: item.updatedAt.toISOString(),
  }
}

function toLibraryItem(item: typeof libraryItems.$inferSelect) {
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

async function requireUser(
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
  return { id: session.user.id }
}

async function requireOwner(
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

function formatRecoveryCode(bytes: Buffer): string {
  const value = bytes.toString("hex").toUpperCase()
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12)}`
}

function hashRecoveryCode(code: string, secret: string): string {
  const normalized = code.replace(/[^a-fA-F0-9]/g, "").toUpperCase()
  return createHmac("sha256", secret).update(normalized).digest("hex")
}

function consumeRecoveryAttempt(
  attempts: Map<string, { count: number; resetAt: number }>,
  address: string,
): boolean {
  const now = Date.now()
  const current = attempts.get(address)
  if (!current || current.resetAt <= now) {
    attempts.set(address, { count: 1, resetAt: now + 15 * 60_000 })
    return true
  }
  if (current.count >= 10) return false
  current.count += 1
  return true
}

function redirectDesktopAuthError(
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

async function canAccessProfile(db: Database, userId: string, profileId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .innerJoin(householdMembers, eq(householdMembers.householdId, profiles.householdId))
    .where(and(eq(profiles.id, profileId), eq(householdMembers.userId, userId)))
    .limit(1)
  return Boolean(row)
}

function normalizeManifestUrl(value: string): string {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("manifest URL must use HTTP or HTTPS")
  }
  url.hash = ""
  return url.toString()
}
