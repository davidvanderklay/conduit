import { deflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import {
  connectMigrationSource,
  decodeStremioWatched,
  readMigrationSource,
  sortStremioVideos,
} from "./migration-sources.js"

const now = new Date("2026-01-01T00:00:00.000Z")

/** Builds a Stremio watched field the way stremio-core serializes it. */
function watchedField(bits: boolean[], videoIds: string[]) {
  const bytes = Buffer.alloc(Math.ceil(bits.length / 8))
  bits.forEach((bit, index) => {
    if (bit) bytes[index >> 3]! |= 1 << (index % 8)
  })
  const last = bits.lastIndexOf(true)
  return `${videoIds[last]}:${last + 1}:${deflateSync(bytes).toString("base64")}`
}

/** Routes fake fetch calls by URL and records the requests. */
function fakeFetch(routes: Record<string, (body: unknown) => unknown>) {
  const calls: Array<{ url: string; body: unknown; headers: Headers }> = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
    calls.push({ url, body, headers: new Headers(init?.headers) })
    const route = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => url.startsWith(prefix))
    if (!route) return new Response("not found", { status: 404 })
    const result = routes[route]!(body)
    return result instanceof Response ? result : Response.json(result)
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe("stremio watched bitfield", () => {
  const episodes = ["tt1:1:1", "tt1:1:2", "tt1:1:3", "tt1:2:1"]

  it("decodes watched episodes against the current episode list", () => {
    const field = watchedField([true, false, true], episodes)
    expect(decodeStremioWatched(field, episodes)).toEqual(["tt1:1:1", "tt1:1:3"])
  })

  it("realigns bits when episodes were added before the anchor", () => {
    const field = watchedField([true, true], episodes)
    expect(decodeStremioWatched(field, ["tt1:0:1", ...episodes])).toEqual(["tt1:1:1", "tt1:1:2"])
  })

  it("rejects malformed values", () => {
    expect(decodeStremioWatched("garbage", episodes)).toBeUndefined()
    expect(decodeStremioWatched("tt1:1:1:x:!!!", episodes)).toBeUndefined()
  })

  it("orders videos by season, episode, then release like stremio-core", () => {
    expect(
      sortStremioVideos([
        { id: "b", season: 1, episode: 2 },
        { id: "a", season: 1, episode: 1 },
        { id: "s", season: 0, episode: 1 },
        { id: "a", season: 1, episode: 1 },
      ]),
    ).toEqual(["s", "a", "b"])
  })
})

describe("stremio migration", () => {
  const breakingBad = ["tt0903747:1:1", "tt0903747:1:2", "tt0903747:1:3"]
  const stremio = () =>
    fakeFetch({
      "https://api.strem.io/api/login": () => ({
        result: { authKey: "key", user: { email: "a@b.c" } },
      }),
      "https://api.strem.io/api/datastoreGet": () => ({
        result: [
          {
            _id: "tt0903747",
            name: "Breaking Bad",
            type: "series",
            _ctime: "2024-01-01T00:00:00.000Z",
            _mtime: "2024-02-01T00:00:00.000Z",
            state: {
              lastWatched: "2024-02-01T00:00:00.000Z",
              timeOffset: 60_000,
              duration: 3_000_000,
              video_id: "tt0903747:1:3",
              watched: watchedField([true, true], breakingBad),
            },
          },
          {
            _id: "tt0111161",
            name: "Removed but watched",
            type: "movie",
            removed: true,
            _mtime: "2023-01-01T00:00:00.000Z",
            state: { timesWatched: 1, duration: 8_000_000 },
          },
          { _id: "tt999", name: "Preview", type: "movie", temp: true, state: {} },
          { _id: "yt:abc", name: "Channel", type: "channel", state: {} },
        ],
      }),
      "https://api.strem.io/api/addonCollectionGet": () => ({
        result: {
          addons: [
            {
              transportUrl: "https://torrentio.example/config/manifest.json",
              manifest: {
                id: "torrentio",
                name: "Torrentio",
                idPrefixes: null,
                catalogs: [{ id: "top", type: "movie", extra: null }],
              },
            },
            {
              transportUrl: "http://127.0.0.1:11470/local-addon/manifest.json",
              manifest: { id: "local", name: "Local" },
              flags: { protected: true },
            },
          ],
        },
      }),
      "https://v3-cinemeta.strem.io/meta/series/tt0903747.json": () => ({
        meta: { videos: breakingBad.map((id, index) => ({ id, season: 1, episode: index + 1 })) },
      }),
    })

  it("signs in and reads library, resume points, history, and add-ons", async () => {
    const { fetchImpl } = stremio()
    const account = await connectMigrationSource(
      { source: "stremio", email: "a@b.c", password: "pw" },
      fetchImpl,
    )
    expect(account).toEqual({
      session: { source: "stremio", authKey: "key" },
      email: "a@b.c",
      profiles: [{ id: "default", name: "Stremio" }],
    })

    const snapshot = await readMigrationSource(account.session, "default", fetchImpl, now)
    expect(snapshot.counts).toEqual({ library: 1, continueWatching: 1, watched: 3, addons: 1 })
    expect(snapshot.data.library).toEqual([
      expect.objectContaining({ mediaType: "series", mediaId: "tt0903747", name: "Breaking Bad" }),
    ])
    expect(snapshot.data.progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          videoId: "tt0903747:1:3",
          season: 1,
          episode: 3,
          positionMs: 60_000,
          continueWatching: true,
          watched: false,
        }),
        expect.objectContaining({
          videoId: "tt0903747:1:1",
          watched: true,
          continueWatching: false,
        }),
        expect.objectContaining({ videoId: "tt0903747:1:2", watched: true }),
        expect.objectContaining({ videoId: "tt0111161", mediaType: "movie", watched: true }),
      ]),
    )
    expect(snapshot.data.addons).toEqual([
      expect.objectContaining({
        manifestId: "torrentio",
        manifestUrl: "https://torrentio.example/config/manifest.json",
        manifest: { id: "torrentio", name: "Torrentio", catalogs: [{ id: "top", type: "movie" }] },
      }),
    ])
    expect(snapshot.warnings).toEqual([expect.stringContaining("not movies or series")])
  })

  it("reports Stremio errors as bad requests", async () => {
    const { fetchImpl } = fakeFetch({
      "https://api.strem.io/api/login": () => ({ error: { code: 2, message: "User not found" } }),
    })
    await expect(
      connectMigrationSource({ source: "stremio", email: "a@b.c", password: "pw" }, fetchImpl),
    ).rejects.toMatchObject({ message: "Stremio: User not found", status: 400 })
  })
})

