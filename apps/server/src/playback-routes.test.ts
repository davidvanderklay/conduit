import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { registerPlaybackRoutes } from "./route-modules/playback-routes.js"

describe("playback routes", () => {
  const apps: Awaited<ReturnType<typeof Fastify>>[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
    vi.restoreAllMocks()
  })

  it("proxies valid IntroDB segment requests without exposing the upstream CORS restriction", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          intro: { start_sec: 30, end_sec: 90 },
          outro: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const app = Fastify()
    registerPlaybackRoutes(app)
    apps.push(app)

    const response = await app.inject({
      method: "GET",
      url: "/v1/playback/skip-segments?imdbId=tt1234567&season=2&episode=4",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      intro: { start_sec: 30, end_sec: 90 },
      outro: null,
    })
    expect(upstream).toHaveBeenCalledTimes(1)
    const [requestedUrl, options] = upstream.mock.calls[0]!
    expect(String(requestedUrl)).toBe(
      "https://api.introdb.app/segments?imdb_id=tt1234567&season=2&episode=4",
    )
    expect(options).toMatchObject({ headers: { accept: "application/json" } })
  })

  it("returns no segments for invalid identifiers", async () => {
    const upstream = vi.spyOn(globalThis, "fetch")
    const app = Fastify()
    registerPlaybackRoutes(app)
    apps.push(app)

    const response = await app.inject({
      method: "GET",
      url: "/v1/playback/skip-segments?imdbId=not-imdb&season=0&episode=1",
    })

    expect(response.statusCode).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it("degrades to an empty response when IntroDB is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("upstream unavailable"))
    const app = Fastify()
    registerPlaybackRoutes(app)
    apps.push(app)

    const response = await app.inject({
      method: "GET",
      url: "/v1/playback/skip-segments?imdbId=tt1234567&season=1&episode=1",
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ intro: null, recap: null, outro: null })
  })
})
