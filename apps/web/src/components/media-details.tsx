import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  CirclePlay,
  Clock3,
  ExternalLink,
  Film,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  Star,
  X,
} from "lucide-react"
import { api, type InstalledAddon, type WatchProgress } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import {
  loadMeta,
  loadStreams,
  type CatalogItem,
  type MetaItem,
  type Stream,
  type Video,
} from "../lib/core"
import {
  adjacentSeriesVideo,
  displayDate,
  episodeLabel,
  normalizeMetaItem,
  safeExternalUrl,
  selectSeriesVideo,
  seasonLabel,
  sortSeasons,
  trailerUrl,
} from "../lib/metadata"
import { readPreferences } from "../lib/preferences"
import { Button } from "./ui/button"
import { Player } from "./player"
import { LibraryToggle } from "./library-toggle"

interface ResolvedStream extends Stream {
  key: string
  addonName: string
}

export type MetadataBrowseTarget =
  | { kind: "genre"; value: string; mediaType: string }
  | { kind: "search"; value: string }

export function MediaDetails({
  item,
  addons,
  profileId,
  initialVideoId,
  onBrowse,
  onClose,
}: {
  item: CatalogItem
  addons: InstalledAddon[]
  profileId: string
  initialVideoId?: string
  onBrowse?: (target: MetadataBrowseTarget) => void
  onClose: () => void
}) {
  const [selectedVideoId, setSelectedVideoId] = useState<string | undefined>(
    initialVideoId && initialVideoId !== item.id ? initialVideoId : undefined,
  )
  const [selectedSeason, setSelectedSeason] = useState<number>()
  const [playing, setPlaying] = useState<ResolvedStream>()
  const queryClient = useQueryClient()
  const episodeTransition = useRef(0)
  const initialSeriesVideoResolved = useRef(false)
  const episodeRailScrollTop = useRef<number | undefined>(undefined)
  const seriesReturnVideoId = useRef<string | undefined>(
    initialVideoId && initialVideoId !== item.id ? initialVideoId : undefined,
  )
  const metadata = useQuery({
    queryKey: ["meta", item.type, item.id, addons.map((addon) => addon.id)],
    queryFn: () => resolveMetadata(addons, item),
  })
  const meta = metadata.data ?? normalizeMetaItem(item, item)
  const videos = meta.videos ?? []
  const selectedVideo = videos.find((video) => video.id === selectedVideoId)
  const nextEpisode = selectedVideo
    ? adjacentSeriesVideo(videos, selectedVideo.id, 1)
    : undefined
  const episodeMode = item.type === "series" && Boolean(selectedVideo)
  const activeVideoId = episodeMode ? selectedVideoId : item.id
  const addonIds = addons.map((addon) => addon.id)
  const progress = useQuery({
    queryKey: ["series-progress", profileId, item.type, item.id],
    refetchOnMount: "always",
    queryFn: () =>
      api<{ items: WatchProgress[] }>(
        `/v1/profiles/${profileId}/progress?view=status&limit=1000`,
      ).then((result) => result.items),
  })
  const streams = useQuery({
    queryKey: ["streams", item.type, activeVideoId, addonIds],
    enabled: item.type !== "series" || episodeMode,
    queryFn: () => resolveStreams(addons, item.type, activeVideoId!),
    staleTime: 5 * 60 * 1000,
  })
  useQuery({
    queryKey: ["streams", item.type, nextEpisode?.id, addonIds],
    enabled: Boolean(playing && nextEpisode),
    queryFn: () => resolveStreams(addons, item.type, nextEpisode!.id),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (
      initialSeriesVideoResolved.current ||
      item.type !== "series" ||
      !metadata.isSuccess ||
      !progress.isSuccess ||
      !videos.length
    ) return
    initialSeriesVideoResolved.current = true
    const target = selectSeriesVideo(videos, progress.data ?? [], initialVideoId)
    setSelectedVideoId(target?.id)
    seriesReturnVideoId.current = target?.id
  }, [initialVideoId, item.type, metadata.isSuccess, progress.data, progress.isSuccess, videos])

  useEffect(() => {
    if (selectedVideo && selectedSeason == null) {
      setSelectedSeason(selectedVideo.season ?? 1)
      return
    }
    if (!selectedVideo && selectedSeason == null && videos.length > 0) {
      setSelectedSeason(sortSeasons(videos.map((video) => video.season ?? 1))[0] ?? 1)
    }
  }, [selectedSeason, selectedVideo, videos])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !playing) onClose()
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [onClose, playing])

  const browse = (target: MetadataBrowseTarget) => {
    onClose()
    onBrowse?.(target)
  }

  const playEpisode = async (video: Video) => {
    const transition = ++episodeTransition.current
    const currentAddon = playing?.addonName
    setPlaying(undefined)
    setSelectedVideoId(video.id)
    setSelectedSeason(video.season ?? 1)
    seriesReturnVideoId.current = video.id
    const nextStreams = await queryClient.fetchQuery({
      queryKey: ["streams", item.type, video.id, addonIds],
      queryFn: () => resolveStreams(addons, item.type, video.id),
      staleTime: 5 * 60 * 1000,
    })
    if (transition !== episodeTransition.current) return
    const playable = nextStreams.filter((stream) => stream.url)
    const stream =
      playable.find((candidate) => candidate.addonName === currentAddon) ??
      playable[0]
    setPlaying(stream)
  }

  const autoplayNextEpisode = async () => {
    if (!nextEpisode || !readPreferences().autoplay) {
      setPlaying(undefined)
      return
    }
    await playEpisode(nextEpisode)
  }

  return (
    <>
      <div
        className="fixed inset-0 z-30 overflow-hidden bg-zinc-950"
        role="dialog"
        aria-modal="true"
        aria-label={`${meta.name} details`}
      >
        <Backdrop
          src={episodeMode ? selectedVideo?.thumbnail : meta.background}
          fallback={meta.poster}
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(9,9,11,.98)_0%,rgba(9,9,11,.82)_48%,rgba(9,9,11,.56)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(0deg,rgba(9,9,11,.92)_0%,rgba(9,9,11,.28)_55%,rgba(9,9,11,.4)_100%)]" />

        <nav
          className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3 sm:p-5"
          aria-label="Media details"
        >
          <Button
            variant="ghost"
            size="icon"
            className="bg-black/25 backdrop-blur-md"
            aria-label="Back"
            onClick={onClose}
          >
            <ArrowLeft size={19} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="bg-black/25 backdrop-blur-md"
            aria-label="Close details"
            onClick={onClose}
          >
            <X size={19} />
          </Button>
        </nav>

        <main className="relative grid h-dvh min-h-0 grid-rows-[minmax(0,47%)_minmax(0,53%)] gap-3 p-3 pt-15 sm:p-5 sm:pt-17 md:grid-cols-[minmax(0,1fr)_minmax(330px,31vw)] md:grid-rows-1 md:gap-5">
          <div className="flex min-h-0 items-start overflow-hidden px-2 pt-2 sm:px-5 sm:pt-[clamp(1rem,3vh,2rem)] md:pr-[clamp(1rem,4vw,5rem)]">
            <div className="w-full max-w-5xl">
              {episodeMode && selectedVideo ? (
                <EpisodeSummary
                  meta={meta}
                  video={selectedVideo}
                  profileId={profileId}
                  progress={progress.data ?? []}
                />
              ) : (
                <MediaSummary
                  meta={meta}
                  profileId={profileId}
                  onBrowse={onBrowse ? browse : undefined}
                />
              )}
            </div>
          </div>

          {item.type === "series" && !episodeMode ? (
            <EpisodeRail
              videos={videos}
              loading={metadata.isLoading}
              progress={progress.data ?? []}
              season={selectedSeason}
              restoreScrollTop={episodeRailScrollTop.current}
              focusVideoId={seriesReturnVideoId.current}
              onSeasonChange={(season) => {
                episodeRailScrollTop.current = 0
                seriesReturnVideoId.current = undefined
                setSelectedSeason(season)
              }}
              onScroll={(scrollTop) => {
                episodeRailScrollTop.current = scrollTop
              }}
              onSelect={(id) => {
                seriesReturnVideoId.current = id
                setSelectedVideoId(id)
              }}
            />
          ) : (
            <StreamRail
              streams={streams.data ?? []}
              loading={streams.isLoading}
              videoTitle={selectedVideo?.title ?? meta.name}
              onPlay={setPlaying}
              onBackToSeries={
                episodeMode && selectedVideo
                  ? () => {
                      setSelectedSeason(selectedVideo.season ?? 1)
                      seriesReturnVideoId.current = selectedVideo.id
                      setSelectedVideoId(undefined)
                    }
                  : undefined
              }
            />
          )}
        </main>
      </div>

      {playing?.url && (
        <Player
          url={playing.url}
          type={item.type}
          videoId={activeVideoId!}
          profileId={profileId}
          progressMetadata={{
            mediaType: item.type,
            mediaId: item.id,
            name: meta.name,
            poster: meta.poster,
            videoTitle: selectedVideo?.title,
            season: selectedVideo?.season,
            episode: selectedVideo?.episode,
          }}
          addons={addons}
          nextEpisodeLabel={nextEpisode ? episodeLabel(nextEpisode) : undefined}
          onNextEpisode={
            nextEpisode ? () => playEpisode(nextEpisode) : undefined
          }
          onEnded={autoplayNextEpisode}
          onClose={() => {
            episodeTransition.current += 1
            setPlaying(undefined)
          }}
        />
      )}
    </>
  )
}

