import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Calendar,
  Check,
  CirclePlay,
  Clock3,
  ExternalLink,
  Film,
  LoaderCircle,
  Play,
  RotateCcw,
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
  displayDate,
  episodeLabel,
  normalizeMetaItem,
  safeExternalUrl,
  trailerUrl,
} from "../lib/metadata"
import { cn } from "../lib/utils"
import { Button } from "./ui/button"
import { Player } from "./player"
import { LibraryToggle } from "./library-toggle"

interface ResolvedStream extends Stream {
  key: string
  addonName: string
}

export function MediaDetails({
  item,
  addons,
  profileId,
  initialVideoId,
  onClose,
}: {
  item: CatalogItem
  addons: InstalledAddon[]
  profileId: string
  initialVideoId?: string
  onClose: () => void
}) {
  const [selectedVideoId, setSelectedVideoId] = useState<string | undefined>(
    initialVideoId && initialVideoId !== item.id ? initialVideoId : undefined,
  )
  const [playing, setPlaying] = useState<ResolvedStream>()
  const detailsRef = useRef<HTMLDivElement>(null)

  const metadata = useQuery({
    queryKey: ["meta", item.type, item.id, addons.map((addon) => addon.id)],
    queryFn: () => resolveMetadata(addons, item),
  })
  const meta = metadata.data ?? normalizeMetaItem(item, item)
  const videos = meta.videos ?? []
  const selectedVideo = videos.find((video) => video.id === selectedVideoId)
  const episodeMode = item.type === "series" && Boolean(selectedVideo)
  const activeVideoId = episodeMode ? selectedVideoId : item.id

  const progress = useQuery({
    queryKey: ["progress", profileId],
    queryFn: () =>
      api<{ items: WatchProgress[] }>(`/v1/profiles/${profileId}/progress?limit=100`).then(
        (result) => result.items,
      ),
  })
  const streams = useQuery({
    queryKey: ["streams", item.type, activeVideoId, addons.map((addon) => addon.id)],
    enabled: item.type !== "series" || episodeMode,
    queryFn: () => resolveStreams(addons, item.type, activeVideoId!),
  })

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

  useEffect(() => {
    detailsRef.current?.scrollTo({ top: 0 })
  }, [selectedVideoId])

  return (
    <>
      <div
        ref={detailsRef}
        className="fixed inset-0 z-30 overflow-y-auto bg-zinc-950"
        role="dialog"
        aria-modal="true"
        aria-label={`${meta.name} details`}
      >
        <Backdrop src={episodeMode ? selectedVideo?.thumbnail : meta.background} fallback={meta.poster} />
        <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(90deg,rgba(9,9,11,.98)_0%,rgba(9,9,11,.83)_46%,rgba(9,9,11,.58)_100%)]" />
        <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(0deg,#09090b_0%,rgba(9,9,11,.55)_45%,rgba(9,9,11,.28)_100%)]" />

        <div className="relative mx-auto min-h-screen max-w-[1800px] px-4 pb-12 pt-5 sm:px-7 lg:px-10">
          <nav className="mb-8 flex items-center justify-between" aria-label="Media details">
            {episodeMode ? (
              <Button
                variant="ghost"
                className="bg-black/20 backdrop-blur-md"
                onClick={() => setSelectedVideoId(undefined)}
              >
                <ArrowLeft size={18} />
                All episodes
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="bg-black/20 backdrop-blur-md"
                aria-label="Close details"
                onClick={onClose}
              >
                <ArrowLeft size={19} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="bg-black/20 backdrop-blur-md"
              aria-label="Close details"
              onClick={onClose}
            >
              <X size={19} />
            </Button>
          </nav>

          {item.type === "series" && !episodeMode ? (
            <SeriesPage
              meta={meta}
              loading={metadata.isLoading}
              profileId={profileId}
              progress={progress.data ?? []}
              onSelectEpisode={setSelectedVideoId}
            />
          ) : (
            <PlayablePage
              meta={meta}
              video={selectedVideo}
              profileId={profileId}
              progress={progress.data ?? []}
              streams={streams.data ?? []}
              streamsLoading={streams.isLoading}
              onPlay={setPlaying}
            />
          )}
        </div>
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
          onClose={() => setPlaying(undefined)}
        />
      )}
    </>
  )
}

function SeriesPage({
  meta,
  loading,
  profileId,
  progress,
  onSelectEpisode,
}: {
  meta: MetaItem
  loading: boolean
  profileId: string
  progress: WatchProgress[]
  onSelectEpisode: (id: string) => void
}) {
  return (
    <main>
      <div className="max-w-4xl py-5 sm:py-10">
        <MediaSummary meta={meta} profileId={profileId} />
      </div>
      {loading ? (
        <p className="mt-10 flex items-center gap-2 text-sm text-zinc-400">
          <LoaderCircle className="animate-spin" size={17} />
          Loading seasons…
        </p>
      ) : (
        <EpisodeBrowser
          videos={meta.videos ?? []}
          progress={progress}
          onSelect={onSelectEpisode}
        />
      )}
    </main>
  )
}

