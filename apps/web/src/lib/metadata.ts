import type { WatchProgress } from "./api"
import type { CatalogItem, MetaItem, Trailer, TrailerStream, Video } from "./core"

const TEXT_LIMIT = 12_000

function text(value: unknown, limit = TEXT_LIMIT): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const normalized = String(value).replaceAll(String.fromCharCode(0), "").trim().slice(0, limit)
  return normalized || undefined
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function stringList(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : []
  const normalized = values.flatMap((entry) => {
    const result = text(entry, 180)
    return result ? [result] : []
  })
  return normalized.length ? [...new Set(normalized)].slice(0, 80) : undefined
}

export function safeExternalUrl(value: unknown): string | undefined {
  const candidate = text(value, 4_000)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined
  } catch {
    return undefined
  }
}

function imageUrl(value: unknown): string | undefined {
  return safeExternalUrl(value)
}

function normalizeVideo(value: unknown, index: number): Video | undefined {
  if (!value || typeof value !== "object") return undefined
  const raw = value as Record<string, unknown>
  const id = text(raw.id, 1_000)
  if (!id) return undefined
  const title = text(raw.title ?? raw.name, 500)
  const overview = text(raw.overview ?? raw.description)
  return {
    id,
    title: title ?? `Episode ${number(raw.episode) ?? index + 1}`,
    season: number(raw.season),
    episode: number(raw.episode),
    released: text(raw.released ?? raw.airDate, 100),
    thumbnail: imageUrl(raw.thumbnail ?? raw.poster),
    overview,
    description: overview,
    runtime: text(raw.runtime, 100),
    available: typeof raw.available === "boolean" ? raw.available : undefined,
  }
}

function normalizeTrailers(value: unknown): Trailer[] | undefined {
  if (!Array.isArray(value)) return undefined
  const trailers = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const raw = entry as Record<string, unknown>
    const source = text(raw.source, 100)
    if (!source) return []
    return [{ source, type: text(raw.type, 100) }]
  })
  return trailers.length ? trailers.slice(0, 20) : undefined
}

function normalizeTrailerStreams(value: unknown): TrailerStream[] | undefined {
  if (!Array.isArray(value)) return undefined
  const trailers = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const raw = entry as Record<string, unknown>
    const youtubeId = text(raw.youtubeId, 100)
    if (!youtubeId || !/^[\w-]{6,}$/.test(youtubeId)) return []
    return [{ youtubeId, title: text(raw.title, 300) }]
  })
  return trailers.length ? trailers.slice(0, 20) : undefined
}

export function normalizeMetaItem(value: unknown, fallback: CatalogItem): MetaItem {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const rawVideos = Array.isArray(raw.videos) ? raw.videos : []
  const videos = rawVideos.flatMap((video, index) => {
    const normalized = normalizeVideo(video, index)
    return normalized ? [normalized] : []
  })
  const releaseInfo = text(raw.releaseInfo ?? raw.year, 100) ?? text(fallback.releaseInfo, 100)
  const contentRating = text(
    raw.contentRating ?? raw.certification ?? raw.ageRating,
    100,
  )

  return {
    id: text(raw.id, 1_000) ?? fallback.id,
    type: text(raw.type, 100) ?? fallback.type,
    name: text(raw.name ?? raw.title, 500) ?? fallback.name,
    poster: imageUrl(raw.poster) ?? imageUrl(fallback.poster),
    background: imageUrl(raw.background) ?? imageUrl(fallback.background),
    logo: imageUrl(raw.logo),
    defaultVideoId: text(raw.defaultVideoId, 1_000),
    description: text(raw.description ?? raw.overview) ?? text(fallback.description),
    releaseInfo,
    runtime: text(raw.runtime, 100) ?? text(fallback.runtime, 100),
    genres: stringList(raw.genres) ?? stringList(fallback.genres),
    imdbRating: text(raw.imdbRating ?? raw.rating, 40),
    contentRating,
    director: stringList(raw.director ?? raw.directors),
    cast: stringList(raw.cast),
    writer: stringList(raw.writer ?? raw.writers),
    country: text(raw.country, 200),
    awards: text(raw.awards, 1_000),
    released: text(raw.released, 100),
    trailers: normalizeTrailers(raw.trailers),
    trailerStreams: normalizeTrailerStreams(raw.trailerStreams),
    videos,
  }
}

