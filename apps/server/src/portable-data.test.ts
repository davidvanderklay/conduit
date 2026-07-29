import { describe, expect, it } from "vitest"
import { previewPortableData, validatePortableData } from "./portable-data.js"

const validArchive = {
  format: "conduit-profile",
  version: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  profile: { name: "Main", isKids: false },
  library: [{
    mediaType: "movie",
    mediaId: "tt123",
    name: "Example",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  }],
  progress: [{
    videoId: "tt123",
    mediaType: "movie",
    mediaId: "tt123",
    name: "Example",
    positionMs: 42,
    durationMs: 100,
    watched: false,
    updatedAt: "2025-01-02T00:00:00.000Z",
  }],
  addons: [{
    manifestId: "org.example",
    manifest: { id: "org.example", name: "Example" },
    position: 0,
    enabled: true,
  }],
}

describe("portable profile data", () => {
  it("validates a v1 export and warns about redacted add-ons", () => {
    const data = validatePortableData(validArchive)
    expect(previewPortableData(data)).toMatchObject({
      valid: true,
      counts: { library: 1, progress: 1, addons: 1 },
      importableAddons: 0,
      warnings: [expect.stringContaining("redacted")],
    })
  })

  it("rejects newer versions and duplicate media identifiers", () => {
    expect(() => validatePortableData({ ...validArchive, version: 2 })).toThrow(/newer/)
    expect(() =>
      validatePortableData({
        ...validArchive,
        library: [validArchive.library[0], validArchive.library[0]],
      }),
    ).toThrow(/duplicates/)
  })

  it("rejects invalid timestamps and unsafe add-on URL schemes", () => {
    expect(() =>
      validatePortableData({ ...validArchive, exportedAt: "yesterday" }),
    ).toThrow(/timestamp/)
    expect(() =>
      validatePortableData({
        ...validArchive,
        addons: [{ ...validArchive.addons[0], manifestUrl: "file:///secret" }],
      }),
    ).toThrow(/HTTP or HTTPS/)
  })
})
