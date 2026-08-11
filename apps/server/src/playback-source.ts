export type PlaybackSourceKind = "url" | "torrent" | "other"

export interface PlaybackSource {
  addonId: string
  sourceKey: string
  kind: PlaybackSourceKind
  infoHash?: string
  fileIdx?: string
  name?: string
  title?: string
  filename?: string
  bingeGroup?: string
}
