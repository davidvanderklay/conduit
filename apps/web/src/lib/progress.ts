import { useCallback, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type ProgressMetadata, type WatchProgress } from "./api"

const SAVE_INTERVAL_MS = 15_000

export function progressPath(profileId: string, videoId: string) {
  return `/v1/profiles/${profileId}/progress/${encodeURIComponent(videoId)}`
}

export function usePlaybackProgress(
  profileId: string,
  videoId: string,
  metadata: ProgressMetadata,
) {
  const queryClient = useQueryClient()
  const progress = useQuery({
    queryKey: ["progress", profileId, videoId],
    queryFn: () =>
      api<{ item: WatchProgress | null }>(progressPath(profileId, videoId)).then(
        (result) => result.item,
      ),
  })
  const latest = useRef({ position: 0, duration: 0 })
  const metadataRef = useRef(metadata)
  metadataRef.current = metadata
  const lastSavedAt = useRef(0)

  const save = useCallback(
    async (position: number, duration: number, force = false) => {
      latest.current = { position, duration }
      const now = Date.now()
      if (!force && now - lastSavedAt.current < SAVE_INTERVAL_MS) return
      if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return
      lastSavedAt.current = now
      await api(progressPath(profileId, videoId), {
        method: "PUT",
        body: JSON.stringify({
          ...metadataRef.current,
          positionMs: Math.max(0, Math.round(position * 1000)),
          durationMs: Math.max(0, Math.round(duration * 1000)),
        }),
        keepalive: force,
      })
      await queryClient.invalidateQueries({ queryKey: ["progress", profileId] })
    },
    [profileId, queryClient, videoId],
  )

  useEffect(
    () => () => {
      const current = latest.current
      void save(current.position, current.duration, true)
    },
    [save],
  )

  return { progress, save }
}
