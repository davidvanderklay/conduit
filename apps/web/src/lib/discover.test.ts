import { describe, expect, it } from "vitest"
import { genreFilterOptions } from "./discover"

describe("discover genre filters", () => {
  it("keeps an unenumerated genre filter available", () => {
    expect(genreFilterOptions({})).toEqual([["", "All genres"]])
  })

  it("exposes the manifest genre options after all genres", () => {
    expect(genreFilterOptions({ options: ["Drama", "Comedy"] })).toEqual([
      ["", "All genres"],
      ["Drama", "Drama"],
      ["Comedy", "Comedy"],
    ])
  })

  it("reports unavailable when the catalog has no genre extra", () => {
    expect(genreFilterOptions(undefined)).toEqual([["", "Not available"]])
  })
})
