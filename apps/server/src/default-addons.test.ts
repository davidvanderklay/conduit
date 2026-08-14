import { describe, expect, it } from "vitest"
import { decryptSecret } from "./crypto.js"
import {
  DEFAULT_ADDONS,
  defaultAddonInstallations,
  enrichDefaultManifest,
} from "./default-addons.js"

describe("default add-ons", () => {
  it("installs Cinemeta and OpenSubtitles v3 in that order", () => {
    const key = Buffer.alloc(32)
    const installations = defaultAddonInstallations("profile-id", key)

    expect(installations.map((addon) => addon.manifestId)).toEqual([
      "com.linvo.cinemeta",
      "org.stremio.opensubtitlesv3",
    ])
    expect(installations.map((addon) => addon.position)).toEqual([0, 1])
    expect(installations.every((addon) => addon.enabled)).toBe(true)
    expect(
      installations.map((addon) => decryptSecret(addon.manifestUrlEncrypted, key)),
    ).toEqual(DEFAULT_ADDONS.map((addon) => addon.manifestUrl))
  })

  it("includes selectable Cinemeta genres in the default manifest snapshot", () => {
    expect(DEFAULT_ADDONS[0].manifest.catalogs[0].extra[0].options).toContain("Drama")
    expect(DEFAULT_ADDONS[0].manifest.catalogs[1].extra[0].options).toContain("Reality-TV")
  })

  it("backfills genres for profiles with an older Cinemeta snapshot", () => {
    const manifest = enrichDefaultManifest({
      id: "com.linvo.cinemeta",
      catalogs: [{ id: "top", type: "movie", extra: [{ name: "genre" }] }],
    })

    expect((manifest.catalogs as Array<Record<string, unknown>>)[0]?.extra).toEqual([
      { name: "genre", options: expect.arrayContaining(["Action", "Drama"]) },
    ])
  })
})
