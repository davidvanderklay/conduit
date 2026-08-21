import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  rankAutoStreams,
  selectSavedStream,
  selectSingleAutoStream,
  streamPlaybackSource,
} from "@conduit/core"

interface Fixture {
  name: string
  operation: string
  request: Record<string, unknown>
  expected: Record<string, unknown>
}

const fixturesDir = fileURLToPath(
  new URL("../../../../packages/core/fixtures/stream-selection", import.meta.url),
)

const fixtures: Fixture[] = readdirSync(fixturesDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(`${fixturesDir}/${name}`, "utf8")) as Fixture)

function run(operation: string, request: Record<string, unknown>): unknown {
  switch (operation) {
    case "playbackSource":
      return {
        playbackSource: streamPlaybackSource(request.addonId as string, request.stream),
      }
    case "selectSavedStream": {
      const index = selectSavedStream(request.sources, request.saved ?? null)
      return { index: typeof index === "number" ? index : null }
    }
    case "selectSingleAutoStream": {
      const index = selectSingleAutoStream(request.sources, request.excluded ?? null)
      return { index: typeof index === "number" ? index : null }
    }
    case "rankAutoStreams":
      return {
        order: rankAutoStreams(
          request.sources,
          request.previous ?? null,
          request.saved ?? null,
          request.device ?? null,
        ) as number[],
      }
    default:
      throw new Error(`unknown operation ${operation}`)
  }
}

describe("stream selection golden fixtures", () => {
  it("keeps the WASM engine aligned with the shared fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0)
    for (const fixture of fixtures) {
      expect(run(fixture.operation, fixture.request), fixture.name).toEqual(fixture.expected)
    }
  })
})