function MediaSummary({
  meta,
  profileId,
  onBrowse,
}: {
  meta: MetaItem
  profileId: string
  onBrowse?: (target: MetadataBrowseTarget) => void
}) {
  const trailer = trailerUrl(meta)
  const facts = [
    meta.runtime,
    meta.releaseInfo ?? displayDate(meta.released),
    meta.contentRating,
  ].filter(Boolean)
  return (
    <section className="max-h-[calc(100dvh-5rem)] overflow-hidden" aria-labelledby="media-title">
      {meta.logo ? (
        <button
          type="button"
          className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          aria-label={`Search for ${meta.name}`}
          disabled={!onBrowse}
          onClick={() => onBrowse?.({ kind: "search", value: meta.name })}
        >
          <Artwork
            className="mb-[clamp(.75rem,2vh,1.5rem)] max-h-[clamp(3.5rem,12vh,7rem)] w-auto max-w-[min(28rem,75vw)] object-contain object-left"
            src={meta.logo}
            alt={meta.name}
          />
        </button>
      ) : (
        <button
          type="button"
          className="block max-w-4xl rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          disabled={!onBrowse}
          onClick={() => onBrowse?.({ kind: "search", value: meta.name })}
        >
          <h1
            id="media-title"
            className="font-display text-[clamp(2.25rem,5vw,5rem)] font-semibold leading-[.96] tracking-tight"
          >
            {meta.name}
          </h1>
        </button>
      )}
      {meta.logo && <h1 id="media-title" className="sr-only">{meta.name}</h1>}

      <div className="mt-[clamp(.75rem,2.3vh,1.5rem)] flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-medium text-zinc-200">
        {facts.map((fact) => <span key={fact}>{fact}</span>)}
        {meta.imdbRating && (
          <span className="flex items-center gap-1.5">
            <Star className="fill-amber-400 text-amber-400" size={14} />
            {meta.imdbRating}
            <span className="rounded bg-amber-400 px-1 py-0.5 text-[9px] font-black text-zinc-950">
              IMDb
            </span>
          </span>
        )}
      </div>

      <MetadataChips
        label="Genres"
        values={meta.genres}
        onSelect={
          onBrowse
            ? (value) => onBrowse({ kind: "genre", value, mediaType: meta.type })
            : undefined
        }
      />
      {meta.description ? (
        <p className="mt-[clamp(.75rem,2vh,1.35rem)] line-clamp-4 max-w-4xl text-sm leading-6 text-zinc-300">
          {meta.description}
        </p>
      ) : (
        <p className="mt-4 text-sm italic text-zinc-500">No synopsis was supplied.</p>
      )}
      <Credits label="Directors" values={meta.director} onSelect={onBrowse} />
      <Credits label="Cast" values={meta.cast} onSelect={onBrowse} />
      <Credits label="Writers" values={meta.writer} onSelect={onBrowse} />
      {meta.country && (
        <Credits label="Country" values={[meta.country]} onSelect={onBrowse} />
      )}
      {meta.awards && (
        <p className="mt-2 line-clamp-1 text-xs text-zinc-500">{meta.awards}</p>
      )}

      <div className="mt-[clamp(1rem,2.6vh,1.75rem)] flex items-center gap-3">
        {trailer && (
          <Button
            variant="secondary"
            onClick={() => window.open(trailer, "_blank", "noopener,noreferrer")}
          >
            <CirclePlay size={17} />
            Trailer
          </Button>
        )}
        <LibraryToggle profileId={profileId} item={meta} revealLabel />
      </div>
    </section>
  )
}

