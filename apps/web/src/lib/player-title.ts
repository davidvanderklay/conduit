import type { ProgressMetadata } from "./api"

export interface PlayerHeading {
  primary: string
  secondary?: string
}

export function playerHeading(metadata: ProgressMetadata): PlayerHeading {
  if (metadata.mediaType !== "series") return { primary: metadata.name }

  const episodeNumber =
    metadata.season !== undefined && metadata.episode !== undefined
      ? `S${metadata.season} E${metadata.episode}`
      : metadata.episode !== undefined
        ? `E${metadata.episode}`
        : metadata.season !== undefined
          ? `S${metadata.season}`
          : undefined
  const secondary = [episodeNumber, metadata.videoTitle].filter(Boolean).join(" · ")
  return {
    primary: metadata.name,
    ...(secondary ? { secondary } : {}),
  }
}

export function nativeMediaTitle(metadata: ProgressMetadata): string {
  const heading = playerHeading(metadata)
  return heading.secondary ? `${heading.primary} — ${heading.secondary}` : heading.primary
}
