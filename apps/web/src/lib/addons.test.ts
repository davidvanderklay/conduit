import { describe, expect, it } from "vitest"
import { supportsResource } from "./addons"
import type { AddonManifest } from "./api"

const manifest: AddonManifest = {
  id: "org.example",
  version: "1",
  name: "Example",
  resources: ["catalog", { name: "stream", types: ["movie"], idPrefixes: ["tt"] }],
  types: ["movie"],
  catalogs: [],
}

describe("add-on capability matching", () => {
  it("matches simple resources", () => {
    expect(supportsResource(manifest, "catalog", "series", "anything")).toBe(true)
  })

  it("applies stream type and id prefix constraints", () => {
    expect(supportsResource(manifest, "stream", "movie", "tt123")).toBe(true)
    expect(supportsResource(manifest, "stream", "series", "tt123")).toBe(false)
    expect(supportsResource(manifest, "stream", "movie", "kitsu:123")).toBe(false)
  })
})
