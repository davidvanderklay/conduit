import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Calendar,
  Check,
  Captions,
  CirclePlay,
  Clock3,
  ExternalLink,
  Languages,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Scaling,
  SkipForward,
  Star,
  Volume2,
  X,
} from "lucide-react"
import { api, type InstalledAddon, type PlayerArtwork, type WatchProgress } from "../lib/api"
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
import { readPreferences, writePreferences } from "../lib/preferences"
import { progressPath } from "../lib/progress"
import {
  AUTO_SELECTION_STARTUP_TIMEOUT_MS,
  playbackSourceForStream,
  selectSavedStream,
  selectSingleAutoStream,
} from "../lib/stream-selection"
import { nativeFullscreen, onNativeFullscreenChange } from "../lib/desktop"
import { mediaForWatchActions, setEpisodeWatched, setVideosWatched } from "../lib/watch-actions"
import { episodeProgressPercent, episodeWatchState, resumePositionLabel } from "../lib/watch-status"
import { Button } from "./ui/button"
import { Player } from "./player"
import { LibraryToggle } from "./library-toggle"
import { EpisodeSelector } from "./episode-selector"
import { usesExpandedPlayerControls } from "./desktop-player"
import { DesktopPlayerChrome, DesktopPlayerControl } from "./desktop-player-chrome"
import { DesktopPlayerOpeningOverlay } from "./desktop-player-overlays"

interface ResolvedStream extends Stream {
  key: string
  addonId: string
  addonName: string
}

type AutoResumeStage = "inactive" | "resolving" | "starting" | "picker"

export type MetadataBrowseTarget =
  | { kind: "genre"; value: string; mediaType: string }
  | { kind: "search"; value: string }

