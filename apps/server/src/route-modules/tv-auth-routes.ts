import { Type } from "@sinclair/typebox"
import { randomBytes } from "node:crypto"
import { and, eq, gt, isNull, lt } from "drizzle-orm"
import type { FastifyInstance, FastifyReply } from "fastify"
import { fromNodeHeaders } from "better-auth/node"
import { desktopAuthRequests, sessions } from "../db/schema.js"
import { DESKTOP_AUTH_TTL_MS, pkceChallenge, secureEqual, validPkceVerifier } from "../desktop-auth.js"
import { TV_AUTH_CALLBACK, tvAuthApprovalPage, tvAuthMessagePage, tvUserCode } from "../tv-auth.js"
import type { RouteContext } from "./context.js"
import { consumeRateLimit } from "./helpers.js"

/**
 * Sign-in for devices without a browser. The TV starts a request and shows its
 * link as a QR code; a phone signs in at that link and approves; the TV polls
 * and proves it started the request with its PKCE verifier. The link carries
 * only the request id, never a session.
 */
export function registerTvAuthRoutes(app: FastifyInstance, context: RouteContext) {
  const { auth, authSettings, config, db } = context
  const authBase = config.authUrl.replace(/\/$/, "")
  const html = (reply: FastifyReply, status: number, body: string) =>
    reply.code(status).header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store").send(body)

  const pendingRequest = (id: string) =>
    and(
      eq(desktopAuthRequests.id, id),
      eq(desktopAuthRequests.callbackUrl, TV_AUTH_CALLBACK),
      isNull(desktopAuthRequests.usedAt),
      isNull(desktopAuthRequests.userId),
      gt(desktopAuthRequests.expiresAt, new Date()),
    )

  app.post(
    "/v1/auth/tv/start",
    { schema: { body: Type.Object({ codeChallenge: Type.String({ minLength: 43, maxLength: 128 }) }) } },
    async (request, reply) => {
      if (!(await consumeRateLimit(db, `desktop:${request.ip}`, 10, 15 * 60_000))) {
        return reply.header("retry-after", "900").tooManyRequests("Too many TV sign-in attempts. Try again later.")
      }
      const body = request.body as { codeChallenge: string }
      if (!/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge)) return reply.badRequest("Invalid PKCE challenge")
      const id = randomBytes(32).toString("base64url")
      const expiresAt = new Date(Date.now() + DESKTOP_AUTH_TTL_MS)
      await db.delete(desktopAuthRequests).where(lt(desktopAuthRequests.expiresAt, new Date()))
      await db.insert(desktopAuthRequests).values({
        id,
        callbackUrl: TV_AUTH_CALLBACK,
        codeChallenge: body.codeChallenge,
        expiresAt,
      })
      return {
        requestId: id,
        userCode: tvUserCode(id, config.authSecret),
        expiresAt: expiresAt.toISOString(),
        verificationUrl: `${authBase}/v1/auth/tv/authorize?request=${encodeURIComponent(id)}`,
      }
    },
  )

  app.get("/v1/auth/tv/authorize", async (request, reply) => {
    const query = request.query as { request?: string; error?: string }
    const expired = () =>
      html(reply, 401, tvAuthMessagePage("Request expired", "Start sign-in again on your TV and scan the new code."))
    if (!query.request) return expired()
    const [pending] = await db
      .select({ id: desktopAuthRequests.id })
      .from(desktopAuthRequests)
      .where(pendingRequest(query.request))
      .limit(1)
    if (!pending) return expired()
    if (query.error) {
      return html(reply, 400, tvAuthMessagePage("Sign-in failed", "The sign-in provider did not complete. Scan the code on your TV to try again."))
    }

    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (session?.user) {
      return html(
        reply,
        200,
        tvAuthApprovalPage({
          requestId: pending.id,
          userCode: tvUserCode(pending.id, config.authSecret),
          email: session.user.email,
        }),
      )
    }
    if (!authSettings.oidc) {
      return html(
        reply,
        200,
        tvAuthMessagePage(
          "Sign in first",
          `Sign in to conduit in this browser at ${config.webOrigin}, then scan the code on your TV again. You can also sign in on the TV with your email and password.`,
        ),
      )
    }

    // After the provider returns, this same page loads with a session and asks for approval.
    const returnUrl = `${authBase}/v1/auth/tv/authorize?request=${encodeURIComponent(pending.id)}`
    const google = authSettings.oidc.provider === "google"
    const headers = fromNodeHeaders(request.headers)
    headers.set("content-type", "application/json")
    headers.set("origin", new URL(config.authUrl).origin)
    const response = await auth.handler(
      new Request(new URL(google ? "/api/auth/sign-in/social" : "/api/auth/sign-in/oauth2", config.authUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...(google ? { provider: "google" } : { providerId: "conduit-oidc" }),
          callbackURL: returnUrl,
          newUserCallbackURL: returnUrl,
          errorCallbackURL: `${returnUrl}&error=oauth_failed`,
        }),
      }),
    )
    const cookies = response.headers.getSetCookie()
    if (cookies.length > 0) reply.header("set-cookie", cookies)
    const result = (await response.json().catch(() => null)) as { url?: unknown } | null
    if (!response.ok || typeof result?.url !== "string") {
      return html(reply, 502, tvAuthMessagePage("Sign-in unavailable", "The sign-in provider could not be started. Try again from your TV."))
    }
    return reply.redirect(result.url)
  })

  app.post(
    "/v1/auth/tv/approve",
    { schema: { body: Type.Object({ requestId: Type.String({ minLength: 32, maxLength: 100 }) }) } },
    async (request, reply) => {
      // Approval hands a session to another device, so it must come from this server's own page.
      if (request.headers.origin !== new URL(config.authUrl).origin) return reply.forbidden()
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
      if (!session?.user) return reply.unauthorized()
      const body = request.body as { requestId: string }
      const [approved] = await db
        .update(desktopAuthRequests)
        .set({ userId: session.user.id })
        .where(pendingRequest(body.requestId))
        .returning({ id: desktopAuthRequests.id })
      if (!approved) return reply.unauthorized("This TV sign-in request is invalid or expired")
      return { approved: true }
    },
  )

  app.post(
    "/v1/auth/tv/exchange",
    {
      schema: {
        body: Type.Object({
          requestId: Type.String({ minLength: 32, maxLength: 100 }),
          verifier: Type.String({ minLength: 43, maxLength: 128 }),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as { requestId: string; verifier: string }
      if (!validPkceVerifier(body.verifier)) return reply.badRequest("Invalid PKCE verifier")
      const challenge = pkceChallenge(body.verifier)
      const token = randomBytes(32).toString("base64url")
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const outcome = await db.transaction(async (tx) => {
        const [handoff] = await tx
          .select({ codeChallenge: desktopAuthRequests.codeChallenge, userId: desktopAuthRequests.userId })
          .from(desktopAuthRequests)
          .where(
            and(
              eq(desktopAuthRequests.id, body.requestId),
              eq(desktopAuthRequests.callbackUrl, TV_AUTH_CALLBACK),
              isNull(desktopAuthRequests.usedAt),
              gt(desktopAuthRequests.expiresAt, new Date()),
            ),
          )
          .for("update")
          .limit(1)
        if (!handoff || !secureEqual(handoff.codeChallenge, challenge)) return "invalid" as const
        if (!handoff.userId) return "pending" as const
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
          userAgent: request.headers["user-agent"] ?? "Conduit TV",
        })
        return "approved" as const
      })
      if (outcome === "invalid") return reply.unauthorized("This TV sign-in request is invalid or expired")
      if (outcome === "pending") return reply.code(202).send({ status: "pending" })
      return { status: "approved", token, expiresAt: expiresAt.toISOString() }
    },
  )
}
