import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type LibraryItem } from "./api"
import type { CatalogItem, MetaItem } from "./core"

export function libraryQueryKey(profileId: string) {
  return ["library", profileId] as const
}

export function useLibrary(profileId: string) {
  return useQuery({
    queryKey: libraryQueryKey(profileId),
    queryFn: () => api<{ items: LibraryItem[] }>(`/v1/profiles/${profileId}/library`),
  })
}

export function useLibraryToggle(profileId: string, item: CatalogItem | MetaItem) {
  const queryClient = useQueryClient()
  const library = useLibrary(profileId)
  const supported = item.type === "movie" || item.type === "series"
  const existing = library.data?.items.find(
    (saved) => saved.type === item.type && saved.id === item.id,
  )
  const mutation = useMutation({
    mutationFn: async () => {
      if (existing) {
        await api<void>(
          `/v1/profiles/${profileId}/library/${encodeURIComponent(existing.type)}/${encodeURIComponent(existing.id)}`,
          { method: "DELETE" },
        )
      } else {
        await api<{ item: LibraryItem }>(
          `/v1/profiles/${profileId}/library/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`,
          {
            method: "PUT",
            body: JSON.stringify({
              name: item.name,
              poster: item.poster,
              background: item.background,
              description: item.description,
              releaseInfo: "releaseInfo" in item ? item.releaseInfo : undefined,
              runtime: "runtime" in item ? item.runtime : undefined,
            }),
          },
        )
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: libraryQueryKey(profileId) }),
  })

  return {
    supported,
    saved: Boolean(existing),
    loading: library.isLoading || mutation.isPending,
    error: mutation.error,
    toggle: mutation.mutate,
  }
}