export function episodeLabel(video: Video): string {
  if (video.season === 0) {
    return video.episode != null ? `Special ${video.episode}` : "Special"
  }
  if (video.season != null && video.episode != null) {
    return `S${video.season} E${video.episode}`
  }
  if (video.episode != null) return `Episode ${video.episode}`
  return "Episode"
}

export function eligibleSeriesVideos(videos: Video[], now = new Date()): Video[] {
  return numberedSeriesVideos(videos, now)
    .filter((video) => video.season! > 0)
    .sort((a, b) =>
      (a.season! - b.season!) ||
      (a.episode! - b.episode!) ||
      a.id.localeCompare(b.id))
}

function numberedSeriesVideos(videos: Video[], now: Date): Video[] {
  return videos.filter((video) => {
    const release = video.released ? Date.parse(video.released) : Number.NaN
    return video.available !== false &&
      video.season != null &&
      video.season >= 0 &&
      video.episode != null &&
      (Number.isNaN(release) || release <= now.getTime())
  })
}

function playableSeriesVideos(videos: Video[], now: Date): Video[] {
  const regular = eligibleSeriesVideos(videos, now)
  if (regular.length > 0) return regular
  return numberedSeriesVideos(videos, now).sort((a, b) =>
    (a.season! - b.season!) ||
    (a.episode! - b.episode!) ||
    a.id.localeCompare(b.id))
}

function matchesVideo(progress: WatchProgress, video: Video): boolean {
  if (
    progress.season != null &&
    progress.episode != null &&
    video.season != null &&
    video.episode != null
  ) {
    return video.season === progress.season && video.episode === progress.episode
  }
  return progress.videoId === video.id
}

function progressVideo(videos: Video[], progress: WatchProgress): Video | undefined {
  return videos.find((video) => matchesVideo(progress, video))
}

export function progressForVideo(
  progress: WatchProgress[],
  video: Video,
  mediaId?: string,
): WatchProgress | undefined {
  return progress
    .filter((entry) =>
      entry.mediaType === "series" &&
      (mediaId == null
        ? entry.videoId === video.id
        : entry.mediaId === mediaId && matchesVideo(entry, video)),
    )
    .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))[0]
}

/** Finds the progress row for a media item, including episode-coordinate aliases. */
export function progressForMediaVideo(
  progress: WatchProgress[],
  mediaType: string,
  mediaId: string,
  videoId: string,
  video?: Video,
): WatchProgress | undefined {
  const entries = progress.filter(
    (entry) => entry.mediaType === mediaType && entry.mediaId === mediaId,
  )
  if (mediaType === "series" && video) return progressForVideo(entries, video, mediaId)
  return entries
    .filter((entry) => entry.videoId === videoId)
    .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))[0]
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function progressOrder(videos: Video[], progress: WatchProgress): [number, number, number, string] {
  const video = progressVideo(videos, progress)
  return [
    video?.season ?? progress.season ?? -1,
    video?.episode ?? progress.episode ?? -1,
    timestamp(progress.updatedAt),
    progress.videoId,
  ]
}

function compareProgress(videos: Video[], left: WatchProgress, right: WatchProgress): number {
  const a = progressOrder(videos, left)
  const b = progressOrder(videos, right)
  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || a[3].localeCompare(b[3])
}

function latestUnfinishedProgress(videos: Video[], progress: WatchProgress[]): WatchProgress | undefined {
  return progress
    .filter((entry) =>
      entry.mediaType === "series" &&
      !entry.watched &&
      entry.positionMs >= 1_000,
    )
    .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))[0]
}

function latestCompletedProgress(videos: Video[], progress: WatchProgress[]): WatchProgress | undefined {
  return progress
    .filter((entry) =>
      entry.mediaType === "series" &&
      entry.watched &&
      (progressVideo(videos, entry) != null || (entry.season != null && entry.episode != null)),
    )
    .sort((a, b) => compareProgress(videos, b, a))[0]
}

