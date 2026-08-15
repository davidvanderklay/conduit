import { useCallback, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type PlaybackSource, type ProgressMetadata, type WatchProgress } from "./api"

const SAVE_INTERVAL_MS = 15_000
const CONTINUE_WATCHING_POSITION_MS = 30_000
export const PROGRESS_OUTBOX_STORAGE_KEY = "conduit.progress.outbox.v1"

type PendingProgressCheckpoint = ProgressMetadata & {
  profileId: string
  videoId: string
  positionMs: number
  durationMs: number
  playbackSource?: PlaybackSource
  checkpointSessionId: string
  checkpointSequence: number
  checkpointUpdatedAt: string
}

let flushPromise: Promise<void> | undefined

export function progressPath(profileId: string, videoId: string) {
  return `/v1/profiles/${profileId}/progress/${encodeURIComponent(videoId)}`
}

export function usePlaybackProgress(
  profileId: string,
  videoId: string,
  metadata: ProgressMetadata,
  playbackSource?: PlaybackSource,
) {
  const queryClient = useQueryClient()
  const progressKey = ["progress", profileId, videoId] as const
  const progress = useQuery({
    queryKey: progressKey,
    queryFn: () =>
      api<{ item: WatchProgress | null }>(progressPath(profileId, videoId)).then(
        (result) => withPendingProgress(result.item, readPendingCheckpoint(profileId, videoId)),
      ),
  })
  const latest = useRef({ position: 0, duration: 0 })
  const metadataRef = useRef(metadata)
  metadataRef.current = metadata
  const sourceRef = useRef(playbackSource)
  sourceRef.current = playbackSource
  const sessionId = useRef(createSessionId())
  const sequence = useRef(0)
  const lastSavedAt = useRef(0)

  const save = useCallback(
    async (position: number, duration: number, force = false) => {
      latest.current = { position, duration }
      const now = Date.now()
      if (!force && now - lastSavedAt.current < SAVE_INTERVAL_MS) return
      if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return
      lastSavedAt.current = now

      const checkpoint: PendingProgressCheckpoint = {
        ...metadataRef.current,
        profileId,
        videoId,
        positionMs: Math.max(0, Math.round(position * 1000)),
        durationMs: Math.max(0, Math.round(duration * 1000)),
        ...(sourceRef.current ? { playbackSource: sourceRef.current } : {}),
        checkpointSessionId: sessionId.current,
        checkpointSequence: ++sequence.current,
        checkpointUpdatedAt: new Date().toISOString(),
      }
      enqueuePendingCheckpoint(checkpoint)
      queryClient.setQueryData<WatchProgress | null>(progressKey, (current) =>
        withPendingProgress(current ?? null, checkpoint),
      )

      await flushProgressOutbox()
      await queryClient.invalidateQueries({ queryKey: ["progress", profileId] })
    },
    [profileId, queryClient, videoId],
  )

  useEffect(() => {
    const refreshAfterFlush = () => {
      void flushProgressOutbox().then(() =>
        queryClient.invalidateQueries({ queryKey: ["progress", profileId] }),
      )
    }
    const saveBeforeLeaving = () => {
      const current = latest.current
      void save(current.position, current.duration, true)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveBeforeLeaving()
      else refreshAfterFlush()
    }

    window.addEventListener("online", refreshAfterFlush)
    window.addEventListener("focus", refreshAfterFlush)
    window.addEventListener("pagehide", saveBeforeLeaving)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.removeEventListener("online", refreshAfterFlush)
      window.removeEventListener("focus", refreshAfterFlush)
      window.removeEventListener("pagehide", saveBeforeLeaving)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      const current = latest.current
      void save(current.position, current.duration, true)
    }
  }, [profileId, queryClient, save])

  return { progress, save }
}

/** Flushes every durable web checkpoint in insertion order. Failed rows stay queued. */
export function flushProgressOutbox(): Promise<void> {
  if (flushPromise) return flushPromise
  flushPromise = (async () => {
    while (true) {
      const next = readPendingCheckpoints()[0]
      if (!next) return
      try {
        await api<{ item: WatchProgress }>(progressPath(next.profileId, next.videoId), {
          method: "PUT",
          body: JSON.stringify({
            mediaType: next.mediaType,
            mediaId: next.mediaId,
            name: next.name,
            ...(next.poster ? { poster: next.poster } : {}),
            ...(next.videoTitle ? { videoTitle: next.videoTitle } : {}),
            ...(next.season !== undefined ? { season: next.season } : {}),
            ...(next.episode !== undefined ? { episode: next.episode } : {}),
            ...(next.playbackSource ? { playbackSource: next.playbackSource } : {}),
            positionMs: next.positionMs,
            durationMs: next.durationMs,
            checkpointSessionId: next.checkpointSessionId,
            checkpointSequence: next.checkpointSequence,
            checkpointUpdatedAt: next.checkpointUpdatedAt,
          }),
          keepalive: true,
        })
        removePendingCheckpoint(next)
      } catch {
        return
      }
    }
  })().finally(() => {
    flushPromise = undefined
  })
  return flushPromise
}

