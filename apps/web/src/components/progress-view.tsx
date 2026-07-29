import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Film, History, Play, Trash2 } from "lucide-react"
import { api, type WatchProgress } from "../lib/api"
import type { CatalogItem } from "../lib/core"
import { Card } from "./ui/card"

export function useProgressList(profileId: string, view: "continue" | "history", limit = 50) {
  return useQuery({
    queryKey: ["progress", profileId, view],
    queryFn: () =>
      api<{ items: WatchProgress[] }>(
        `/v1/profiles/${profileId}/progress?view=${view}&limit=${limit}`,
      ).then((result) => result.items),
  })
}

export function ContinueWatching({
  profileId,
  onSelect,
}: {
  profileId: string
  onSelect: (item: CatalogItem, videoId: string) => void
}) {
  const progress = useProgressList(profileId, "continue", 14)
  if (!progress.data?.length) return null
  return (
    <section className="mb-12">
      <h2 className="mb-4 font-display text-xl font-semibold">Continue Watching</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
        {progress.data.map((item) => (
          <ProgressCard key={item.videoId} item={item} onSelect={onSelect} />
        ))}
      </div>
    </section>
  )
}

export function HistoryView({
  profileId,
  onSelect,
}: {
  profileId: string
  onSelect: (item: CatalogItem, videoId: string) => void
}) {
  const progress = useProgressList(profileId, "history")
  return (
    <main className="mx-auto max-w-[2200px] px-4 py-9 sm:px-6 lg:px-8 xl:px-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">Your activity</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Watch history</h1>
      <p className="mt-2 text-zinc-500">Resume, update watched state, or remove an entry.</p>
      {progress.data?.length ? (
        <div className="mt-8 space-y-3">
          {progress.data.map((item) => (
            <HistoryRow key={item.videoId} item={item} profileId={profileId} onSelect={onSelect} />
          ))}
        </div>
      ) : (
        <Card className="mt-8 grid min-h-64 place-items-center border-dashed text-zinc-500">
          <div className="text-center"><History className="mx-auto mb-3 text-zinc-700" />No watch history yet.</div>
        </Card>
      )}
    </main>
  )
}

function ProgressCard({
  item,
  onSelect,
}: {
  item: WatchProgress
  onSelect: (item: CatalogItem, videoId: string) => void
}) {
  const percent = item.durationMs ? Math.min(100, (item.positionMs / item.durationMs) * 100) : 0
  return (
    <button className="group text-left" onClick={() => onSelect(toCatalogItem(item), item.videoId)}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-800 transition group-hover:-translate-y-1 group-hover:ring-amber-400/60">
        {item.poster ? <img className="h-full w-full object-cover" src={item.poster} alt="" /> : <div className="grid h-full place-items-center text-zinc-700"><Film /></div>}
        <span className="absolute inset-x-0 bottom-0 h-1 bg-zinc-700"><span className="block h-full bg-amber-400" style={{ width: `${percent}%` }} /></span>
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-medium">{item.name}</p>
      <p className="line-clamp-1 text-xs text-zinc-500">{episodeLabel(item)}</p>
    </button>
  )
}

function HistoryRow({
  item,
  profileId,
  onSelect,
}: {
  item: WatchProgress
  profileId: string
  onSelect: (item: CatalogItem, videoId: string) => void
}) {
  const queryClient = useQueryClient()
  const path = `/v1/profiles/${profileId}/progress/${encodeURIComponent(item.videoId)}`
  const update = useMutation({
    mutationFn: (watched: boolean) =>
      api(path, { method: "PATCH", body: JSON.stringify({ watched }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
  })
  const remove = useMutation({
    mutationFn: () => api(path, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
  })
  return (
    <Card className="flex items-center gap-4 p-3">
      <button className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => onSelect(toCatalogItem(item), item.videoId)}>
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-zinc-900 text-zinc-700">{item.poster ? <img className="h-full w-full object-cover" src={item.poster} alt="" /> : <Film />}</div>
        <div className="min-w-0"><p className="truncate font-medium">{item.name}</p><p className="truncate text-sm text-zinc-500">{episodeLabel(item)} · {item.watched ? "Watched" : `${Math.round(item.positionMs / 60000)} min in`}</p></div>
        <Play className="shrink-0 text-amber-400" size={18} />
      </button>
      <button aria-label={item.watched ? "Mark unwatched" : "Mark watched"} className="p-2 text-zinc-500 hover:text-amber-300" onClick={() => update.mutate(!item.watched)}><Check size={18} /></button>
      <button aria-label="Remove from history" className="p-2 text-zinc-500 hover:text-red-400" onClick={() => remove.mutate()}><Trash2 size={18} /></button>
    </Card>
  )
}

function toCatalogItem(item: WatchProgress): CatalogItem {
  return { id: item.mediaId, type: item.mediaType, name: item.name, poster: item.poster }
}

function episodeLabel(item: WatchProgress) {
  if (item.season != null && item.episode != null) return `S${item.season} E${item.episode}${item.videoTitle ? ` · ${item.videoTitle}` : ""}`
  return item.videoTitle ?? (item.watched ? "Watched" : "Resume")
}