function EpisodeSummary({
  meta,
  video,
  profileId,
  progress,
}: {
  meta: MetaItem
  video: Video
  profileId: string
  progress: WatchProgress[]
}) {
  const state = progress.find((item) => item.videoId === video.id)
  const description = video.overview ?? video.description
  return (
    <section className="max-h-[calc(100dvh-5rem)] overflow-hidden" aria-labelledby="episode-title">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">
        {meta.name} · {episodeLabel(video)}
      </p>
      <h1
        id="episode-title"
        className="max-w-4xl font-display text-[clamp(2.25rem,5vw,4.5rem)] font-semibold leading-[.98] tracking-tight"
      >
        {video.title ?? episodeLabel(video)}
      </h1>
      <div className="mt-[clamp(.75rem,2vh,1.25rem)] flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-300">
        {video.released && (
          <span className="flex items-center gap-2">
            <Calendar size={15} />
            {displayDate(video.released)}
          </span>
        )}
        {video.runtime && (
          <span className="flex items-center gap-2">
            <Clock3 size={15} />
            {video.runtime}
          </span>
        )}
        {video.available != null && (
          <span className={video.available ? "text-emerald-300" : "text-zinc-500"}>
            {video.available ? "Available" : "Not yet available"}
          </span>
        )}
      </div>
      <p className="mt-[clamp(.75rem,2vh,1.35rem)] line-clamp-5 max-w-4xl text-sm leading-6 text-zinc-300">
        {description ?? "No episode overview was supplied."}
      </p>
      <div className="mt-[clamp(1rem,2.6vh,1.75rem)] flex items-center gap-3">
        <EpisodeWatchAction
          profileId={profileId}
          item={state}
          video={video}
          media={{ type: meta.type, id: meta.id, name: meta.name, poster: meta.poster }}
        />
        <LibraryToggle profileId={profileId} item={meta} revealLabel />
      </div>
    </section>
  )
}

