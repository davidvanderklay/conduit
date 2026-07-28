import { describe, expect, it } from "vitest"
import type { AddonManifest } from "./api"

describe("add-on manifest contract", () => {
  it("retains configured catalog descriptors", () => {
    const manifest: AddonManifest = {
      id: "org.example",
      version: "1",
      name: "Example",
      resources: ["catalog"],
      types: ["movie"],
      catalogs: [{ id: "popular", type: "movie", name: "Popular" }],
    }

    expect(manifest.catalogs[0]?.name).toBe("Popular")
  })
})
