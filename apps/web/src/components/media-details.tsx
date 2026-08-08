import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Calendar,
  Check,
  CirclePlay,
  Clock3,
  ExternalLink,
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
  adjacentSeriesVideo,
  displayDate,
  episodeLabel,
  normalizeMetaItem,
  safeExternalUrl,
  selectSeriesVideo,
  sortSeasons,
  trailerUrl,
} from "../lib/metadata"
import { readPreferences } from "../lib/preferences"
import { selectNextEpisodeStream } from "../lib/stream-selection"
import { Button } from "./ui/button"
import { Player } from "./player"
import { LibraryToggle } from "./library-toggle"
import { EpisodeSelector } from "./episode-selector"
import {
  createWatchPartySession,
  WatchPartyDialog,
  mediaForParty,
} from "./watch-party-dialog"
import {
  type WatchPartyMedia,
  type WatchPartySession,
  type WatchPartySummary,
} from "../lib/watch-party"
import type { WatchPartySessionResponse } from "../lib/watch-party-api"

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
  initialWatchPartyParty,
  initialWatchPartySession,
  onWatchPartySessionChange,
  onExternalWatchPartyJoined,
  onBrowse,
  onClose,
}: {
  item: CatalogItem
  addons: InstalledAddon[]
  profileId: string
  initialVideoId?: string
  initialWatchPartyParty?: WatchPartySummary
  initialWatchPartySession?: WatchPartySession
  onWatchPartySessionChange?: (session: WatchPartySession | undefined) => void
  onExternalWatchPartyJoined?: (response: WatchPartySessionResponse) => void
  onBrowse?: (target: MetadataBrowseTarget) => void
  onClose: () => void
}) {
  const [selectedVideoId, setSelectedVideoId] = useState<string | undefined>(
    initialVideoId && initialVideoId !== item.id ? initialVideoId : undefined,
  )
  const [selectedSeason, setSelectedSeason] = useState<number>()
  const [playing, setPlaying] = useState<ResolvedStream>()
  const [streamResolutionError, setStreamResolutionError] = useState<string>()
  const [watchPartyOpen, setWatchPartyOpen] = useState(false)
  const [watchPartySession, setWatchPartySession] = useState<WatchPartySession | undefined>(initialWatchPartySession)
  const queryClient = useQueryClient()
  const episodeTransition = useRef(0)
  const partyAutoPlayKey = useRef<string | undefined>(undefined)
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
  const watchPartyMedia = useMemo(
    () => mediaForParty(
      {
        mediaType: item.type,
        mediaId: item.id,
        name: meta.name,
        poster: meta.poster,
        videoTitle: selectedVideo?.title,
        season: selectedVideo?.season,
        episode: selectedVideo?.episode,
      },
      activeVideoId ?? item.id,
    ),
    [activeVideoId, item.id, item.type, meta.name, meta.poster, selectedVideo?.episode, selectedVideo?.season, selectedVideo?.title],
  )
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
      !initialVideoId ||
      initialVideoId === item.id ||
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
    if (initialWatchPartySession && initialWatchPartySession !== watchPartySession) {
      setWatchPartySession(initialWatchPartySession)
    }
  }, [initialWatchPartySession, watchPartySession])

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

  useEffect(() => {
    if (watchPartySession?.role === "host") watchPartySession.publishMedia(watchPartyMedia)
  }, [watchPartyMedia, watchPartySession])

  useEffect(() => {
    if (!initialWatchPartySession || !initialWatchPartyParty || !activeVideoId || !streams.isSuccess) return
    const key = `${initialWatchPartyParty.id}:${activeVideoId}`
    if (partyAutoPlayKey.current === key) return
    partyAutoPlayKey.current = key
    const firstPlayableStream = streams.data.find((stream) => Boolean(stream.url))
    if (!firstPlayableStream) {
      setStreamResolutionError("No direct stream was found automatically. Choose a source below to join playback.")
      return
    }
    setStreamResolutionError(undefined)
    setPlaying(firstPlayableStream)
  }, [activeVideoId, initialWatchPartyParty, initialWatchPartySession, streams.data, streams.isSuccess])

  useEffect(() => {
    const electron = window.__CONDUIT_ELECTRON__
    if (!electron) return
    const unsubscribeOpen = electron.onPlayerOverlayWatchParty(() => setWatchPartyOpen(true))
    const unsubscribeJoined = electron.onPlayerOverlayWatchPartyJoined((response) => {
      const next = createWatchPartySession(profileId, response)
      const isCurrentMedia = response.party.media.mediaId === item.id &&
        (item.type !== "series" || response.party.media.videoId === activeVideoId)
      if (isCurrentMedia) {
        setWatchPartySession(next)
        onWatchPartySessionChange?.(next)
      } else {
        onExternalWatchPartyJoined?.(response)
        onClose()
      }
    })
    const unsubscribeLeft = electron.onPlayerOverlayWatchPartyLeft((partyId) => {
      if (watchPartySession?.partyId !== partyId) return
      watchPartySession.close()
      setWatchPartySession(undefined)
      onWatchPartySessionChange?.(undefined)
    })
    return () => {
      unsubscribeOpen()
      unsubscribeJoined()
      unsubscribeLeft()
    }
  }, [activeVideoId, item.id, item.type, onClose, onExternalWatchPartyJoined, onWatchPartySessionChange, profileId, watchPartySession])

  useEffect(() => () => watchPartySession?.close(), [watchPartySession])

  const browse = (target: MetadataBrowseTarget) => {
    onClose()
    onBrowse?.(target)
  }

  const playEpisode = async (video: Video) => {
    const transition = ++episodeTransition.current
    const currentStream = playing
    setStreamResolutionError(undefined)
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
    const stream = selectNextEpisodeStream(nextStreams, currentStream)
    if (!stream) {
      setStreamResolutionError(
        `No playable source could be selected automatically for ${episodeLabel(video)}. Choose a source below.`,
      )
    }
    setPlaying(stream)
  }

  const autoplayNextEpisode = async (allowAutoplay = true) => {
    if (!allowAutoplay || !nextEpisode || !readPreferences().autoplay) {
      setPlaying(undefined)
      return
    }
    await playEpisode(nextEpisode)
  }

  const openEpisodeSources = (video: Video) => {
    episodeTransition.current += 1
    setStreamResolutionError(undefined)
    setPlaying(undefined)
    setSelectedVideoId(video.id)
    setSelectedSeason(video.season ?? 1)
    seriesReturnVideoId.current = video.id
  }

  const updateWatchPartySession = useCallback((next: WatchPartySession | undefined) => {
    setWatchPartySession(next)
    onWatchPartySessionChange?.(next)
  }, [onWatchPartySessionChange])

  const partyFindingStream = Boolean(
    initialWatchPartySession &&
    !playing &&
    (metadata.isLoading || progress.isLoading || streams.isLoading || (item.type === "series" && !activeVideoId)),
  )

  return (
    <>
      <div
        className="media-details fixed inset-0 z-30 overflow-hidden bg-zinc-950"
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
            <EpisodeSelector
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
              onSelect={(video) => {
                seriesReturnVideoId.current = video.id
                setSelectedVideoId(video.id)
              }}
            />
          ) : (
            <StreamRail
              streams={streams.data ?? []}
              loading={streams.isLoading}
              error={streamResolutionError}
              videoTitle={selectedVideo?.title ?? meta.name}
              onPlay={(stream) => {
                setStreamResolutionError(undefined)
                setPlaying(stream)
              }}
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
        {partyFindingStream && (
          <div className="pointer-events-none fixed inset-x-0 bottom-5 z-20 flex justify-center px-5" aria-live="polite">
            <p className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-300 shadow-xl shadow-black/30 backdrop-blur">
              <LoaderCircle className="animate-spin text-amber-300" size={14} />
              Finding a playable stream for the party…
            </p>
          </div>
        )}
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
          seriesContext={
            selectedVideo
              ? {
                  name: meta.name,
                  videos,
                  progress: progress.data ?? [],
                  currentVideoId: selectedVideo.id,
                }
              : undefined
          }
          nextEpisode={nextEpisode}
          nextEpisodeLabel={nextEpisode ? episodeLabel(nextEpisode) : undefined}
          onSelectEpisode={openEpisodeSources}
          onNextEpisode={
            nextEpisode ? () => playEpisode(nextEpisode) : undefined
          }
          onEnded={autoplayNextEpisode}
          onClose={() => {
            episodeTransition.current += 1
            setPlaying(undefined)
          }}
          partySession={watchPartySession}
          onWatchParty={() => setWatchPartyOpen(true)}
          onRemoteMedia={(media) => {
            void followRemoteMedia(media, videos, playEpisode)
          }}
        />
      )}
      <WatchPartyDialog
        open={watchPartyOpen}
        onOpenChange={setWatchPartyOpen}
        profile={{ id: profileId, name: "", isKids: false }}
        media={watchPartyMedia}
        initialParty={initialWatchPartyParty}
        initialSession={initialWatchPartySession}
        onSessionChange={updateWatchPartySession}
      />
    </>
  )
}

async function followRemoteMedia(
  media: WatchPartyMedia,
  videos: Video[],
  playEpisode: (video: Video) => Promise<void>,
): Promise<void> {
  if (media.type !== "series") return
  const video = videos.find((candidate) => candidate.id === media.videoId)
  if (video) await playEpisode(video)
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

function StreamRail({
  streams,
  loading,
  error,
  videoTitle,
  onPlay,
  onBackToSeries,
}: {
  streams: ResolvedStream[]
  loading: boolean
  error?: string
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
      {error && (
        <p role="alert" className="m-2 rounded-xl border border-amber-400/25 bg-amber-400/8 p-3 text-xs leading-5 text-amber-100">
          {error}
        </p>
      )}
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