function EpisodeRail({
  videos,
  loading,
  progress,
  season,
  restoreScrollTop,
  focusVideoId,
  onSeasonChange,
  onScroll,
  onSelect,
}: {
  videos: Video[]
  loading: boolean
  progress: WatchProgress[]
  season?: number
  restoreScrollTop?: number
  focusVideoId?: string
  onSeasonChange: (season: number) => void
  onScroll: (scrollTop: number) => void
  onSelect: (id: string) => void
}) {
  const railRef = useRef<HTMLElement>(null)
  const seasons = useMemo(
    () => sortSeasons(videos.map((video) => video.season ?? 1)),
    [videos],
  )
  const [query, setQuery] = useState("")
  const activeSeason = season ?? seasons[0] ?? 1

  const episodes = videos
    .filter((video) => (video.season ?? 1) === activeSeason)
    .filter((video) => {
      const search = query.trim().toLocaleLowerCase()
      return !search || `${video.episode ?? ""} ${video.title ?? ""}`.toLocaleLowerCase().includes(search)
    })
    .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    if (restoreScrollTop != null) {
      rail.scrollTop = restoreScrollTop
      return
    }
    if (focusVideoId) {
      const episode = [...rail.querySelectorAll<HTMLElement>("[data-video-id]")].find(
        (candidate) => candidate.dataset.videoId === focusVideoId,
      )
      episode?.scrollIntoView({ block: "center" })
    }
  }, [activeSeason, focusVideoId, restoreScrollTop])

  return (
    <aside
      ref={railRef}
      className="min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950/80 shadow-2xl shadow-black/40 backdrop-blur-xl"
      onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
    >
      <div className="sticky top-0 z-10 border-b border-white/8 bg-zinc-950/95 p-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Browse episodes
            </p>
            <h2 className="font-display text-lg font-semibold">Episodes</h2>
          </div>
          {seasons.length > 0 && (
            <label className="relative">
              <span className="sr-only">Season</span>
              <select
                className="h-9 appearance-none rounded-lg border border-white/10 bg-white/5 pl-3 pr-8 text-xs font-medium text-zinc-200 outline-none focus:border-amber-400"
                value={activeSeason}
                onChange={(event) => {
                  onSeasonChange(Number(event.target.value))
                  setQuery("")
                }}
              >
                {seasons.map((value) => (
                  <option key={value} value={value}>{seasonLabel(value)}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
            </label>
          )}
        </div>
        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
          <span className="sr-only">Search episodes</span>
          <input
            type="search"
            className="h-9 w-full rounded-lg border border-white/8 bg-white/5 pl-9 pr-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-amber-400"
            value={query}
            placeholder="Search this season"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {loading && (
        <p className="flex items-center gap-2 p-5 text-sm text-zinc-400">
          <LoaderCircle className="animate-spin" size={16} />
          Loading episodes…
        </p>
      )}
      {!loading && videos.length === 0 && (
        <p className="m-3 rounded-xl border border-dashed border-white/10 p-5 text-sm text-zinc-500">
          This add-on did not supply an episode list.
        </p>
      )}
      {!loading && videos.length > 0 && episodes.length === 0 && (
        <p className="p-6 text-center text-sm text-zinc-500">No matching episodes.</p>
      )}
      <div className="divide-y divide-white/6 px-2 pb-2">
        {episodes.map((video) => (
          <EpisodeRow
            key={video.id}
            video={video}
            progress={progress.find((item) => item.videoId === video.id)}
            onSelect={() => onSelect(video.id)}
          />
        ))}
      </div>
    </aside>
  )
}

function EpisodeRow({
  video,
  progress,
  onSelect,
}: {
  video: Video
  progress?: WatchProgress
  onSelect: () => void
}) {
  const percent =
    progress && progress.durationMs > 0
      ? Math.min(100, Math.round((progress.positionMs / progress.durationMs) * 100))
      : 0
  return (
    <button
      type="button"
      data-video-id={video.id}
      className="group relative flex w-full gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      aria-label={`Open ${episodeLabel(video)}: ${video.title ?? "Untitled episode"}`}
      onClick={onSelect}
    >
      <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
        <Artwork className="h-full w-full object-cover" src={video.thumbnail} alt="" loading="lazy" />
        {!video.thumbnail && <div className="absolute inset-0 grid place-items-center text-zinc-700"><Film size={18} /></div>}
        {progress?.watched && (
          <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-amber-400 text-zinc-950">
            <Check size={11} />
          </span>
        )}
        {!progress?.watched && percent > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
            <span className="block h-full bg-amber-400" style={{ width: `${percent}%` }} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="line-clamp-2 text-sm font-medium leading-5">
          <span className="mr-1.5 text-zinc-500">{video.episode ?? "–"}.</span>
          {video.title ?? episodeLabel(video)}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-zinc-600">
          {video.released && <span>{displayDate(video.released)}</span>}
          {video.runtime && <span>{video.runtime}</span>}
        </p>
      </div>
    </button>
  )
}

function StreamRail({
  streams,
  loading,
  videoTitle,
  onPlay,
  onBackToSeries,
}: {
  streams: ResolvedStream[]
  loading: boolean
  videoTitle: string
  onPlay: (stream: ResolvedStream) => void
  onBackToSeries?: () => void
}) {
  return (
    <aside className="min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950/80 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="sticky top-0 z-10 flex items-center gap-2 rounded-xl bg-zinc-950/95 px-2 py-2 backdrop-blur">
        {onBackToSeries && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            aria-label="Back to series episodes"
            onClick={onBackToSeries}
          >
            <ArrowLeft size={17} />
          </Button>
        )}
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Choose a source
          </p>
          <h2 className="mt-0.5 line-clamp-1 font-display text-lg font-semibold">{videoTitle}</h2>
        </div>
      </div>
      {loading && (
        <p className="flex items-center gap-2 px-3 py-6 text-sm text-zinc-400">
          <LoaderCircle className="animate-spin" size={16} />
          Asking installed add-ons…
        </p>
      )}
      {!loading && streams.length === 0 && (
        <div className="m-2 rounded-xl border border-dashed border-white/10 p-5 text-sm text-zinc-500">
          No installed add-on returned a stream. Metadata and navigation are still available.
        </div>
      )}
      <div className="space-y-2">
        {streams.map((stream) => {
          const title = stream.name ?? stream.title ?? stream.addonName
          const description = stream.description ?? stream.title ?? `Provided by ${stream.addonName}`
          return (
            <div className="rounded-xl border border-white/8 bg-white/[0.035] p-3.5 transition hover:border-white/20 hover:bg-white/[0.065]" key={stream.key}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-sm font-semibold [overflow-wrap:anywhere]">{title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-400 [overflow-wrap:anywhere]">{description}</p>
                  <p className="mt-1.5 text-[10px] font-medium text-zinc-600">{stream.addonName}</p>
                </div>
                {stream.url ? (
                  <Button size="icon" aria-label={`Play ${title}`} onClick={() => onPlay(stream)}><Play size={16} /></Button>
                ) : stream.externalUrl ? (
                  <Button
                    size="icon"
                    variant="secondary"
                    aria-label={`Open ${title}`}
                    onClick={() => window.open(stream.externalUrl, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink size={16} />
                  </Button>
                ) : (
                  <span className="mt-2 text-[10px] text-zinc-600" title="Native playback required">Native</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function EpisodeWatchAction({
  profileId,
  item,
  video,
  media,
}: {
  profileId: string
  item?: WatchProgress
  video: Video
  media: { type: string; id: string; name: string; poster?: string }
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => {
      const path = `/v1/profiles/${profileId}/progress/${encodeURIComponent(video.id)}`
      return item
        ? api(path, { method: "PATCH", body: JSON.stringify({ watched: !item.watched }) })
        : api(path, {
            method: "PUT",
            body: JSON.stringify({
              mediaType: media.type,
              mediaId: media.id,
              name: media.name,
              poster: media.poster,
              videoTitle: video.title,
              season: video.season,
              episode: video.episode,
              positionMs: 0,
              durationMs: 0,
              watched: true,
            }),
          })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
        queryClient.invalidateQueries({ queryKey: ["series-progress", profileId] }),
      ])
    },
  })
  return (
    <Button variant="secondary" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      {item?.watched ? <RotateCcw size={16} /> : <Check size={16} />}
      Mark {item?.watched ? "unwatched" : "watched"}
    </Button>
  )
}

function MetadataChips({
  label,
  values,
  onSelect,
}: {
  label: string
  values?: string[]
  onSelect?: (value: string) => void
}) {
  if (!values?.length) return null
  return (
    <div className="mt-[clamp(.65rem,1.8vh,1.15rem)]">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) =>
          onSelect ? (
            <button
              key={value}
              type="button"
              className="rounded-full bg-white/8 px-3 py-1 text-xs text-zinc-200 transition hover:bg-amber-400 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              onClick={() => onSelect(value)}
            >
              {value}
            </button>
          ) : (
            <span key={value} className="rounded-full bg-white/8 px-3 py-1 text-xs text-zinc-200">{value}</span>
          ),
        )}
      </div>
    </div>
  )
}

function Credits({
  label,
  values,
  onSelect,
}: {
  label: string
  values?: string[]
  onSelect?: (target: MetadataBrowseTarget) => void
}) {
  if (!values?.length) return null
  return (
    <div className="mt-2.5 min-w-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <div className="flex max-h-8 flex-wrap gap-1.5 overflow-hidden text-xs">
        {values.map((value) => (
          <span key={value}>
            {onSelect ? (
              <button
                type="button"
                className="rounded-full bg-white/8 px-2.5 py-1 text-zinc-300 transition hover:bg-amber-400 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                onClick={() => onSelect({ kind: "search", value })}
              >
                {value}
              </button>
            ) : <span className="rounded-full bg-white/8 px-2.5 py-1 text-zinc-300">{value}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

function Backdrop({ src, fallback }: { src?: string; fallback?: string }) {
  const image = src ?? fallback
  if (!image) return <div className="absolute inset-0 bg-zinc-950" />
  return <Artwork className="absolute inset-0 h-full w-full object-cover" src={image} alt="" />
}

function Artwork({
  src,
  className,
  alt,
  loading,
}: {
  src?: string
  className?: string
  alt: string
  loading?: "eager" | "lazy"
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return null
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

async function resolveMetadata(addons: InstalledAddon[], item: CatalogItem): Promise<MetaItem> {
  const candidates = addonsForResource(addons, "meta", item.type, item.id)
  const results = await Promise.allSettled(
    candidates.map((addon) => loadMeta(addon.manifestUrl, item.type, item.id)),
  )
  const match = results.find(
    (result): result is PromiseFulfilledResult<MetaItem> => result.status === "fulfilled",
  )
  return normalizeMetaItem(match?.value, item)
}

async function resolveStreams(
  addons: InstalledAddon[],
  type: string,
  videoId: string,
): Promise<ResolvedStream[]> {
  const candidates = addonsForResource(addons, "stream", type, videoId)
  const results = await Promise.allSettled(
    candidates.map(async (addon) => ({
      addon,
      streams: await loadStreams(addon.manifestUrl, type, videoId),
    })),
  )
  return results.flatMap((result) => {
    if (result.status === "rejected") return []
    return result.value.streams.map((stream, index) => ({
      ...stream,
      externalUrl: safeExternalUrl(stream.externalUrl),
      key: `${result.value.addon.id}:${index}:${stream.url ?? stream.infoHash ?? stream.externalUrl ?? "stream"}`,
      addonName: result.value.addon.manifest.name,
    }))
  })
}
