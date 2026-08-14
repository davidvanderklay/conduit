import { encryptSecret, stableSecretHash } from "./crypto.js"

const CINEMETA_MOVIE_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Biography",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Sport",
  "Thriller",
  "War",
  "Western",
]

const CINEMETA_SERIES_GENRES = [...CINEMETA_MOVIE_GENRES, "Reality-TV", "Talk-Show", "Game-Show"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const DEFAULT_ADDONS = [
  {
    manifestUrl: "https://v3-cinemeta.strem.io/manifest.json",
    manifest: {
      id: "com.linvo.cinemeta",
      version: "3.0.14",
      name: "Cinemeta",
      description: "The official addon for movie and series catalogs",
      resources: ["catalog", "meta", "addon_catalog"],
      types: ["movie", "series"],
      idPrefixes: ["tt"],
      catalogs: [
        {
          type: "movie",
          id: "top",
          name: "Popular",
          extra: [
            { name: "genre", options: CINEMETA_MOVIE_GENRES },
            { name: "search" },
            { name: "skip" },
          ],
          extraSupported: ["search", "genre", "skip"],
        },
        {
          type: "series",
          id: "top",
          name: "Popular",
          extra: [
            { name: "genre", options: CINEMETA_SERIES_GENRES },
            { name: "search" },
            { name: "skip" },
          ],
          extraSupported: ["search", "genre", "skip"],
        },
        {
          type: "movie",
          id: "imdbRating",
          name: "Featured",
          extra: [{ name: "genre", options: CINEMETA_MOVIE_GENRES }, { name: "skip" }],
          extraSupported: ["genre", "skip"],
        },
        {
          type: "series",
          id: "imdbRating",
          name: "Featured",
          extra: [{ name: "genre", options: CINEMETA_SERIES_GENRES }, { name: "skip" }],
          extraSupported: ["genre", "skip"],
        },
      ],
      behaviorHints: { newEpisodeNotifications: true },
    },
  },
  {
    manifestUrl: "https://opensubtitles-v3.strem.io/manifest.json",
    manifest: {
      id: "org.stremio.opensubtitlesv3",
      version: "1.0.0",
      name: "OpenSubtitles v3",
      description: "OpenSubtitles v3 Addon for Stremio",
      catalogs: [],
      resources: ["subtitles"],
      types: ["movie", "series"],
      idPrefixes: ["tt"],
      logo: "https://www.strem.io/images/addons/opensubtitles-logo.png",
    },
  },
] as const

/**
 * Default add-ons are stored as manifest snapshots. Backfill fields added to
 * the built-in snapshot so profiles created before that change get the same
 * catalog filters as new profiles without rewriting their database rows.
 */
export function enrichDefaultManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  if (manifest.id !== DEFAULT_ADDONS[0].manifest.id || !Array.isArray(manifest.catalogs)) {
    return manifest
  }

  let changed = false
  const catalogs = manifest.catalogs.map((rawCatalog) => {
    if (!isRecord(rawCatalog)) return rawCatalog
    const id = typeof rawCatalog.id === "string" ? rawCatalog.id : ""
    const type = typeof rawCatalog.type === "string" ? rawCatalog.type : ""
    const isBuiltInCatalog = DEFAULT_ADDONS[0].manifest.catalogs.some(
      (catalog) => catalog.id === id && catalog.type === type,
    )
    if (!isBuiltInCatalog || !Array.isArray(rawCatalog.extra)) return rawCatalog

    const options = type === "series" ? CINEMETA_SERIES_GENRES : CINEMETA_MOVIE_GENRES
    let catalogChanged = false
    const extra = rawCatalog.extra.map((rawExtra) => {
      if (!isRecord(rawExtra) || rawExtra.name !== "genre") return rawExtra
      if (Array.isArray(rawExtra.options) && rawExtra.options.length > 0) return rawExtra
      catalogChanged = true
      return { ...rawExtra, options }
    })
    if (!catalogChanged) return rawCatalog

    changed = true
    return { ...rawCatalog, extra }
  })

  return changed ? { ...manifest, catalogs } : manifest
}

export function defaultAddonInstallations(profileId: string, encryptionKey: Buffer) {
  return DEFAULT_ADDONS.map((addon, position) => ({
    profileId,
    manifestId: addon.manifest.id,
    manifestUrlEncrypted: encryptSecret(addon.manifestUrl, encryptionKey),
    manifestUrlHash: stableSecretHash(addon.manifestUrl, encryptionKey),
    manifest: addon.manifest,
    position,
    enabled: true,
  }))
}
