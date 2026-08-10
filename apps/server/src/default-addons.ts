import { encryptSecret, stableSecretHash } from "./crypto.js"

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
          extra: [{ name: "genre" }, { name: "search" }, { name: "skip" }],
          extraSupported: ["search", "genre", "skip"],
        },
        {
          type: "series",
          id: "top",
          name: "Popular",
          extra: [{ name: "genre" }, { name: "search" }, { name: "skip" }],
          extraSupported: ["search", "genre", "skip"],
        },
        {
          type: "movie",
          id: "imdbRating",
          name: "Featured",
          extra: [{ name: "genre" }, { name: "skip" }],
          extraSupported: ["genre", "skip"],
        },
        {
          type: "series",
          id: "imdbRating",
          name: "Featured",
          extra: [{ name: "genre" }, { name: "skip" }],
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
