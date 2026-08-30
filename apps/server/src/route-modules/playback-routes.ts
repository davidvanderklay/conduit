import { Type } from "@sinclair/typebox"
import type { FastifyInstance } from "fastify"

const INTRODB_SEGMENTS_URL = "https://api.introdb.app/segments"

type SegmentsResponse = {
  intro?: unknown
  recap?: unknown
  outro?: unknown
}

const emptySegments = {
  intro: null,
  recap: null,
  outro: null,
}

export function registerPlaybackRoutes(app: FastifyInstance) {
  app.get(
    "/v1/playback/skip-segments",
    {
      schema: {
        querystring: Type.Object({
          imdbId: Type.String({ pattern: "^tt[0-9]+$", maxLength: 32 }),
          season: Type.Integer({ minimum: 1, maximum: 10000 }),
          episode: Type.Integer({ minimum: 1, maximum: 10000 }),
        }),
      },
    },
    async (request) => {
      const { imdbId, season, episode } = request.query as {
        imdbId: string
        season: number
        episode: number
      }
      const url = new URL(INTRODB_SEGMENTS_URL)
      url.searchParams.set("imdb_id", imdbId)
      url.searchParams.set("season", String(season))
      url.searchParams.set("episode", String(episode))

      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(5_000),
        })
        if (!response.ok) return emptySegments
        const body: unknown = await response.json()
        return isSegmentsResponse(body) ? body : emptySegments
      } catch {
        return emptySegments
      }
    },
  )
}

function isSegmentsResponse(value: unknown): value is SegmentsResponse {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
