import { Type } from "@sinclair/typebox"
import { randomBytes } from "node:crypto"
import { hashPassword, verifyPassword } from "better-auth/crypto"
import { and, eq, gt, isNull, lt, ne, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { fromNodeHeaders } from "better-auth/node"
import { canCreateFirstAccount } from "../bootstrap.js"
import { encryptSecret } from "../crypto.js"
import { hashAdminRecoveryToken } from "../admin-recovery.js"
import {
  accounts,
  adminRecoveryTokens,
  desktopAuthRequests,
  recoveryCodes,
  sessions,
  users,
  instanceSettings,
} from "../db/schema.js"
import {
  DESKTOP_AUTH_TTL_MS,
  hashDesktopCode,
  pkceChallenge,
  secureEqual,
  validPkceVerifier,
  validateLoopbackCallback,
  validateMobileCallback,
} from "../desktop-auth.js"
import type { RouteContext } from "./context.js"
import {
  consumeRateLimit,
  formatRecoveryCode,
  hashRecoveryCode,
  isRecentSession,
  requireOwner,
  requireUser,
  redirectDesktopAuthError,
  revokeOtherSessions,
} from "./helpers.js"
import { parseTrustedHttpUrl } from "../url-security.js"

export function registerAuthRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, authSettings, config, db } = context

  app.get("/v1/auth/config", async () => {
    const existing = await db.select({ id: users.id }).from(users).limit(1)
    return {
      needsOwner: existing.length === 0,
      localRegistration:
        existing.length === 0
          ? canCreateFirstAccount(config, existing.length)
          : authSettings.registrationMode === "open",
      bootstrapMode: config.bootstrapMode,
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
      if (!(await consumeRateLimit(db, `desktop:${request.ip}`, 10, 15 * 60_000))) {
        return reply.header("retry-after", "900").tooManyRequests("Too many desktop sign-in attempts. Try again later.")
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

  app.post(
    "/v1/auth/mobile/start",
    {
      schema: {
        body: Type.Object({
          callbackUrl: Type.String({ maxLength: 100 }),
          codeChallenge: Type.String({ minLength: 43, maxLength: 128 }),
        }),
      },
    },
    async (request, reply) => {
      if (!(await consumeRateLimit(db, `desktop:${request.ip}`, 10, 15 * 60_000))) {
        return reply.header("retry-after", "900").tooManyRequests("Too many mobile sign-in attempts. Try again later.")
      }
      const body = request.body as { callbackUrl: string; codeChallenge: string }
      let callbackUrl: string
      try {
        callbackUrl = validateMobileCallback(body.callbackUrl)
      } catch (cause) {
        return reply.badRequest(cause instanceof Error ? cause.message : "Invalid callback")
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge)) {
        return reply.badRequest("Invalid PKCE challenge")
      }
      const id = randomBytes(32).toString("base64url")
      const expiresAt = new Date(Date.now() + DESKTOP_AUTH_TTL_MS)
      await db.delete(desktopAuthRequests).where(lt(desktopAuthRequests.expiresAt, new Date()))
      await db.insert(desktopAuthRequests).values({
        id,
        callbackUrl,
        codeChallenge: body.codeChallenge,
        expiresAt,
      })
      return {
        requestId: id,
        expiresAt: expiresAt.toISOString(),
        authorizationUrl: `${config.authUrl.replace(/\/$/, "")}/v1/auth/mobile/authorize?request=${encodeURIComponent(id)}`,
      }
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
    try {
      validateLoopbackCallback(handoff.callbackUrl)
    } catch {
      return reply.unauthorized("This authentication request is not for desktop")
    }
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

  app.get("/v1/auth/mobile/authorize", async (request, reply) => {
    const query = request.query as { request?: string }
    if (!query.request) return reply.badRequest("Missing mobile authentication request")
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
    if (!handoff) return reply.unauthorized("This mobile sign-in request is invalid or expired")
    try {
      validateMobileCallback(handoff.callbackUrl)
    } catch {
      return reply.unauthorized("This authentication request is not for mobile")
    }
    if (!authSettings.oidc) {
      return redirectDesktopAuthError(reply, handoff.callbackUrl, query.request, "oauth_disabled")
    }

    const requestId = encodeURIComponent(query.request)
    const callbackURL = `${config.authUrl.replace(/\/$/, "")}/v1/auth/mobile/complete?request=${requestId}`
    const errorCallbackURL = `${config.authUrl.replace(/\/$/, "")}/v1/auth/mobile/error?request=${requestId}`
    const authPath = authSettings.oidc.provider === "google"
      ? "/api/auth/sign-in/social"
      : "/api/auth/sign-in/oauth2"
    const body = authSettings.oidc.provider === "google"
      ? { provider: "google", callbackURL, errorCallbackURL, newUserCallbackURL: callbackURL }
      : { providerId: "conduit-oidc", callbackURL, errorCallbackURL, newUserCallbackURL: callbackURL }
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
    const result = (await response.json().catch(() => null)) as { url?: unknown } | null
    if (!response.ok || typeof result?.url !== "string") {
      return redirectDesktopAuthError(reply, handoff.callbackUrl, query.request, "oauth_start_failed")
    }
    return reply.redirect(result.url)
  })

  app.get("/v1/auth/desktop/complete", async (request, reply) => {
    const query = request.query as { request?: string }
    if (!query.request) return reply.badRequest("Missing desktop authentication request")
    const user = await requireUser(request, reply, auth)
    if (!user) return
    const [candidate] = await db
      .select({ callbackUrl: desktopAuthRequests.callbackUrl })
      .from(desktopAuthRequests)
      .where(eq(desktopAuthRequests.id, query.request))
      .limit(1)
    try {
      if (!candidate) throw new Error("missing")
      validateLoopbackCallback(candidate.callbackUrl)
    } catch {
      return reply.unauthorized("This authentication request is not for desktop")
    }
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

  app.get("/v1/auth/mobile/complete", async (request, reply) => {
    const query = request.query as { request?: string }
    if (!query.request) return reply.badRequest("Missing mobile authentication request")
    const user = await requireUser(request, reply, auth)
    if (!user) return
    const [candidate] = await db
      .select({ callbackUrl: desktopAuthRequests.callbackUrl })
      .from(desktopAuthRequests)
      .where(eq(desktopAuthRequests.id, query.request))
      .limit(1)
    try {
      if (!candidate) throw new Error("missing")
      validateMobileCallback(candidate.callbackUrl)
    } catch {
      return reply.unauthorized("This authentication request is not for mobile")
    }
    const code = randomBytes(32).toString("base64url")
    const [handoff] = await db
      .update(desktopAuthRequests)
      .set({ userId: user.id, codeHash: hashDesktopCode(code, config.authSecret) })
      .where(
        and(
          eq(desktopAuthRequests.id, query.request),
          isNull(desktopAuthRequests.usedAt),
          isNull(desktopAuthRequests.userId),
          gt(desktopAuthRequests.expiresAt, new Date()),
        ),
      )
      .returning({ callbackUrl: desktopAuthRequests.callbackUrl })
    if (!handoff) return reply.unauthorized("This mobile sign-in request is invalid or expired")
    try {
      validateMobileCallback(handoff.callbackUrl)
    } catch {
      return reply.unauthorized("This authentication request is not for mobile")
    }
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
    try {
      validateLoopbackCallback(handoff.callbackUrl)
    } catch {
      return reply.unauthorized("This authentication request is not for desktop")
    }
    const callback = new URL(handoff.callbackUrl)
    callback.searchParams.set("request", query.request)
    callback.searchParams.set("error", query.error ?? "oauth_failed")
    return reply.redirect(callback.toString())
  })

  app.get("/v1/auth/mobile/error", async (request, reply) => {
    const query = request.query as { request?: string; error?: string }
    if (!query.request) return reply.badRequest("Missing mobile authentication request")
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
    if (!handoff) return reply.unauthorized("This mobile sign-in request is invalid or expired")
    try {
      validateMobileCallback(handoff.callbackUrl)
    } catch {
      return reply.unauthorized("This authentication request is not for mobile")
    }
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
            callbackUrl: desktopAuthRequests.callbackUrl,
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
        try {
          if (handoff) validateLoopbackCallback(handoff.callbackUrl)
        } catch {
          return false
        }
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

  app.post(
    "/v1/auth/mobile/exchange",
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
            callbackUrl: desktopAuthRequests.callbackUrl,
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
        try {
          if (handoff) validateMobileCallback(handoff.callbackUrl)
        } catch {
          return false
        }
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
          .where(and(eq(desktopAuthRequests.id, body.requestId), isNull(desktopAuthRequests.usedAt)))
        await tx.insert(sessions).values({
          id: randomBytes(24).toString("base64url"),
          token,
          userId: handoff.userId,
          expiresAt,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"] ?? "Conduit mobile",
        })
        return true
      })
      if (!exchanged) return reply.unauthorized("This mobile sign-in code is invalid or expired")
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
          currentPassword: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        }),
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply, auth)
      if (!user) return
      if (!(await consumeRateLimit(db, `password-mode:${user.id}:${request.ip}`, 5, 60_000))) {
        return reply.header("retry-after", "60").tooManyRequests("Too many credential changes. Try again later.")
      }
      const body = request.body as {
        enabled: boolean
        password?: string
        currentPassword?: string
      }
      const [credential] = await db
        .select({ id: accounts.id, password: accounts.password })
        .from(accounts)
        .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
        .limit(1)

      if (credential?.password) {
        if (body.currentPassword) {
          if (!(await verifyPassword({ hash: credential.password, password: body.currentPassword }))) {
            return reply.unauthorized("The current password is incorrect")
          }
        } else if (!isRecentSession(user)) {
          return reply.forbidden("Sign in again or provide the current password before changing credentials")
        }
      } else if (!isRecentSession(user)) {
        return reply.forbidden("Sign in again before changing credentials")
      }

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
        await db.transaction(async (tx) => {
          await tx
            .update(accounts)
            .set({ password: null, updatedAt: new Date() })
            .where(eq(accounts.id, credential.id))
          await revokeOtherSessions(tx, user)
        })
        return { passwordEnabled: false }
      }

      if (!body.password) return reply.badRequest("A new password is required")
      const password = await hashPassword(body.password)
      await db.transaction(async (tx) => {
        if (credential) {
          await tx
            .update(accounts)
            .set({ password, updatedAt: new Date() })
            .where(eq(accounts.id, credential.id))
        } else {
          await tx.insert(accounts).values({
            id: randomBytes(24).toString("base64url"),
            accountId: user.id,
            issuer: "local:credential",
            providerId: "credential",
            userId: user.id,
            password,
          })
        }
        await revokeOtherSessions(tx, user)
      })
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
            issuer: "local:credential",
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
          parseTrustedHttpUrl(body.oidcIssuer, "OIDC issuer")
        } catch {
          return reply.badRequest("OIDC issuer must use HTTPS (HTTP is allowed only for loopback development)")
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
    if (!isRecentSession(user)) {
      return reply.forbidden("Sign in again before generating recovery codes")
    }
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
      if (!(await consumeRateLimit(db, `recovery:${request.ip}`, 10, 15 * 60_000))) {
        return reply.header("retry-after", "900").tooManyRequests("Too many recovery attempts. Try again later.")
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
}
