import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type QueueItem } from "./api"
import { emitQueueNotice, type QueueControls } from "./queue"

export function queueQueryKey(profileId: string) {
  return ["queue", profileId] as const
}

const noItems: QueueItem[] = []

/** Server-backed queue for a profile. Writes are optimistic and roll back on failure. */
export function useQueueControls(profileId: string): QueueControls {
  const queryClient = useQueryClient()
  const queryKey = queueQueryKey(profileId)
  const mutationKey = ["queue-set", profileId]
  const queue = useQuery({
    queryKey,
    queryFn: () => api<{ items: QueueItem[] }>(`/v1/profiles/${profileId}/queue`),
    refetchOnWindowFocus: true,
  })
  const mutation = useMutation({
    mutationKey,
    mutationFn: (items: QueueItem[]) =>
      api<{ items: QueueItem[] }>(`/v1/profiles/${profileId}/queue`, {
        method: "PUT",
        body: JSON.stringify({ items }),
      }),
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<{ items: QueueItem[] }>(queryKey)
      queryClient.setQueryData(queryKey, { items })
      return { previous }
    },
    onError: (_error, _items, context) => {
      queryClient.setQueryData(queryKey, context?.previous)
      emitQueueNotice("Queue could not be saved")
    },
    onSettled: () => {
      // A later write is still in flight; its settle refreshes instead.
      if (queryClient.isMutating({ mutationKey }) > 1) return
      return queryClient.invalidateQueries({ queryKey })
    },
  })
  const items = queue.data?.items ?? noItems
  const set = mutation.mutate
  return useMemo(() => ({ items, set }), [items, set])
}
