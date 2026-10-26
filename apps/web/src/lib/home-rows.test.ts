import { describe, expect, it } from "vitest"
import type { InstalledAddon } from "./api"
import { arrangeHomeRows, homeRowSettings } from "./home-rows"

function addon(id: string, enabled = true): InstalledAddon {
  return {
    id,
    manifestId: "cinemeta",
    manifestUrl: `https://${id}.example/manifest.json`,
    position: 0,
    enabled,
    manifest: {
      id: "cinemeta",
      version: "1",
      name: "Cinemeta",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [
        { id: "top", type: "movie", name: "Popular" },
        { id: "top", type: "series", name: "Popular" },
        { id: "search", type: "movie", extra: [{ name: "search", isRequired: true }] },
      ],
    },
  }
}

describe("home rows", () => {
  it("applies saved settings to one copy of each add-on catalog", () => {
    const rows = arrangeHomeRows(
      [addon("first"), addon("second")],
      [{ key: "cinemeta:series:top", enabled: false, title: "Shows" }],
    )
    expect(rows.map((row) => [row.key, row.title, row.enabled, row.addonId])).toEqual([
      ["cinemeta:series:top", "Shows", false, "first"],
      ["cinemeta:movie:top", "Popular - Movie", true, "first"],
    ])
  })

  it("saves edits without losing choices for unavailable catalogs", () => {
    const previous = [
      { key: "cinemeta:movie:top", enabled: true, title: "Films" },
      { key: "other:movie:new", enabled: false },
    ]
    const rows = arrangeHomeRows([addon("first")], previous)
    const edited = rows.map((row) => ({ ...row, title: row.defaultTitle }))
    expect(homeRowSettings(edited, previous)).toEqual([
      { key: "cinemeta:movie:top", enabled: true },
      { key: "cinemeta:series:top", enabled: true },
      { key: "other:movie:new", enabled: false },
    ])
  })
})
