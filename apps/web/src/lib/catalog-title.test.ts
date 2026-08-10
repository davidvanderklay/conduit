import { describe, expect, it } from "vitest"
import { formatCatalogTitle, mediaTypeLabel } from "./catalog-title"

describe("catalog titles", () => {
  it("labels movie and series rails explicitly", () => {
    expect(formatCatalogTitle("Popular", "movie")).toBe("Popular - Movie")
    expect(formatCatalogTitle("Popular", "series")).toBe("Popular - Series")
  })

  it("does not duplicate an existing type suffix", () => {
    expect(formatCatalogTitle("Popular - Movie", "movie")).toBe("Popular - Movie")
    expect(formatCatalogTitle("Series", "series")).toBe("Series")
  })

  it("capitalizes unknown catalog types for display", () => {
    expect(mediaTypeLabel("channel")).toBe("Channel")
  })
})
