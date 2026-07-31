import { describe, expect, it } from "vitest"
import { decryptSecret } from "./crypto.js"
import { DEFAULT_ADDONS, defaultAddonInstallations } from "./default-addons.js"

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
})