function createSessionId() {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readPendingCheckpoints(): PendingProgressCheckpoint[] {
  if (typeof window === "undefined") return []
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PROGRESS_OUTBOX_STORAGE_KEY) ?? "[]")
    if (!Array.isArray(value)) return []
    return value.filter(isPendingProgressCheckpoint)
  } catch {
    return []
  }
}

function readPendingCheckpoint(profileId: string, videoId: string) {
  return readPendingCheckpoints().find(
    (checkpoint) => checkpoint.profileId === profileId && checkpoint.videoId === videoId,
  )
}

function enqueuePendingCheckpoint(checkpoint: PendingProgressCheckpoint) {
  const checkpoints = readPendingCheckpoints()
  const index = checkpoints.findIndex(
    (current) => current.profileId === checkpoint.profileId && current.videoId === checkpoint.videoId,
  )
  if (index === -1) checkpoints.push(checkpoint)
  else if (checkpoints[index].checkpointUpdatedAt <= checkpoint.checkpointUpdatedAt) checkpoints[index] = checkpoint
  writePendingCheckpoints(checkpoints)
}

function removePendingCheckpoint(checkpoint: PendingProgressCheckpoint) {
  writePendingCheckpoints(
    readPendingCheckpoints().filter(
      (current) =>
        current.profileId !== checkpoint.profileId ||
        current.videoId !== checkpoint.videoId ||
        current.checkpointSessionId !== checkpoint.checkpointSessionId ||
        current.checkpointSequence !== checkpoint.checkpointSequence,
    ),
  )
}

function writePendingCheckpoints(checkpoints: PendingProgressCheckpoint[]) {
  if (typeof window === "undefined") return
  try {
    if (checkpoints.length === 0) window.localStorage.removeItem(PROGRESS_OUTBOX_STORAGE_KEY)
    else window.localStorage.setItem(PROGRESS_OUTBOX_STORAGE_KEY, JSON.stringify(checkpoints))
  } catch {
    // Storage can be unavailable in private browsing. The network attempt below
    // still runs, while normal sessions retain the retry checkpoint.
  }
}

function isPendingProgressCheckpoint(value: unknown): value is PendingProgressCheckpoint {
  if (!value || typeof value !== "object") return false
  const checkpoint = value as Partial<PendingProgressCheckpoint>
  return (
    typeof checkpoint.profileId === "string" &&
    typeof checkpoint.videoId === "string" &&
    typeof checkpoint.mediaType === "string" &&
    typeof checkpoint.mediaId === "string" &&
    typeof checkpoint.name === "string" &&
    typeof checkpoint.positionMs === "number" &&
    typeof checkpoint.durationMs === "number" &&
    typeof checkpoint.checkpointSessionId === "string" &&
    typeof checkpoint.checkpointSequence === "number" &&
    typeof checkpoint.checkpointUpdatedAt === "string"
  )
}

function withPendingProgress(
  serverProgress: WatchProgress | null,
  pending: PendingProgressCheckpoint | undefined,
): WatchProgress | null {
  if (!pending || (serverProgress && serverProgress.updatedAt >= pending.checkpointUpdatedAt)) {
    return serverProgress
  }
  const watched = isPlaybackComplete(pending.positionMs, pending.durationMs)
  return {
    videoId: pending.videoId,
    mediaType: pending.mediaType,
    mediaId: pending.mediaId,
    name: pending.name,
    poster: pending.poster,
    videoTitle: pending.videoTitle,
    season: pending.season,
    episode: pending.episode,
    positionMs: watched ? pending.durationMs : pending.positionMs,
    durationMs: pending.durationMs,
    watched,
    dismissed: serverProgress?.dismissed ?? false,
    continueWatching:
      serverProgress?.continueWatching === true ||
      watched ||
      pending.positionMs >= CONTINUE_WATCHING_POSITION_MS,
    playbackSource: pending.playbackSource,
    updatedAt: pending.checkpointUpdatedAt,
  }
}

function isPlaybackComplete(positionMs: number, durationMs: number) {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || positionMs < 0 || durationMs <= 0) {
    return false
  }
  return positionMs / durationMs >= 0.9 || (durationMs >= 600_000 && durationMs - positionMs <= 120_000)
}

if (typeof window !== "undefined") {
  const flush = () => void flushProgressOutbox()
  void flushProgressOutbox()
  window.addEventListener("online", flush)
  window.addEventListener("focus", flush)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") flush()
  })
}
