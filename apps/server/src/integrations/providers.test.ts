import { describe, expect, it } from "vitest"
import { createMdblist, createSimkl, createTrakt, historyBody, type Fetch } from "./providers.js"

function recorder(
  respond: (url: URL) => { status?: number; body: unknown; headers?: Record<string, string> },
) {
  const requests: Array<{ url: URL; init: RequestInit }> = []
  const fetchImpl: Fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    requests.push({ url, init })
    const { status = 200, body, headers } = respond(url)
    return new Response(JSON.stringify(body), { status, headers })
  }
  return { requests, fetchImpl }
}

const episode = { type: "episode", imdb: "tt0903747", season: 2, episode: 3 } as const

describe("tracking service requests", () => {
  it("groups history writes by show and season", () => {
    expect(
      historyBody([episode, { ...episode, episode: 4 }, { type: "movie", imdb: "tt0372784" }]),
    ).toEqual({
      movies: [{ ids: { imdb: "tt0372784" } }],
      shows: [
        {
          ids: { imdb: "tt0903747" },
          seasons: [{ number: 2, episodes: [{ number: 3 }, { number: 4 }] }],
        },
      ],
    })
  })

  it("scrobbles episodes in each service's shape", async () => {
    const trakt = recorder(() => ({ status: 201, body: {} }))
    await createTrakt({ clientId: "id", clientSecret: "secret" }, trakt.fetchImpl).scrobble(
      { token: "token" },
      "start",
      episode,
      12.5,
    )
    expect(trakt.requests[0]!.url.href).toBe("https://api.trakt.tv/scrobble/start")
    expect(trakt.requests[0]!.init.headers).toMatchObject({
      "trakt-api-key": "id",
      authorization: "Bearer token",
    })
    expect(JSON.parse(String(trakt.requests[0]!.init.body))).toEqual({
      show: { ids: { imdb: "tt0903747" } },
      episode: { season: 2, number: 3 },
      progress: 12.5,
    })

    const mdblist = recorder(() => ({ status: 201, body: {} }))
    await createMdblist(mdblist.fetchImpl).scrobble({ token: "key" }, "stop", episode, 95)
    expect(mdblist.requests[0]!.url.searchParams.get("apikey")).toBe("key")
    expect(JSON.parse(String(mdblist.requests[0]!.init.body))).toEqual({
      show: { ids: { imdb: "tt0903747" }, season: { number: 2, episode: { number: 3 } } },
      progress: 95,
    })
  })

  it("follows Simkl's device flow and incremental pulls", async () => {
    const simkl = recorder((url) => {
      if (url.pathname === "/oauth2/token")
        return { status: 400, body: { error: "authorization_pending" } }
      if (url.pathname === "/sync/playback")
        return {
          body: [
            {
              progress: 40,
              paused_at: "2026-10-01T00:00:00Z",
              type: "episode",
              episode: { season: 2, episode: 3, title: "Bit by a Dead Bee" },
              show: { title: "Breaking Bad", ids: { imdb: "tt0903747" } },
            },
          ],
        }
      return {
        body: {
          movies: [{ status: "plantowatch", movie: { title: "Heat", ids: { imdb: "tt0113277" } } }],
        },
      }
    })
    const provider = createSimkl({ clientId: "simkl-id" }, simkl.fetchImpl)

    await expect(provider.device!.poll("device")).resolves.toEqual({ status: "pending" })
    const library = await provider.pull({ token: "token" }, "2026-09-01T00:00:00Z")

    const itemsRequest = simkl.requests.find(
      (request) => request.url.pathname === "/sync/all-items",
    )
    expect(itemsRequest!.url.searchParams.get("date_from")).toBe("2026-09-01T00:00:00Z")
    expect(itemsRequest!.url.searchParams.get("client_id")).toBe("simkl-id")
    expect(library.watchlist).toEqual([{ ref: { type: "movie", imdb: "tt0113277" }, name: "Heat" }])
    expect(library.playback).toMatchObject([
      { ref: episode, name: "Breaking Bad", episodeTitle: "Bit by a Dead Bee", progress: 40 },
    ])
  })

  it("pages through Trakt and MDBList libraries", async () => {
    const trakt = recorder((url) => {
      const page = Number(url.searchParams.get("page"))
      const headers = { "x-pagination-page-count": "2" }
      if (url.pathname === "/sync/watched/shows")
        return {
          headers,
          body: [
            {
              show: { title: "Breaking Bad", ids: { imdb: "tt0903747" } },
              seasons: [
                {
                  number: 2,
                  episodes: [{ number: page + 2, last_watched_at: "2026-10-01T00:00:00Z" }],
                },
              ],
            },
          ],
        }
      return { headers, body: [] }
    })
    const traktLibrary = await createTrakt(
      { clientId: "id", clientSecret: "secret" },
      trakt.fetchImpl,
    ).pull({ token: "token" }, null)
    const showRequests = trakt.requests.filter(
      (request) => request.url.pathname === "/sync/watched/shows",
    )
    expect(showRequests.map((request) => request.url.searchParams.get("extended"))).toEqual([
      "progress",
      "progress",
    ])
    expect(traktLibrary.watched.map((item) => item.ref)).toEqual([
      episode,
      { ...episode, episode: 4 },
    ])

    const mdblist = recorder((url) => {
      if (url.pathname === "/sync/watched")
        return url.searchParams.get("cursor")
          ? {
              body: {
                movies: [
                  { watched_at: "2026-10-01T00:00:00Z", movie: { ids: { imdb: "tt0113277" } } },
                ],
              },
            }
          : { body: { movies: [], pagination: { next_cursor: "next" } } }
      return { body: url.pathname === "/sync/playback" ? [] : {} }
    })
    const mdblistLibrary = await createMdblist(mdblist.fetchImpl).pull({ token: "key" }, null)
    expect(mdblistLibrary.watched.map((item) => item.ref)).toEqual([
      { type: "movie", imdb: "tt0113277" },
    ])
  })
})
