import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ExternalLink, Film, LoaderCircle, Play, RotateCcw, X } from "lucide-react"
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
import { Button } from "./ui/button"
import { Card } from "./ui/card"
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
  const [selectedVideoId, setSelectedVideoId] = useState(initialVideoId ?? item.id)
  const [playing, setPlaying] = useState<ResolvedStream>()

  const metadata = useQuery({
    queryKey: ["meta", item.type, item.id, addons.map((addon) => addon.id)],
    queryFn: () => resolveMetadata(addons, item),
  })

  const meta: MetaItem = metadata.data ?? { ...item, videos: [] }
  const videos = meta.videos ?? []
  const progress = useQuery({
    queryKey: ["progress", profileId],
    queryFn: () =>
      api<{ items: WatchProgress[] }>(`/v1/profiles/${profileId}/progress?limit=100`).then(
        (result) => result.items,
      ),
  })

  useEffect(() => {
    if (item.type === "series" && videos[0] && selectedVideoId === item.id) {
      setSelectedVideoId(videos[0].id)
    }
  }, [item.id, item.type, selectedVideoId, videos])

  const streams = useQuery({
    queryKey: ["streams", item.type, selectedVideoId, addons.map((addon) => addon.id)],
    enabled: item.type !== "series" || selectedVideoId !== item.id,
    queryFn: () => resolveStreams(addons, item.type, selectedVideoId),
  })

  const selectedVideo = videos.find((video) => video.id === selectedVideoId)

  return (
    <>
      <div
        className="fixed inset-0 z-30 overflow-y-auto bg-zinc-950/95 backdrop-blur-lg"
        role="dialog"
        aria-modal="true"
      >
        <div className="mx-auto min-h-screen max-w-6xl px-5 py-8">
          <div className="mb-6 flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              <X size={17} /> Close
            </Button>
          </div>

          <div className="grid gap-8 md:grid-cols-[220px_1fr]">
            <Poster item={meta} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
                {item.type}
              </p>
              <h1 className="mt-2 font-display text-4xl font-semibold">{meta.name}</h1>
              {(meta.releaseInfo || meta.runtime) && (
                <p className="mt-2 text-sm text-zinc-500">
                  {[meta.releaseInfo, meta.runtime].filter(Boolean).join(" · ")}
                </p>
              )}
              {meta.description && (
                <p className="mt-5 max-w-3xl leading-7 text-zinc-300">{meta.description}</p>
              )}
              <div className="mt-6">
                <LibraryToggle profileId={profileId} item={meta} />
              </div>

              {videos.length > 0 && (
                <EpisodePicker
                  videos={videos}
                  profileId={profileId}
                  media={{ type: item.type, id: item.id, name: meta.name, poster: meta.poster }}
                  selectedVideoId={selectedVideoId}
                  progress={progress.data ?? []}
                  onChange={setSelectedVideoId}
                />
              )}

              <StreamList
                streams={streams.data ?? []}
                loading={streams.isLoading}
                error={streams.error}
                videoTitle={selectedVideo?.title ?? meta.name}
                onPlay={setPlaying}
              />
            </div>
          </div>
        </div>
      </div>

      {playing?.url && (
        <Player
          url={playing.url}
          title={playing.title ?? playing.name ?? meta.name}
          type={item.type}
          videoId={selectedVideoId}
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

function Poster({ item }: { item: CatalogItem }) {
  return (
    <div className="aspect-[2/3] overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-zinc-800">
      {item.poster ? (
        <img className="h-full w-full object-cover" src={item.poster} alt="" />
      ) : (
        <div className="grid h-full place-items-center text-zinc-700">
          <Film size={36} />
        </div>
      )}
    </div>
  )
}

function EpisodePicker({
  videos,
  profileId,
  media,
  selectedVideoId,
  progress,
  onChange,
}: {
  videos: Video[]
  profileId: string
  media: { type: string; id: string; name: string; poster?: string }
  selectedVideoId: string
  progress: WatchProgress[]
  onChange: (id: string) => void
}) {
  const seasons = useMemo(
    () => [...new Set(videos.map((video) => video.season).filter(Boolean))].sort((a, b) => a! - b!),
    [videos],
  )
  const selectedVideo = videos.find((video) => video.id === selectedVideoId)
  const [season, setSeason] = useState(selectedVideo?.season ?? seasons[0] ?? 1)
  const episodes = videos.filter((video) => (video.season ?? 1) === season)

  useEffect(() => {
    if (!episodes.some((video) => video.id === selectedVideoId) && episodes[0]) {
      onChange(episodes[0].id)
    }
  }, [episodes, onChange, selectedVideoId])

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-display text-xl font-semibold">Episodes</h2>
        {seasons.length > 1 && (
          <select
            className="h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm"
            value={season}
            onChange={(event) => setSeason(Number(event.target.value))}
          >
            {seasons.map((value) => (
              <option key={value} value={value}>
                Season {value}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {episodes.map((video) => {
          const state = progress.find((item) => item.videoId === video.id)
          const percent =
            state && state.durationMs > 0
              ? Math.min(100, Math.round((state.positionMs / state.durationMs) * 100))
              : 0
          return (
            <div className="relative" key={video.id}>
              <Button
                size="sm"
                variant={video.id === selectedVideoId ? "default" : "secondary"}
                onClick={() => onChange(video.id)}
              >
                {state?.watched && <Check size={14} />}
                {video.episode ? `E${video.episode}` : (video.title ?? video.id)}
              </Button>
              {!state?.watched && percent > 0 && (
                <span className="absolute inset-x-1 bottom-0 h-0.5 overflow-hidden rounded bg-zinc-700">
                  <span className="block h-full bg-amber-400" style={{ width: `${percent}%` }} />
                </span>
              )}
            </div>
          )
        })}
      </div>
      <EpisodeWatchAction
        profileId={profileId}
        item={progress.find((item) => item.videoId === selectedVideoId)}
        video={videos.find((video) => video.id === selectedVideoId)}
        media={media}
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
  video?: Video
  media: { type: string; id: string; name: string; poster?: string }
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => {
      const path = `/v1/profiles/${profileId}/progress/${encodeURIComponent(video!.id)}`
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
              videoTitle: video?.title,
              season: video?.season,
              episode: video?.episode,
              positionMs: 0,
              durationMs: 0,
              watched: true,
            }),
          })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
  })
  if (!video || !profileId) return null
  return (
    <button
      className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-amber-300"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {item?.watched ? <RotateCcw size={13} /> : <Check size={13} />}
      Mark {item?.watched ? "unwatched" : "watched"}
    </button>
  )
}

function StreamList({
  streams,
  loading,
  error,
  videoTitle,
  onPlay,
}: {
  streams: ResolvedStream[]
  loading: boolean
  error: Error | null
  videoTitle: string
  onPlay: (stream: ResolvedStream) => void
}) {
  return (
    <div className="mt-8">
      <h2 className="font-display text-xl font-semibold">Streams</h2>
      {loading && (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <LoaderCircle className="animate-spin" size={16} />
          Asking installed add-ons…
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-400">{error.message}</p>}
      {!loading && !error && streams.length === 0 && (
        <Card className="mt-4 border-dashed p-5 text-sm text-zinc-500">
          No installed add-on returned a stream for this item.
        </Card>
      )}
      <div className="mt-4 space-y-2">
        {streams.map((stream) => (
          <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center" key={stream.key}>
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-line text-sm font-medium">
                {stream.name ?? stream.title ?? stream.addonName}
              </p>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-zinc-500">
                {stream.description ?? stream.title ?? `Provided by ${stream.addonName}`}
              </p>
            </div>
            {stream.url ? (
              <Button onClick={() => onPlay(stream)}>
                <Play size={16} />
                Play
              </Button>
            ) : stream.externalUrl ? (
              <Button
                variant="secondary"
                onClick={() => window.open(stream.externalUrl, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={16} />
                Open
              </Button>
            ) : (
              <span
                className="text-xs text-zinc-600"
                title={`${videoTitle} returned a torrent source`}
              >
                Native playback required
              </span>
            )}
          </Card>
        ))}
      </div>
    </div>
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
  if (match) return match.value
  return item
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
      key: `${result.value.addon.id}:${index}:${stream.url ?? stream.infoHash ?? stream.externalUrl ?? "stream"}`,
      addonName: result.value.addon.manifest.name,
    }))
  })
}