function PlayablePage({
  meta,
  video,
  profileId,
  progress,
  streams,
  streamsLoading,
  onPlay,
}: {
  meta: MetaItem
  video?: Video
  profileId: string
  progress: WatchProgress[]
  streams: ResolvedStream[]
  streamsLoading: boolean
  onPlay: (stream: ResolvedStream) => void
}) {
  const videoTitle = video?.title ?? meta.name
  return (
    <main className="grid min-h-[calc(100vh-7rem)] items-start gap-12 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_430px]">
      <div className="flex min-h-[62vh] max-w-5xl flex-col justify-end pb-5 pt-12 lg:min-h-[78vh] lg:pb-10">
        {video ? (
          <EpisodeSummary
            meta={meta}
            video={video}
            profileId={profileId}
            progress={progress}
          />
        ) : (
          <MediaSummary meta={meta} profileId={profileId} />
        )}
      </div>
      <StreamRail
        streams={streams}
        loading={streamsLoading}
        videoTitle={videoTitle}
        onPlay={onPlay}
      />
    </main>
  )
}

function MediaSummary({ meta, profileId }: { meta: MetaItem; profileId: string }) {
  const trailer = trailerUrl(meta)
  const facts = [
    meta.runtime,
    meta.releaseInfo ?? displayDate(meta.released),
    meta.contentRating,
    meta.country,
  ].filter(Boolean)

  return (
    <section aria-labelledby="media-title">
      {meta.logo ? (
        <Artwork
          className="mb-7 max-h-32 w-auto max-w-[min(30rem,85vw)] object-contain object-left"
          src={meta.logo}
          alt={meta.name}
        />
      ) : (
        <h1
          id="media-title"
          className="max-w-4xl font-display text-4xl font-semibold tracking-tight sm:text-6xl lg:text-7xl"
        >
          {meta.name}
        </h1>
      )}
      {meta.logo && <h1 id="media-title" className="sr-only">{meta.name}</h1>}

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-zinc-200">
        {facts.map((fact) => <span key={fact}>{fact}</span>)}
        {meta.imdbRating && (
          <span className="flex items-center gap-1.5">
            <Star className="fill-amber-400 text-amber-400" size={15} />
            {meta.imdbRating}
            <span className="rounded bg-amber-400 px-1 py-0.5 text-[9px] font-black text-zinc-950">
              IMDb
            </span>
          </span>
        )}
      </div>

      <TagList label="Genres" values={meta.genres} />
      {meta.description ? (
        <p className="mt-6 max-w-4xl text-sm leading-7 text-zinc-300 sm:text-base">
          {meta.description}
        </p>
      ) : (
        <p className="mt-6 text-sm italic text-zinc-500">No synopsis was supplied.</p>
      )}
      <Credits label="Director" values={meta.director} />
      <Credits label="Cast" values={meta.cast} />
      <Credits label="Writers" values={meta.writer} />
      {meta.awards && <p className="mt-4 text-sm text-zinc-400">{meta.awards}</p>}

      <div className="mt-8 flex items-center gap-3">
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
    <section aria-labelledby="episode-title">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">
        {meta.name} · {episodeLabel(video)}
      </p>
      <h1
        id="episode-title"
        className="max-w-4xl font-display text-4xl font-semibold tracking-tight sm:text-6xl"
      >
        {video.title ?? episodeLabel(video)}
      </h1>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-300">
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
      {description ? (
        <p className="mt-6 max-w-4xl text-sm leading-7 text-zinc-300 sm:text-base">
          {description}
        </p>
      ) : (
        <p className="mt-6 text-sm italic text-zinc-500">
          No episode overview was supplied.
        </p>
      )}
      <div className="mt-8 flex items-center gap-3">
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

function EpisodeBrowser({
  videos,
  progress,
  onSelect,
}: {
  videos: Video[]
  progress: WatchProgress[]
  onSelect: (id: string) => void
}) {
  const seasons = useMemo(() => {
    const values = videos.map((video) => video.season ?? 1)
    return [...new Set(values)].sort((a, b) => a - b)
  }, [videos])
  const [season, setSeason] = useState(seasons[0] ?? 1)

  useEffect(() => {
    if (seasons.length && !seasons.includes(season)) setSeason(seasons[0]!)
  }, [season, seasons])

  const episodes = videos
    .filter((video) => (video.season ?? 1) === season)
    .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))

  if (!videos.length) {
    return (
      <section className="mt-14 rounded-2xl border border-dashed border-white/15 bg-black/20 p-8">
        <h2 className="font-display text-2xl font-semibold">Episodes</h2>
        <p className="mt-2 text-sm text-zinc-400">
          This add-on did not supply an episode list. You can still add the series to your library
          and try another metadata add-on.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-14" aria-labelledby="episodes-heading">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Browse the series
          </p>
          <h2 id="episodes-heading" className="mt-1 font-display text-3xl font-semibold">
            Episodes
          </h2>
        </div>
        <div
          className="flex max-w-full gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Seasons"
        >
          {seasons.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={season === value}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
                season === value
                  ? "border-amber-300 bg-amber-400 text-zinc-950"
                  : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/25 hover:bg-white/10",
              )}
              onClick={() => setSeason(value)}
            >
              Season {value}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {episodes.map((video) => (
          <EpisodeCard
            key={video.id}
            video={video}
            progress={progress.find((item) => item.videoId === video.id)}
            onSelect={() => onSelect(video.id)}
          />
        ))}
      </div>
    </section>
  )
}