function firstEpisodeInSeason(videos: Video[], season: number): Video | undefined {
  return videos
    .filter((video) => video.season === season)
    .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))[0]
}

export function selectSeriesVideo(
  videos: Video[],
  progress: WatchProgress[],
  preferredVideoId?: string,
  now = new Date(),
  defaultVideoId?: string,
): Video | undefined {
  const eligible = eligibleSeriesVideos(videos, now)
  const preferredProgress = preferredVideoId
    ? progress.find((entry) => entry.videoId === preferredVideoId)
    : undefined
  const preferred = preferredVideoId && (
    preferredProgress
      ? progressVideo(videos, preferredProgress) ??
        (preferredProgress.season != null
          ? firstEpisodeInSeason(videos, preferredProgress.season) ?? playableSeriesVideos(videos, now)[0]
          : videos.find((video) => video.id === preferredVideoId))
      : videos.find((video) => video.id === preferredVideoId)
  )
  if (preferred) return preferred

  const unfinished = latestUnfinishedProgress(videos, progress)
  const completed = latestCompletedProgress(videos, progress)
  if (unfinished && (!completed || timestamp(unfinished.updatedAt) > timestamp(completed.updatedAt))) {
    return progressVideo(videos, unfinished) ??
      (unfinished.season != null
        ? firstEpisodeInSeason(videos, unfinished.season) ?? playableSeriesVideos(videos, now)[0]
        : playableSeriesVideos(videos, now)[0])
  }
  if (completed) {
    const next = nextSeriesVideo(videos, completed.videoId, progress, now)
    if (next) return next
    return eligible[0] ?? playableSeriesVideos(videos, now)[0]
  }

  const playable = playableSeriesVideos(videos, now)
  const defaultVideo = defaultVideoId
    ? numberedSeriesVideos(videos, now).find((video) => video.id === defaultVideoId)
    : undefined
  return defaultVideo ?? playable[0]
}

export function nextSeriesVideo(
  videos: Video[],
  currentVideoId: string,
  progress: WatchProgress[],
  now = new Date(),
): Video | undefined {
  const eligible = eligibleSeriesVideos(videos, now)
  const currentProgress = progress.find((entry) => entry.videoId === currentVideoId)
  const current = (currentProgress ? progressVideo(videos, currentProgress) : undefined) ??
    videos.find((video) => video.id === currentVideoId) ??
    currentProgress
  const season = current?.season
  const episode = current?.episode
  if (season == null || episode == null) return undefined
  return eligible.find((video) =>
    (video.season! > season || (video.season === season && video.episode! > episode)) &&
    !progress.some((entry) => entry.watched && matchesVideo(entry, video)),
  )
}

export function adjacentSeriesVideo(
  videos: Video[],
  currentVideoId: string,
  direction: -1 | 1,
  now = new Date(),
): Video | undefined {
  const eligible = eligibleSeriesVideos(videos, now)
  const current = eligible.find((video) => video.id === currentVideoId)
  if (!current) return undefined
  if (direction === 1) {
    return eligible.find((video) => compareEpisodeCoordinates(video, current) > 0)
  }
  return eligible
    .filter((video) => compareEpisodeCoordinates(video, current) < 0)
    .at(-1)
}

function compareEpisodeCoordinates(a: Video, b: Video): number {
  return a.season! - b.season! || a.episode! - b.episode!
}

export function sortSeasons(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => {
    if (a === 0) return 1
    if (b === 0) return -1
    return a - b
  })
}

export function seasonLabel(season: number): string {
  return season === 0 ? "Specials" : `Season ${season}`
}

export function displayDate(value?: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date)
}

export function trailerUrl(meta: MetaItem): string | undefined {
  const id = meta.trailerStreams?.find((trailer) => trailer.youtubeId)?.youtubeId
    ?? meta.trailers?.find((trailer) => trailer.source)?.source
  if (!id) return undefined
  return safeExternalUrl(id) ?? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
}
