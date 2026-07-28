import { describe, expect, it } from "vitest"
import { requestHeaders, type AddonManifest } from "./api"

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

  it("does not describe a bodyless delete as JSON", () => {
    const headers = requestHeaders({ method: "DELETE" })

    expect(headers.has("content-type")).toBe(false)
  })

  it("marks request bodies as JSON by default", () => {
    const headers = requestHeaders({ method: "POST", body: "{}" })

    expect(headers.get("content-type")).toBe("application/json")
  })
})