export function MediaDetails({
  accountId,
  item,
  addons,
  profileId,
  initialVideoId,
  initialProgress,
  onBrowse,
  onClose,
  streamSelectionReturnToHome = false,
  autoResumeOnOpen = true,
}: {
  accountId?: string
  item: CatalogItem
  addons: InstalledAddon[]
  profileId: string
  initialVideoId?: string
  initialProgress?: WatchProgress
  onBrowse?: (target: MetadataBrowseTarget) => void
  onClose: () => void
  streamSelectionReturnToHome?: boolean
  autoResumeOnOpen?: boolean
}) {
  const [selectedVideoId, setSelectedVideoId] = useState<string | undefined>(
    initialVideoId && initialVideoId !== item.id ? initialVideoId : undefined,
  )
  const [selectedSeason, setSelectedSeason] = useState<number>()
  const [playing, setPlaying] = useState<ResolvedStream>()
  const [streamResolutionError, setStreamResolutionError] = useState<string>()
  const [streamAddonId, setStreamAddonId] = useState<string | undefined>(
    () => readPreferences().lastStreamAddonId,
  )
  const queryClient = useQueryClient()
  const episodeTransition = useRef(0)
  const initialSeriesVideoResolved = useRef(false)
  const seriesSeasonManuallySelected = useRef(false)
  const episodeRailScrollTop = useRef<number | undefined>(undefined)
  const autoResumeAttemptedKey = useRef<string | undefined>(undefined)
  const autoResumeRequestVersion = useRef(0)
  const autoFallbackStream = useRef<ResolvedStream | undefined>(undefined)
  const autoRecoveryCandidate = useRef<ResolvedStream | undefined>(undefined)
  const autoRecoveryFailedStream = useRef<ResolvedStream | undefined>(undefined)
  const autoRecoveryUsedSavedSource = useRef(false)
  const autoResolutionPending = useRef(false)
  const autoRecoveryFailurePending = useRef(false)
  const seriesReturnVideoId = useRef<string | undefined>(
    initialVideoId && initialVideoId !== item.id ? initialVideoId : undefined,
  )
  const metadata = useQuery({
    queryKey: ["meta", item.type, item.id, addons.map((addon) => addon.id)],
    queryFn: () => resolveMetadata(addons, item),
  })
  const meta = metadata.data ?? normalizeMetaItem(item, item)
  const autoSelectSavedStreams = readPreferences().autoSelectSavedStreams
  const videos = meta.videos ?? []
  const selectedVideo = videos.find((video) => video.id === selectedVideoId)
  const nextEpisode = selectedVideo ? adjacentSeriesVideo(videos, selectedVideo.id, 1) : undefined
  const episodeMode = item.type === "series" && Boolean(selectedVideo)
  const activeVideoId = episodeMode ? selectedVideoId : item.id
  const addonIds = addons.map((addon) => addon.id)
  const streamAddons = activeVideoId
    ? addonsForResource(addons, "stream", item.type, activeVideoId)
    : []
  const savedPlaybackSource = initialProgress?.playbackSource
  const autoResumeEligible =
    autoResumeOnOpen &&
    autoSelectSavedStreams &&
    Boolean(savedPlaybackSource) &&
    (item.type !== "series" || Boolean(initialVideoId))
  const effectiveStreamAddonId =
    streamAddonId &&
    streamAddons.length > 1 &&
    streamAddons.some((addon) => addon.id === streamAddonId)
      ? streamAddonId
      : undefined
  const requestedStreamAddons = effectiveStreamAddonId
    ? streamAddons.filter((addon) => addon.id === effectiveStreamAddonId)
    : streamAddons
  const autoResumeAttemptKey = [
    item.type,
    activeVideoId ?? item.id,
    savedPlaybackSource?.addonId ?? "",
    savedPlaybackSource?.sourceKey ?? "",
    effectiveStreamAddonId ?? "all",
  ].join(":")
  const [autoResumeStage, setAutoResumeStage] = useState<AutoResumeStage>(() =>
    autoResumeEligible ? "resolving" : "inactive",
  )
  const shouldWaitForSavedPlayback =
    autoResumeStage === "resolving" || autoResumeStage === "starting"
  const progress = useQuery({
    queryKey: ["series-progress", profileId, item.type, item.id],
    refetchOnMount: "always",
    queryFn: () =>
      api<{ items: WatchProgress[] }>(
        `/v1/profiles/${profileId}/progress?view=status&limit=1000`,
      ).then((result) => result.items),
  })
  const seriesProgressReady = progress.isSuccess || progress.isError
  const seriesProgress = [
    ...(initialProgress && initialProgress.mediaType === item.type && initialProgress.mediaId === item.id
      ? [initialProgress]
      : []),
    ...(progress.data ?? []).filter((entry) =>
      entry.mediaType === item.type && entry.mediaId === item.id,
    ),
  ]
  const seriesSelectorTarget = useMemo(() => {
    if (item.type !== "series" || selectedVideoId || !videos.length || !seriesProgressReady) return undefined
    return selectSeriesVideo(
      videos,
      seriesProgress,
      undefined,
      undefined,
      meta.defaultVideoId,
    )
  }, [item.type, meta.defaultVideoId, selectedVideoId, seriesProgress, seriesProgressReady, videos])
  const activeProgress = activeVideoId
    ? (initialProgress?.videoId === activeVideoId
        ? initialProgress
        : progress.data?.find((entry) => entry.videoId === activeVideoId))
    : undefined
  const resumeFrom = resumePositionLabel(activeProgress)
  const streams = useQuery({
    queryKey: ["streams", item.type, activeVideoId, addonIds, effectiveStreamAddonId ?? "all"],
    enabled: item.type !== "series" || episodeMode,
    queryFn: () => resolveStreams(requestedStreamAddons, item.type, activeVideoId!),
    staleTime: 5 * 60 * 1000,
  })
  useQuery({
    queryKey: ["streams", item.type, nextEpisode?.id, addonIds],
    enabled: Boolean(playing && nextEpisode),
    queryFn: () => resolveStreams(addons, item.type, nextEpisode!.id),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (streamAddonId && streamAddons.some((addon) => addon.id === streamAddonId)) return
    const rememberedAddonId = readPreferences().lastStreamAddonId
    const nextAddonId =
      rememberedAddonId && streamAddons.some((addon) => addon.id === rememberedAddonId)
        ? rememberedAddonId
        : undefined
    if (streamAddonId !== nextAddonId) setStreamAddonId(nextAddonId)
  }, [activeVideoId, streamAddonId, streamAddons])

  useEffect(() => {
    if (
      initialSeriesVideoResolved.current ||
      item.type !== "series" ||
      !initialVideoId ||
      initialVideoId === item.id ||
      !metadata.isSuccess ||
      (!progress.isSuccess && !progress.isError && !initialProgress) ||
      !videos.length
    )
      return
    initialSeriesVideoResolved.current = true
    const target = selectSeriesVideo(videos, seriesProgress, initialVideoId)
    setSelectedVideoId(target?.id)
    seriesReturnVideoId.current = target?.id
  }, [
    initialProgress,
    initialVideoId,
    item.type,
    metadata.isSuccess,
    progress.isError,
    progress.isSuccess,
    seriesProgress,
    videos,
  ])

  useEffect(() => {
    const finishWithoutAutoResume = () => {
      autoResumeAttemptedKey.current = autoResumeAttemptKey
      autoFallbackStream.current = undefined
      setAutoResumeStage("inactive")
    }

    if (!autoResumeEligible) {
      finishWithoutAutoResume()
      return
    }
    if (autoResumeAttemptedKey.current === autoResumeAttemptKey) return
    if (item.type === "series" && (metadata.isError || progress.isError)) {
      finishWithoutAutoResume()
      return
    }
    if (item.type === "series" && (!metadata.isSuccess || !progress.isSuccess)) return
    if (item.type === "series" && !activeVideoId) {
      if (initialSeriesVideoResolved.current) finishWithoutAutoResume()
      return
    }
    if (!activeVideoId) return
    if (item.type === "series" && activeVideoId !== initialProgress?.videoId) {
      finishWithoutAutoResume()
      return
    }
    if (!savedPlaybackSource) {
      finishWithoutAutoResume()
      return
    }
    autoResumeAttemptedKey.current = autoResumeAttemptKey
    autoFallbackStream.current = undefined
    autoRecoveryCandidate.current = undefined
    autoRecoveryFailedStream.current = undefined
    autoRecoveryUsedSavedSource.current = false
    autoRecoveryFailurePending.current = false
    autoResolutionPending.current = true
    setAutoResumeStage("resolving")
    const requestVersion = ++autoResumeRequestVersion.current
    void resolveStreamsProgressively(streamAddons, item.type, activeVideoId, (partial) => {
      if (
        requestVersion !== autoResumeRequestVersion.current ||
        autoRecoveryCandidate.current ||
        autoRecoveryFailurePending.current
      )
        return
      const saved = selectSavedStream(partial, savedPlaybackSource)
      // A partial result can safely win early only when the saved provider has
      // answered. Otherwise a later provider could make a cross-provider group
      // match ambiguous.
      if (!saved || saved.addonId !== savedPlaybackSource.addonId) return
      autoRecoveryCandidate.current = saved
      autoRecoveryUsedSavedSource.current = true
      autoFallbackStream.current = selectSingleAutoStream(partial, saved)
      setStreamResolutionError(undefined)
      setPlaying(saved)
      setAutoResumeStage("starting")
    })
      .then((resolved) => {
        if (requestVersion !== autoResumeRequestVersion.current) return
        autoResolutionPending.current = false
        queryClient.setQueryData(
          ["streams", item.type, activeVideoId, addonIds, "all"],
          resolved,
        )
        if (autoRecoveryFailurePending.current) {
          autoRecoveryFailurePending.current = false
          const fallback = selectSingleAutoStream(resolved, autoRecoveryFailedStream.current)
          autoRecoveryFailedStream.current = undefined
          if (fallback) {
            setStreamResolutionError(undefined)
            setPlaying(fallback)
            setAutoResumeStage("starting")
          } else {
            setPlaying(undefined)
            setAutoResumeStage("picker")
            setStreamResolutionError("The source could not be started. Choose another source below.")
          }
          return
        }
        if (autoRecoveryCandidate.current) {
          autoFallbackStream.current = selectSingleAutoStream(
            resolved,
            autoRecoveryCandidate.current,
          )
          return
        }
        const saved = selectSavedStream(resolved, savedPlaybackSource)
        autoRecoveryUsedSavedSource.current = Boolean(saved)
        const candidate = saved ?? selectSingleAutoStream(resolved)
        autoFallbackStream.current = saved ? selectSingleAutoStream(resolved, saved) : undefined
        if (!candidate) {
          setPlaying(undefined)
          setAutoResumeStage("picker")
          setStreamResolutionError(
            resolved.length
              ? "Saved source unavailable. Choose another source below."
              : "No sources were returned. Choose another source below.",
          )
          return
        }
        setStreamResolutionError(undefined)
        setPlaying(candidate)
        setAutoResumeStage("starting")
      })
      .catch(() => {
        if (requestVersion !== autoResumeRequestVersion.current) return
        autoResolutionPending.current = false
        setPlaying(undefined)
        setAutoResumeStage("picker")
        setStreamResolutionError("Saved source could not be loaded. Choose another source below.")
      })
  }, [
    activeVideoId,
    addonIds,
    autoResumeAttemptKey,
    autoResumeEligible,
    autoResumeOnOpen,
    effectiveStreamAddonId,
    initialProgress,
    item.type,
    metadata.isError,
    metadata.isSuccess,
    progress.isError,
    progress.isSuccess,
    queryClient,
    savedPlaybackSource,
    streamAddons,
  ])

  useEffect(() => {
    if (selectedVideo && selectedSeason == null) {
      setSelectedSeason(selectedVideo.season ?? 1)
      return
    }
    if (selectedVideo || videos.length === 0) return
    const fallbackSeason = sortSeasons(videos.map((video) => video.season ?? 1))[0] ?? 1
    const returnedVideo = videos.find((video) => video.id === seriesReturnVideoId.current)
    const targetSeason = seriesProgressReady
      ? returnedVideo?.season ?? seriesSelectorTarget?.season ?? fallbackSeason
      : fallbackSeason
    if (
      selectedSeason == null ||
      (seriesProgressReady && !seriesSeasonManuallySelected.current && selectedSeason !== targetSeason)
    ) {
      setSelectedSeason(targetSeason)
    }
  }, [selectedSeason, selectedVideo, seriesProgressReady, seriesSelectorTarget, videos])

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

  const selectStreamAddon = (addonId?: string) => {
    setStreamAddonId(addonId)
    writePreferences({ ...readPreferences(), lastStreamAddonId: addonId })
  }

  const autoplayNextEpisode = (allowAutoplay = true) => {
    if (!allowAutoplay || !nextEpisode || !readPreferences().autoplay) {
      setPlaying(undefined)
      return
    }
    openEpisodeSources(nextEpisode)
  }

  const cancelPendingAutoResume = useCallback(() => {
    autoResumeRequestVersion.current += 1
    autoResolutionPending.current = false
    autoRecoveryFailurePending.current = false
    autoRecoveryCandidate.current = undefined
    autoRecoveryFailedStream.current = undefined
    autoRecoveryUsedSavedSource.current = false
    autoResumeAttemptedKey.current = autoResumeAttemptKey
    autoFallbackStream.current = undefined
    setAutoResumeStage("inactive")
    setStreamResolutionError(undefined)
  }, [autoResumeAttemptKey])

  const clearSavedPlaybackSource = useCallback(() => {
    const progressToClear = activeProgress?.playbackSource
      ? activeProgress
      : initialProgress?.playbackSource
        ? initialProgress
        : undefined
    if (!progressToClear?.playbackSource || !activeVideoId) return
    void api(progressPath(profileId, activeVideoId), {
      method: "PUT",
      body: JSON.stringify({
        mediaType: progressToClear.mediaType,
        mediaId: progressToClear.mediaId,
        name: progressToClear.name,
        ...(progressToClear.poster ? { poster: progressToClear.poster } : {}),
        ...(progressToClear.videoTitle ? { videoTitle: progressToClear.videoTitle } : {}),
        ...(progressToClear.season !== undefined ? { season: progressToClear.season } : {}),
        ...(progressToClear.episode !== undefined ? { episode: progressToClear.episode } : {}),
        positionMs: progressToClear.positionMs,
        durationMs: progressToClear.durationMs,
        watched: progressToClear.watched,
        playbackSource: null,
      }),
    })
      .then(() =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
          queryClient.invalidateQueries({ queryKey: ["series-progress", profileId] }),
        ]),
      )
      .catch(() => undefined)
  }, [activeProgress, activeVideoId, initialProgress, profileId, queryClient])

  const handleAutoRecoveryStarted = useCallback(() => {
    autoFallbackStream.current = undefined
    setAutoResumeStage("inactive")
  }, [])

  const handleAutoRecoveryFailed = useCallback(() => {
    const savedSourceWasUsed = autoRecoveryUsedSavedSource.current
    autoRecoveryUsedSavedSource.current = false
    if (savedSourceWasUsed) clearSavedPlaybackSource()
    autoRecoveryFailedStream.current = autoRecoveryCandidate.current
    autoRecoveryCandidate.current = undefined
    const fallback = autoFallbackStream.current
    autoFallbackStream.current = undefined
    if (autoResolutionPending.current) {
      autoRecoveryFailurePending.current = true
      setPlaying(undefined)
      setAutoResumeStage("resolving")
      return
    }
    if (fallback) {
      setPlaying(fallback)
      setAutoResumeStage("starting")
      return
    }
    setPlaying(undefined)
    setAutoResumeStage("picker")
    setStreamResolutionError("The source could not be started. Choose another source below.")
  }, [clearSavedPlaybackSource])

  const openEpisodeSources = (video: Video) => {
    episodeTransition.current += 1
    cancelPendingAutoResume()
    setStreamResolutionError(undefined)
    setPlaying(undefined)
    setSelectedVideoId(video.id)
    setSelectedSeason(video.season ?? 1)
    seriesReturnVideoId.current = video.id
  }

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
              profileId={profileId}
              media={mediaForWatchActions(meta)}
              onWatchAction={async (targets, watched) => {
                try {
                  await setVideosWatched(
                    profileId,
                    mediaForWatchActions(meta),
                    targets,
                    progress.data ?? [],
                    watched,
                  )
                } finally {
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
                    queryClient.invalidateQueries({ queryKey: ["series-progress", profileId] }),
                  ])
                }
              }}
              season={selectedSeason}
              restoreScrollTop={episodeRailScrollTop.current}
              focusVideoId={seriesReturnVideoId.current}
              autoPositionVideoId={seriesSelectorTarget?.id}
              onSeasonChange={(season) => {
                episodeRailScrollTop.current = 0
                seriesReturnVideoId.current = undefined
                seriesSeasonManuallySelected.current = true
                setSelectedSeason(season)
              }}
              onScroll={(scrollTop) => {
                episodeRailScrollTop.current = scrollTop
              }}
              onSelect={(video) => {
                cancelPendingAutoResume()
                seriesReturnVideoId.current = video.id
                setSelectedVideoId(video.id)
              }}
            />
          ) : shouldWaitForSavedPlayback ? (
            <StreamSelectionLoading
              artwork={{
                background: meta.background,
                logo: meta.logo,
                poster: meta.poster,
              }}
              title={selectedVideo?.title ?? meta.name}
              hasNextEpisode={Boolean(nextEpisode)}
              onBack={() => {
                cancelPendingAutoResume()
                onClose()
              }}
            />
          ) : (
            <StreamRail
              streams={streams.data ?? []}
              loading={streams.isFetching}
              error={streamResolutionError}
              videoTitle={selectedVideo?.title ?? meta.name}
              resumeFrom={resumeFrom}
              addons={streamAddons}
              selectedAddonId={streamAddonId}
              onSelectAddon={selectStreamAddon}
              onRefresh={() => {
                setStreamResolutionError(undefined)
                void streams.refetch()
              }}
              onPlay={(stream) => {
                cancelPendingAutoResume()
                setStreamResolutionError(undefined)
                setPlaying(stream)
              }}
              onBackToSeries={
                !streamSelectionReturnToHome && episodeMode && selectedVideo
                  ? () => {
                      setSelectedSeason(selectedVideo.season ?? 1)
                      seriesReturnVideoId.current = selectedVideo.id
                      setSelectedVideoId(undefined)
                    }
                  : undefined
              }
              onBack={streamSelectionReturnToHome ? onClose : undefined}
            />
          )}
        </main>
      </div>

      {playing?.url && (
        <Player
          accountId={accountId}
          url={playing.url}
          type={item.type}
          videoId={activeVideoId!}
          profileId={profileId}
          playbackSource={playbackSourceForStream(playing)}
          progressMetadata={{
            mediaType: item.type,
            mediaId: item.id,
            name: meta.name,
            poster: meta.poster,
            videoTitle: selectedVideo?.title,
            season: selectedVideo?.season,
            episode: selectedVideo?.episode,
          }}
          artwork={{
            background: meta.background,
            logo: meta.logo,
            poster: meta.poster,
          }}
          addons={addons}
          seriesContext={
            selectedVideo
              ? {
                  name: meta.name,
                  profileId,
                  media: mediaForWatchActions(meta),
                  onWatchAction: async (targets, watched) => {
                    try {
                      await setVideosWatched(
                        profileId,
                        mediaForWatchActions(meta),
                        targets,
                        progress.data ?? [],
                        watched,
                      )
                    } finally {
                      await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
                        queryClient.invalidateQueries({ queryKey: ["series-progress", profileId] }),
                      ])
                    }
                  },
                  videos,
                  progress: progress.data ?? [],
                  currentVideoId: selectedVideo.id,
                }
              : undefined
          }
          nextEpisode={nextEpisode}
          nextEpisodeLabel={nextEpisode ? episodeLabel(nextEpisode) : undefined}
          onSelectEpisode={openEpisodeSources}
          onNextEpisode={nextEpisode ? () => openEpisodeSources(nextEpisode) : undefined}
          onEnded={autoplayNextEpisode}
          autoRecoveryAttempt={autoResumeStage === "starting"}
          onAutoRecoveryStarted={handleAutoRecoveryStarted}
          onAutoRecoveryFailed={handleAutoRecoveryFailed}
          onClose={() => {
            episodeTransition.current += 1
            cancelPendingAutoResume()
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
  const description = meta.description?.trim()
  const awards = meta.awards?.trim()
  const facts = [meta.runtime, meta.releaseInfo ?? displayDate(meta.released), meta.contentRating]
    .map((fact) => fact?.trim())
    .filter((fact): fact is string => Boolean(fact))
  const imdbRating = meta.imdbRating?.trim()
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
      {meta.logo && (
        <h1 id="media-title" className="sr-only">
          {meta.name}
        </h1>
      )}

      <div className="mt-[clamp(.75rem,2.3vh,1.5rem)] flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-medium text-zinc-200">
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
        {imdbRating && (
          <span className="flex items-center gap-1.5">
            <Star className="fill-amber-400 text-amber-400" size={14} />
            {imdbRating}
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
          onBrowse ? (value) => onBrowse({ kind: "genre", value, mediaType: meta.type }) : undefined
        }
      />
      {description ? (
        <p className="mt-[clamp(.75rem,2vh,1.35rem)] line-clamp-4 max-w-4xl text-sm leading-6 text-zinc-300">
          {description}
        </p>
      ) : (
        <p className="mt-4 text-sm italic text-zinc-500">No synopsis was supplied.</p>
      )}
      <Credits label="Directors" values={meta.director} onSelect={onBrowse} />
      <Credits label="Cast" values={meta.cast} onSelect={onBrowse} />
      <Credits label="Writers" values={meta.writer} onSelect={onBrowse} />
      {meta.country && <Credits label="Country" values={[meta.country]} onSelect={onBrowse} />}
      {awards && <p className="mt-2 line-clamp-1 text-xs text-zinc-500">{awards}</p>}

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
  const watchState = episodeWatchState(state)
  const percent = episodeProgressPercent(state)
  const visiblePercent = watchState === "in-progress" ? `${percent}%` : undefined
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
      <p className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
        <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
          <span
            className="block h-full bg-amber-400"
            style={{ width: `${watchState === "watched" ? 100 : percent}%` }}
          />
        </span>
        {visiblePercent}
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
  resumeFrom,
  addons,
  selectedAddonId,
  onSelectAddon,
  onRefresh,
  onPlay,
  onBackToSeries,
  onBack,
}: {
  streams: ResolvedStream[]
  loading: boolean
  error?: string
  videoTitle: string
  resumeFrom?: string
  addons: InstalledAddon[]
  selectedAddonId?: string
  onSelectAddon: (addonId?: string) => void
  onRefresh: () => void
  onPlay: (stream: ResolvedStream) => void
  onBackToSeries?: () => void
  onBack?: () => void
}) {
  const back = onBack ?? onBackToSeries
  return (
    <aside className="min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950/80 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="sticky top-0 z-10 flex items-center gap-2 rounded-t-2xl border-b border-white/8 bg-zinc-950/95 px-4 py-4 backdrop-blur">
        {back && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            aria-label={onBack ? "Back" : "Back to series episodes"}
            onClick={back}
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
      {resumeFrom && (
        <p
          aria-label={`Resume from ${resumeFrom}`}
          className="mx-2 mt-3 mb-2 w-fit max-w-[calc(100%-1rem)] rounded-full bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-100"
        >
          Resume from <span className="tabular-nums">{resumeFrom}</span>
        </p>
      )}
      <div className="flex gap-2 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Button
          size="icon"
          variant="secondary"
          className="shrink-0 rounded-full"
          aria-label="Refresh sources"
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} size={16} />
        </Button>
        <Button
          size="sm"
          variant={selectedAddonId == null ? "default" : "secondary"}
          className="shrink-0 rounded-full"
          aria-pressed={selectedAddonId == null}
          onClick={() => onSelectAddon(undefined)}
        >
          All
        </Button>
        {addons.map((addon) => (
          <Button
            key={addon.id}
            size="sm"
            variant={selectedAddonId === addon.id ? "default" : "secondary"}
            className="shrink-0 rounded-full"
            aria-pressed={selectedAddonId === addon.id}
            onClick={() => onSelectAddon(addon.id)}
          >
            {addon.manifest.name}
          </Button>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="m-2 rounded-xl border border-amber-400/25 bg-amber-400/8 p-3 text-xs leading-5 text-amber-100"
        >
          {error}
        </p>
      )}
      {loading && (
        <p className="flex items-center gap-2 bg-black/65 px-3 py-6 text-sm text-zinc-300">
          <LoaderCircle className="animate-spin" size={16} />
          Asking installed add-ons…
        </p>
      )}
      {!loading && streams.length === 0 && (
        <div className="m-2 rounded-xl border border-dashed border-white/10 p-5 text-sm text-zinc-500">
          No installed add-on returned a stream. Metadata and navigation are still available.
        </div>
      )}
      <div className="space-y-2 px-2 pb-2">
        {streams.map((stream) => {
          const title = stream.name ?? stream.title ?? stream.addonName
          const description =
            stream.description ?? stream.title ?? `Provided by ${stream.addonName}`
          return (
            <div
              className="rounded-xl border border-white/8 bg-white/[0.035] p-3.5 transition hover:border-white/20 hover:bg-white/[0.065]"
              key={stream.key}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-sm font-semibold [overflow-wrap:anywhere]">
                    {title}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-400 [overflow-wrap:anywhere]">
                    {description}
                  </p>
                  <p className="mt-1.5 text-[10px] font-medium text-zinc-600">{stream.addonName}</p>
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
                    onClick={() => window.open(stream.externalUrl, "_blank", "noopener,noreferrer")}
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

function StreamSelectionLoading({
  artwork,
  title,
  hasNextEpisode,
  onBack,
}: {
  artwork: PlayerArtwork
  title: string
  hasNextEpisode: boolean
  onBack: () => void
}) {
  const [fullscreen, setFullscreen] = useState(false)
  const [spaciousViewport, setSpaciousViewport] = useState(() =>
    usesExpandedPlayerControls(window.innerWidth, window.innerHeight),
  )
  const expandedControls = fullscreen || spaciousViewport

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    const syncLayout = () => {
      setSpaciousViewport(usesExpandedPlayerControls(window.innerWidth, window.innerHeight))
      void nativeFullscreen()
        .then((value) => {
          if (!cancelled) setFullscreen(value)
        })
        .catch(() => undefined)
    }

    syncLayout()
    window.addEventListener("resize", syncLayout)
    if (window.__CONDUIT_ELECTRON__) {
      void onNativeFullscreenChange((value) => {
        if (!cancelled) setFullscreen(value)
      })
        .then((removeListener) => {
          if (cancelled) removeListener()
          else unsubscribe = removeListener
        })
        .catch(() => undefined)
    }

    return () => {
      cancelled = true
      window.removeEventListener("resize", syncLayout)
      unsubscribe?.()
    }
  }, [])

  return (
    <div className="saved-stream-loading-overlay absolute inset-0 z-40 overflow-hidden bg-black">
      <DesktopPlayerOpeningOverlay artwork={artwork} title={title} />
      <DesktopPlayerChrome
        expandedControls={expandedControls}
        visible
        fullscreen={fullscreen}
        fullscreenDisabled
        heading={
          <div className="min-w-0 drop-shadow-lg">
            <h2
              className={`truncate font-display font-semibold ${
                expandedControls ? "text-2xl" : "text-lg"
              }`}
            >
              {title}
            </h2>
          </div>
        }
        description={
          <p className={`mt-1 truncate text-zinc-400 ${expandedControls ? "text-sm" : "text-xs"}`}>
            Loading saved stream…
          </p>
        }
        onBack={onBack}
        bottom={
          <>
            <div className="flex items-center gap-3" data-native-overlay>
              <span
                className={`player-time player-time-elapsed tabular-nums text-zinc-300 ${
                  expandedControls ? "text-base" : "text-sm"
                }`}
                aria-label="Elapsed time"
              >
                --:--:--
              </span>
              <input
                className={`player-seek block min-w-0 flex-1 cursor-pointer ${
                  expandedControls ? "h-2" : "h-1.5"
                }`}
                style={{ "--player-progress": "0%", "--player-buffered": "0%" } as CSSProperties}
                type="range"
                min={0}
                max={0}
                step={0.1}
                value={0}
                aria-label="Seek"
                disabled
              />
              <button
                className={`player-time player-time-duration cursor-pointer border-0 p-0 tabular-nums text-zinc-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                  expandedControls ? "text-base" : "text-sm"
                }`}
                type="button"
                aria-label="End time. Click to show time remaining."
                title="Click to show time remaining"
                disabled
              >
                --:--:--
              </button>
            </div>

            <div
              className={`flex items-center ${
                expandedControls ? "mt-5 gap-3" : "mt-3 gap-1 sm:gap-2"
              }`}
              data-native-overlay
            >
              <DesktopPlayerControl label="Pause" expanded={expandedControls} disabled>
                <Pause size={22} />
              </DesktopPlayerControl>
              {hasNextEpisode && (
                <DesktopPlayerControl label="Next episode" expanded={expandedControls} disabled>
                  <SkipForward size={21} />
                </DesktopPlayerControl>
              )}
              <DesktopPlayerControl label="Mute" expanded={expandedControls} disabled>
                <Volume2 size={21} />
              </DesktopPlayerControl>
              <input
                className={`player-volume hidden sm:block ${expandedControls ? "w-32" : "w-20"}`}
                style={{ "--player-volume": "0%" } as CSSProperties}
                type="range"
                min={0}
                max={100}
                value={0}
                aria-label="Volume"
                disabled
              />
              <div className="flex-1" />
              <DesktopPlayerControl label="Audio" expanded={expandedControls} disabled>
                <Languages size={21} />
              </DesktopPlayerControl>
              <DesktopPlayerControl label="Subtitles" expanded={expandedControls} disabled>
                <Captions size={22} />
              </DesktopPlayerControl>
              <DesktopPlayerControl label="Video scale" expanded={expandedControls} disabled>
                <Scaling size={21} />
              </DesktopPlayerControl>
            </div>
          </>
        }
      />
    </div>
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
    mutationFn: () => setEpisodeWatched(profileId, media, video, item, !item?.watched),
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
  const visibleValues = [...new Set(values?.map((value) => value.trim()).filter(Boolean) ?? [])]
  if (!visibleValues.length) return null
  return (
    <div className="mt-[clamp(.65rem,1.8vh,1.15rem)]">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {visibleValues.map((value) =>
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
            <span key={value} className="rounded-full bg-white/8 px-3 py-1 text-xs text-zinc-200">
              {value}
            </span>
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
  const visibleValues = [...new Set(values?.map((value) => value.trim()).filter(Boolean) ?? [])]
  if (!visibleValues.length) return null
  return (
    <div className="mt-2.5 min-w-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <div className="flex max-h-8 flex-wrap gap-1.5 overflow-hidden text-xs">
        {visibleValues.map((value) => (
          <span key={value}>
            {onSelect ? (
              <button
                type="button"
                className="rounded-full bg-white/8 px-2.5 py-1 text-zinc-300 transition hover:bg-amber-400 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                onClick={() => onSelect({ kind: "search", value })}
              >
                {value}
              </button>
            ) : (
              <span className="rounded-full bg-white/8 px-2.5 py-1 text-zinc-300">{value}</span>
            )}
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
  return resolveStreamsProgressively(addons, type, videoId, () => undefined)
}

async function resolveStreamsProgressively(
  addons: InstalledAddon[],
  type: string,
  videoId: string,
  onUpdate: (streams: ResolvedStream[], pendingAddons: number) => void,
): Promise<ResolvedStream[]> {
  const candidates = addonsForResource(addons, "stream", type, videoId)
  const pending = candidates.map((addon, index) => ({
    index,
    promise: withTimeout(loadStreams(addon.manifestUrl, type, videoId), AUTO_SELECTION_STARTUP_TIMEOUT_MS)
      .then((streams) => ({ addon, streams }))
      .catch(() => ({ addon, streams: [] })),
  }))
  const resolved: ResolvedStream[] = []

  while (pending.length) {
    const result = await Promise.race(
      pending.map(({ index, promise }) =>
        promise.then(({ addon, streams }) => ({ index, addon, streams })),
      ),
    )
    const resultIndex = pending.findIndex((entry) => entry.index === result.index)
    if (resultIndex >= 0) pending.splice(resultIndex, 1)
    resolved.push(...resolvedStreamsForAddon(result.addon, result.streams))
    onUpdate(resolved, pending.length)
  }

  return resolved
}

function resolvedStreamsForAddon(addon: InstalledAddon, streams: Stream[]): ResolvedStream[] {
  return streams.map((stream, index) => ({
    ...stream,
    addonId: addon.id,
    externalUrl: safeExternalUrl(stream.externalUrl),
    key: `${addon.id}:${index}:${stream.url ?? stream.infoHash ?? stream.externalUrl ?? "stream"}`,
    addonName: addon.manifest.name,
  }))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Stream request timed out")), timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