describe("nuvio migration", () => {
  const backend = "https://nuvio.example"
  const nuvio = () =>
    fakeFetch({
      [`${backend}/.well-known/nuvio`]: () => ({
        service: "nuvio",
        backend_url: backend,
        publishable_key: "anon",
      }),
      [`${backend}/auth/v1/token`]: () => ({ access_token: "jwt", user: { email: "a@b.c" } }),
      [`${backend}/rest/v1/rpc/sync_pull_profiles`]: () => [
        { profile_index: 2, name: "Kids", uses_primary_addons: true },
        { profile_index: 1, name: "Main" },
      ],
      [`${backend}/rest/v1/rpc/sync_pull_library`]: () => [
        { content_id: "tt1", content_type: "series", name: "Show", added_at: 1_700_000_000_000 },
      ],
      [`${backend}/rest/v1/rpc/sync_pull_watch_progress`]: () => [
        {
          content_id: "tt1",
          content_type: "series",
          video_id: "tt1:1:2",
          season: 1,
          episode: 2,
          position: 120_000,
          duration: 2_400_000,
          last_watched: 1_700_000_100_000,
        },
        { content_id: "tt2", content_type: "movie", video_id: "tt2", position: 0, duration: 0 },
      ],
      [`${backend}/rest/v1/rpc/sync_pull_watched_items`]: () => [
        {
          content_id: "tt1",
          content_type: "series",
          title: "Show",
          season: 1,
          episode: 1,
          watched_at: 20240102030405,
        },
        { content_id: "tt3", content_type: "movie", title: "Film", watched_at: 1_700_000_000_000 },
      ],
      [`${backend}/rest/v1/addons`]: () => [
        { url: "https://addon.example", enabled: true, sort_order: 0 },
        { url: "https://broken.example/manifest.json", enabled: true, sort_order: 1 },
      ],
      "https://addon.example/manifest.json": () => ({ id: "org.addon", name: "Addon" }),
      "https://broken.example/manifest.json": () => new Response("nope", { status: 500 }),
    })

  it("discovers the backend, signs in, and lists profiles", async () => {
    const { fetchImpl, calls } = nuvio()
    const account = await connectMigrationSource(
      { source: "nuvio", email: "a@b.c", password: "pw", backendUrl: `${backend}/` },
      fetchImpl,
    )
    expect(account).toEqual({
      session: { source: "nuvio", backendUrl: backend, publishableKey: "anon", accessToken: "jwt" },
      email: "a@b.c",
      profiles: [
        { id: "1", name: "Main" },
        { id: "2", name: "Kids" },
      ],
    })
    const token = calls.find((call) => call.url.includes("/auth/v1/token"))
    expect(token?.headers.get("apikey")).toBe("anon")
    expect(token?.body).toEqual({ email: "a@b.c", password: "pw" })
  })

  it("reads a profile and uses the primary profile's add-ons when shared", async () => {
    const { fetchImpl, calls } = nuvio()
    const session = {
      source: "nuvio" as const,
      backendUrl: backend,
      publishableKey: "anon",
      accessToken: "jwt",
    }
    const snapshot = await readMigrationSource(session, "2", fetchImpl, now)

    expect(calls.find((call) => call.url.includes("/rest/v1/addons"))?.url).toContain(
      "profile_id=eq.1",
    )
    expect(calls.find((call) => call.url.includes("sync_pull_library"))?.body).toMatchObject({
      p_profile_id: 2,
    })
    expect(snapshot.counts).toEqual({ library: 1, continueWatching: 1, watched: 2, addons: 1 })
    expect(snapshot.data.progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          videoId: "tt1:1:2",
          name: "Show",
          positionMs: 120_000,
          continueWatching: true,
        }),
        expect.objectContaining({
          videoId: "tt1:1:1",
          watched: true,
          updatedAt: "2024-01-02T03:04:05.000Z",
        }),
        expect.objectContaining({ videoId: "tt3", name: "Film", watched: true }),
      ]),
    )
    expect(snapshot.data.addons).toEqual([
      expect.objectContaining({
        manifestId: "org.addon",
        manifestUrl: "https://addon.example/manifest.json",
      }),
    ])
    expect(snapshot.warnings).toEqual([expect.stringContaining("did not return a manifest")])
  })

  it("refuses non-HTTPS servers", async () => {
    const { fetchImpl, calls } = nuvio()
    await expect(
      connectMigrationSource(
        { source: "nuvio", email: "a@b.c", password: "pw", backendUrl: "http://10.0.0.1" },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(calls).toHaveLength(0)
  })
})