function EpisodeCard({
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
      className="group overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/65 text-left shadow-xl shadow-black/20 backdrop-blur-md transition hover:-translate-y-0.5 hover:border-amber-300/50 hover:bg-zinc-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      aria-label={`Open ${episodeLabel(video)}: ${video.title ?? "Untitled episode"}`}
      onClick={onSelect}
    >
      <div className="relative aspect-video overflow-hidden bg-zinc-900">
        <Artwork
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          src={video.thumbnail}
          alt=""
          loading="lazy"
        />
        {!video.thumbnail && (
          <div className="absolute inset-0 grid place-items-center text-zinc-700">
            <Film size={30} />
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/75 px-2.5 py-1 text-xs font-semibold backdrop-blur">
          {episodeLabel(video)}
        </span>
        {progress?.watched && (
          <span className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-amber-400 text-zinc-950">
            <Check size={15} />
          </span>
        )}
        {!progress?.watched && percent > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <span className="block h-full bg-amber-400" style={{ width: `${percent}%` }} />
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="line-clamp-1 font-display text-lg font-semibold">
          {video.title ?? episodeLabel(video)}
        </h3>
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-zinc-500">
          {video.released && <span>{displayDate(video.released)}</span>}
          {video.runtime && <span>{video.runtime}</span>}
          {video.available != null && (
            <span className={video.available ? "text-emerald-400" : undefined}>
              {video.available ? "Available" : "Unavailable"}
            </span>
          )}
        </div>
        <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-zinc-400">
          {video.overview ?? video.description ?? "No episode overview was supplied."}
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
}: {
  streams: ResolvedStream[]
  loading: boolean
  videoTitle: string
  onPlay: (stream: ResolvedStream) => void
}) {
  return (
    <aside className="rounded-2xl border border-white/10 bg-zinc-950/80 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)] lg:overflow-y-auto">
      <div className="sticky top-0 z-10 rounded-xl bg-zinc-950/95 px-3 py-3 backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Choose a source
        </p>
        <h2 className="mt-1 line-clamp-1 font-display text-xl font-semibold">{videoTitle}</h2>
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
            <div
              className="group rounded-xl border border-white/8 bg-white/[0.035] p-4 transition hover:border-white/20 hover:bg-white/[0.065]"
              key={stream.key}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 whitespace-pre-line text-sm font-semibold">{title}</p>
                  <p className="mt-1 line-clamp-4 whitespace-pre-line text-xs leading-5 text-zinc-500">
                    {description}
                  </p>
                  <p className="mt-2 text-[11px] font-medium text-zinc-600">{stream.addonName}</p>
                </div>
                {stream.url ? (
                  <Button size="icon" aria-label={`Play ${title}`} onClick={() => onPlay(stream)}>
                    <Play size={16} />
                  </Button>
                ) : stream.externalUrl ? (
                  <Button
                    size="icon"
                    variant="secondary"
                    aria-label={`Open ${title}`}
                    onClick={() =>
                      window.open(stream.externalUrl, "_blank", "noopener,noreferrer")
                    }
                  >
                    <ExternalLink size={16} />
                  </Button>
                ) : (
                  <span className="mt-2 text-[10px] text-zinc-600" title="Native playback required">
                    Native
                  </span>
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
        ? api(path, {
            method: "PATCH",
            body: JSON.stringify({ watched: !item.watched }),
          })
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
  })
  return (
    <Button
      variant="secondary"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {item?.watched ? <RotateCcw size={16} /> : <Check size={16} />}
      Mark {item?.watched ? "unwatched" : "watched"}
    </Button>
  )
}

function TagList({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null
  return (
    <div className="mt-6">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span key={value} className="rounded-full bg-white/8 px-3 py-1.5 text-xs text-zinc-200">
            {value}
          </span>
        ))}
      </div>
    </div>
  )
}

function Credits({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null
  return (
    <p className="mt-3 text-sm text-zinc-400">
      <span className="mr-2 font-semibold text-zinc-200">{label}</span>
      {values.join(", ")}
    </p>
  )
}

function Backdrop({ src, fallback }: { src?: string; fallback?: string }) {
  const image = src ?? fallback
  if (!image) return <div className="fixed inset-0 bg-zinc-950" />
  return (
    <Artwork
      className="fixed inset-0 h-full w-full object-cover"
      src={image}
      alt=""
    />
  )
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
