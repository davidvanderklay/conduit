import { useCallback, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { API_URL } from "./auth"
import { api, type PlaybackSource, type ProgressMetadata, type WatchProgress } from "./api"

const SAVE_INTERVAL_MS = 15_000
const CONTINUE_WATCHING_POSITION_MS = 30_000
const PROGRESS_OUTBOX_STORAGE_PREFIX = "conduit.progress.outbox.v1"

type PendingProgressCheckpoint = ProgressMetadata & {
  operationId: string
  profileId: string
  videoId: string
  positionMs: number
  durationMs: number
  playbackSource?: PlaybackSource
  checkpointSessionId: string
  checkpointSequence: number
  checkpointUpdatedAt: string
}

export interface ProgressIdentity {
  canonicalTitleId?: string
  mediaType: string
  mediaId: string
  aliases?: string[]
  videoId?: string
  season?: number
  episode?: number
}

export type ProgressOperation =
  | {
      type: "upsert"
      identity: ProgressIdentity & { videoId: string }
      name: string
      poster?: string
      videoTitle?: string
      positionMs: number
      durationMs: number
      watched: boolean
      playbackSource?: PlaybackSource | null
      checkpointSessionId: string
      checkpointSequence: number
    }
  | {
      type: "dismissTitle" | "restoreTitle" | "deleteEpisode" | "deleteTitle"
      identity: ProgressIdentity
    }

interface ProgressOperationResult {
  accepted: boolean
  reason?: "staleCheckpoint"
  generation: number
  revision: number
}

const flushPromises = new Map<string, Promise<void>>()

export function progressPath(profileId: string, videoId: string) {
  return `/v1/profiles/${profileId}/progress/${encodeURIComponent(videoId)}`
}

export function usePlaybackProgress(
  profileId: string,
  videoId: string,
  metadata: ProgressMetadata,
  playbackSource?: PlaybackSource,
  accountId = profileId,
) {
  const queryClient = useQueryClient()
  const progressKey = ["progress", profileId, videoId, accountId] as const
  const progress = useQuery({
    queryKey: progressKey,
    queryFn: () =>
      api<{ item: WatchProgress | null }>(progressPath(profileId, videoId)).then((result) =>
        withPendingProgress(result.item, readPendingCheckpoint(accountId, profileId, videoId)),
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
        operationId: createOperationId(),
        profileId,
        videoId,
        positionMs: Math.max(0, Math.round(position * 1000)),
        durationMs: Math.max(0, Math.round(duration * 1000)),
        ...(sourceRef.current ? { playbackSource: sourceRef.current } : {}),
        checkpointSessionId: sessionId.current,
        checkpointSequence: ++sequence.current,
        checkpointUpdatedAt: new Date().toISOString(),
      }
      enqueuePendingCheckpoint(accountId, checkpoint)
      queryClient.setQueryData<WatchProgress | null>(progressKey, (current) =>
        withPendingProgress(current ?? null, checkpoint),
      )

      await flushProgressOutbox(accountId)
      await queryClient.invalidateQueries({ queryKey: ["progress", profileId] })
    },
    [accountId, profileId, queryClient, videoId],
  )

  useEffect(() => {
    const refreshAfterFlush = () => {
      void flushProgressOutbox(accountId).then(() =>
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
  }, [accountId, profileId, queryClient, save])

  return { progress, save }
}

/** Flushes every durable web checkpoint in insertion order. Failed rows stay queued. */
export function flushProgressOutbox(accountId: string): Promise<void> {
  const current = flushPromises.get(accountId)
  if (current) return current
  const promise = (async () => {
    while (true) {
      const next = readPendingCheckpoints(accountId)[0]
      if (!next) return
      try {
        await applyProgressOperation(
          next.profileId,
          {
            type: "upsert",
            identity: checkpointIdentity(next),
            name: next.name,
            ...(next.poster ? { poster: next.poster } : {}),
            ...(next.videoTitle ? { videoTitle: next.videoTitle } : {}),
            positionMs: next.positionMs,
            durationMs: next.durationMs,
            watched: isPlaybackComplete(next.positionMs, next.durationMs),
            ...(next.playbackSource ? { playbackSource: next.playbackSource } : {}),
            checkpointSessionId: next.checkpointSessionId,
            checkpointSequence: next.checkpointSequence,
          },
          next.operationId,
          true,
        )
        removePendingCheckpoint(accountId, next)
      } catch {
        return
      }
    }
  })().finally(() => {
    if (flushPromises.get(accountId) === promise) flushPromises.delete(accountId)
  })
  flushPromises.set(accountId, promise)
  return promise
}

export function applyProgressOperation(
  profileId: string,
  operation: ProgressOperation,
  operationId = createOperationId(),
  keepalive = false,
) {
  return api<ProgressOperationResult>(`/v1/profiles/${profileId}/progress/operations`, {
    method: "POST",
    body: JSON.stringify({ operationId, operation }),
    keepalive,
  })
}

export function progressIdentity(
  progress: Pick<
    WatchProgress,
    "canonicalTitleId" | "mediaType" | "mediaId" | "videoId" | "season" | "episode"
  >,
): ProgressIdentity {
  return {
    ...(progress.canonicalTitleId ? { canonicalTitleId: progress.canonicalTitleId } : {}),
    mediaType: progress.mediaType,
    mediaId: progress.mediaId,
    videoId: progress.videoId,
    ...(progress.season !== undefined ? { season: progress.season } : {}),
    ...(progress.episode !== undefined ? { episode: progress.episode } : {}),
  }
}

export function clearProgressOutbox(accountId: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(progressOutboxStorageKey(accountId))
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

export function clearLegacyProgressOutbox() {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(PROGRESS_OUTBOX_STORAGE_PREFIX)
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

export function progressOutboxStorageKey(accountId: string) {
  return `${PROGRESS_OUTBOX_STORAGE_PREFIX}.${encodeURIComponent(API_URL)}.${encodeURIComponent(accountId)}`
}

function createSessionId() {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createOperationId(): string {
  return globalThis.crypto.randomUUID()
}

function checkpointIdentity(
  checkpoint: PendingProgressCheckpoint,
): ProgressIdentity & { videoId: string } {
  return {
    mediaType: checkpoint.mediaType,
    mediaId: checkpoint.mediaId,
    videoId: checkpoint.videoId,
    ...(checkpoint.season !== undefined ? { season: checkpoint.season } : {}),
    ...(checkpoint.episode !== undefined ? { episode: checkpoint.episode } : {}),
  }
}

function readPendingCheckpoints(accountId: string): PendingProgressCheckpoint[] {
  if (typeof window === "undefined") return []
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(progressOutboxStorageKey(accountId)) ?? "[]",
    )
    if (!Array.isArray(value)) return []
    const checkpoints = value.filter(isPendingProgressCheckpoint).map((checkpoint) => ({
      ...checkpoint,
      operationId: checkpoint.operationId ?? createOperationId(),
    }))
    if (
      checkpoints.some((checkpoint, index) => checkpoint.operationId !== value[index]?.operationId)
    ) {
      writePendingCheckpoints(accountId, checkpoints)
    }
    return checkpoints
  } catch {
    return []
  }
}

function readPendingCheckpoint(accountId: string, profileId: string, videoId: string) {
  return readPendingCheckpoints(accountId).find(
    (checkpoint) => checkpoint.profileId === profileId && checkpoint.videoId === videoId,
  )
}

function enqueuePendingCheckpoint(accountId: string, checkpoint: PendingProgressCheckpoint) {
  const checkpoints = readPendingCheckpoints(accountId)
  const index = checkpoints.findIndex(
    (current) =>
      current.profileId === checkpoint.profileId && current.videoId === checkpoint.videoId,
  )
  if (index === -1) checkpoints.push(checkpoint)
  else if (checkpoints[index].checkpointUpdatedAt <= checkpoint.checkpointUpdatedAt)
    checkpoints[index] = checkpoint
  writePendingCheckpoints(accountId, checkpoints)
}

function removePendingCheckpoint(accountId: string, checkpoint: PendingProgressCheckpoint) {
  writePendingCheckpoints(
    accountId,
    readPendingCheckpoints(accountId).filter(
      (current) =>
        current.profileId !== checkpoint.profileId ||
        current.videoId !== checkpoint.videoId ||
        current.checkpointSessionId !== checkpoint.checkpointSessionId ||
        current.checkpointSequence !== checkpoint.checkpointSequence,
    ),
  )
}

function writePendingCheckpoints(accountId: string, checkpoints: PendingProgressCheckpoint[]) {
  if (typeof window === "undefined") return
  try {
    const key = progressOutboxStorageKey(accountId)
    if (checkpoints.length === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(checkpoints))
  } catch {
    // Storage can be unavailable in private browsing. The network attempt below
    // still runs, while normal sessions retain the retry checkpoint.
  }
}

function isPendingProgressCheckpoint(
  value: unknown,
): value is Omit<PendingProgressCheckpoint, "operationId"> & { operationId?: string } {
  if (!value || typeof value !== "object") return false
  const checkpoint = value as Partial<PendingProgressCheckpoint>
  return (
    (checkpoint.operationId === undefined || typeof checkpoint.operationId === "string") &&
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
  if (
    !Number.isFinite(positionMs) ||
    !Number.isFinite(durationMs) ||
    positionMs < 0 ||
    durationMs <= 0
  ) {
    return false
  }
  return (
    positionMs / durationMs >= 0.9 || (durationMs >= 600_000 && durationMs - positionMs <= 120_000)
  )
}
