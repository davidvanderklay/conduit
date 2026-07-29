import { describe, expect, it, vi } from "vitest"
import type { InstalledAddon } from "./api"
import { searchAddons, searchableCatalogs } from "./search"

function addon(
  id: string,
  options: { enabled?: boolean; searchable?: boolean; type?: string } = {},
): InstalledAddon {
  return {
    id,
    manifestId: `org.${id}`,
    manifestUrl: `https://${id}.example/manifest.json`,
    position: 0,
    enabled: options.enabled ?? true,
    manifest: {
      id: `org.${id}`,
      version: "1",
      name: id,
      resources: ["catalog"],
      types: [options.type ?? "movie"],
      catalogs: [
        {
          id: "search",
          type: options.type ?? "movie",
          extra: options.searchable === false ? [] : [{ name: "search", isRequired: true }],
        },
      ],
    },
  }
}

describe("global add-on search", () => {
  it("only discovers enabled catalogs with a search extra", () => {
    const requiresGenre = addon("requires-genre")
    requiresGenre.manifest.catalogs[0]?.extra?.push({ name: "genre", isRequired: true })
    expect(
      searchableCatalogs([
        addon("ready"),
        addon("disabled", { enabled: false }),
        addon("browse-only", { searchable: false }),
        requiresGenre,
      ]).map(({ addon: item }) => item.id),
    ).toEqual(["ready"])
  })

  it("queries concurrently, de-duplicates, attributes sources, and tolerates failures", async () => {
    const load = vi.fn(async (url: string) => {
      if (url.includes("broken")) throw new Error("offline")
      return [
        { id: "tt0133093", type: "movie", name: "The Matrix" },
        ...(url.includes("second")
          ? [{ id: "tt0242653", type: "movie", name: "The Matrix Revolutions" }]
          : []),
      ]
    })

    const response = await searchAddons(
      [addon("first"), addon("broken"), addon("second")],
      "matrix",
      { load, timeoutMs: 50 },
    )

    expect(load).toHaveBeenCalledTimes(3)
    expect(load).toHaveBeenCalledWith(
      "https://first.example/manifest.json",
      "movie",
      "search",
      [{ name: "search", value: "matrix" }],
    )
    expect(response.failedSources).toBe(1)
    expect(response.results).toHaveLength(2)
    expect(response.results[0]?.sources.map((source) => source.addonId)).toEqual([
      "first",
      "second",
    ])
  })
})
