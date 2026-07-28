import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Captions, LoaderCircle, Pause, Play, Volume2, X } from "lucide-react"
import type { InstalledAddon } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import {
  nativePlayerCommand,
  nativePlayerSnapshot,
  openNativePlayer,
  stopNativePlayer,
  type NativePlayerSnapshot,
  type NativeTrack,
} from "../lib/desktop"
import { loadSubtitles } from "../lib/core"
import { Button } from "./ui/button"
import { Card } from "./ui/card"

export function DesktopPlayer({
  url,
  title,
  type,
  videoId,
  addons,
  onClose,
}: {
  url: string
  title: string
  type: string
  videoId: string
  addons: InstalledAddon[]
  onClose: () => void
}) {
  const [snapshot, setSnapshot] = useState<NativePlayerSnapshot>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    document.documentElement.classList.add("native-playback")
    void openNativePlayer(url, title)
      .then(async (initial) => {
        if (cancelled) return
        setSnapshot(initial)
        await attachAddonSubtitles(addons, type, videoId)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    const poll = window.setInterval(() => {
      void nativePlayerSnapshot()
        .then((next) => {
          if (!cancelled) setSnapshot(next)
        })
        .catch(() => undefined)
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      document.documentElement.classList.remove("native-playback")
      void stopNativePlayer()
    }
  }, [addons, title, type, url, videoId])

  const close = () => {
    void stopNativePlayer()
    onClose()
  }

  const audioTracks = snapshot?.tracks.filter((track) => track.type === "audio") ?? []
  const subtitleTracks = snapshot?.tracks.filter((track) => track.type === "sub") ?? []

  return createPortal(
    <div className="native-player fixed inset-0 z-50 overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
              Native mpv player
            </p>
            <h2 className="mt-1 truncate font-display text-2xl font-semibold">{title}</h2>
          </div>
          <Button variant="ghost" onClick={close}>
            <X size={17} /> Close playback
          </Button>
        </div>

        {error ? (
          <Card className="border-red-950 p-6">
            <p className="font-medium text-red-400">Could not start mpv</p>
            <p className="mt-2 text-sm text-zinc-400">{error}</p>
            <p className="mt-3 text-xs text-zinc-600">
              Install mpv or point CONDUIT_MPV_PATH at the mpv executable.
            </p>
          </Card>
        ) : !snapshot ? (
          <p className="flex items-center gap-2 text-zinc-400">
            <LoaderCircle className="animate-spin" size={18} /> Starting native playback…
          </p>
        ) : (
          <>
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <Button
                  size="icon"
                  onClick={() => {
                    void nativePlayerCommand(["cycle", "pause"])
                    setSnapshot((current) =>
                      current ? { ...current, paused: !current.paused } : current,
                    )
                  }}
                >
                  {snapshot.paused ? <Play size={18} /> : <Pause size={18} />}
                </Button>
                <input
                  className="h-1 flex-1 accent-amber-400"
                  type="range"
                  min={0}
                  max={snapshot.duration || 0}
                  value={Math.min(snapshot.position, snapshot.duration || 0)}
                  aria-label="Seek"
                  onChange={(event) => {
                    const position = Number(event.target.value)
                    void nativePlayerCommand(["seek", position, "absolute+exact"])
                    setSnapshot((current) => (current ? { ...current, position } : current))
                  }}
                />
                <span className="text-xs tabular-nums text-zinc-500">
                  {formatTime(snapshot.position)} / {formatTime(snapshot.duration)}
                </span>
              </div>
              <p className="mt-4 text-xs text-zinc-500">
                Video is rendered by embedded libmpv. These controls communicate directly with the
                native player engine.
              </p>
            </Card>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <TrackList
                icon={<Volume2 size={18} />}
                title="Audio"
                tracks={audioTracks}
                empty="No audio tracks reported yet."
                onSelect={(track) => void nativePlayerCommand(["set_property", "aid", track.id])}
              />
              <TrackList
                icon={<Captions size={18} />}
                title="Subtitles"
                tracks={subtitleTracks}
                empty="No embedded or add-on subtitles reported yet."
                allowOff
                onSelect={(track) => void nativePlayerCommand(["set_property", "sid", track.id])}
                onOff={() => void nativePlayerCommand(["set_property", "sid", "no"])}
              />
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

function TrackList({
  icon,
  title,
  tracks,
  empty,
  allowOff,
  onSelect,
  onOff,
}: {
  icon: React.ReactNode
  title: string
  tracks: NativeTrack[]
  empty: string
  allowOff?: boolean
  onSelect: (track: NativeTrack) => void
  onOff?: () => void
}) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
        {icon} {title}
      </h3>
      {allowOff && (
        <button
          className="mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-800"
          onClick={onOff}
        >
          Off
        </button>
      )}
      {tracks.map((track) => (
        <button
          key={track.id}
          className={`mb-1 block w-full rounded-lg px-3 py-2 text-left ${
            track.selected ? "bg-amber-400 text-zinc-950" : "text-zinc-300 hover:bg-zinc-800"
          }`}
          onClick={() => onSelect(track)}
        >
          <span className="block text-sm font-medium">
            {track.title || languageName(track.lang) || `${title} ${track.id}`}
          </span>
          <span className={`text-xs ${track.selected ? "text-zinc-800" : "text-zinc-500"}`}>
            {[track.codec?.toUpperCase(), track.lang, track.external ? "External" : "Embedded"]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
      ))}
      {!tracks.length && <p className="px-3 py-2 text-sm text-zinc-500">{empty}</p>}
    </Card>
  )
}

async function attachAddonSubtitles(
  addons: InstalledAddon[],
  type: string,
  videoId: string,
): Promise<void> {
  const candidates = addonsForResource(addons, "subtitles", type, videoId)
  const results = await Promise.allSettled(
    candidates.map(async (addon) => ({
      addon,
      subtitles: await loadSubtitles(addon.manifestUrl, type, videoId),
    })),
  )
  for (const result of results) {
    if (result.status === "rejected") continue
    for (const subtitle of result.value.subtitles) {
      if (!subtitle.url) continue
      const language =
        subtitle.lang ??
        subtitle.language ??
        subtitle.languageCode ??
        subtitle.locale ??
        subtitle.label ??
        "und"
      const display = `${languageName(language) || language} · ${result.value.addon.manifest.name}`
      await nativePlayerCommand(["sub-add", subtitle.url, "auto", display, language]).catch(
        () => undefined,
      )
    }
  }
}

function languageName(code?: string): string | undefined {
  if (!code) return undefined
  try {
    return new Intl.DisplayNames([navigator.language], { type: "language" }).of(
      code.replace("_", "-"),
    )
  } catch {
    return code
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00"
  const rounded = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remaining = rounded % 60
  return hours
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`
    : `${minutes}:${remaining.toString().padStart(2, "0")}`
}
