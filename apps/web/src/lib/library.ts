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
  const queryKey = libraryQueryKey(profileId)
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
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<{ items: LibraryItem[] }>(queryKey)
      if (previous) {
        const nextItems = existing
          ? previous.items.filter((saved) => saved.id !== existing.id || saved.type !== existing.type)
          : [
              {
                id: item.id,
                type: item.type as LibraryItem["type"],
                name: item.name,
                poster: item.poster,
                background: item.background,
                description: item.description,
                releaseInfo: "releaseInfo" in item ? item.releaseInfo : undefined,
                runtime: "runtime" in item ? item.runtime : undefined,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              ...previous.items,
            ]
        queryClient.setQueryData(queryKey, { ...previous, items: nextItems })
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })

  return {
    supported,
    saved: Boolean(existing),
    loading: library.isLoading || mutation.isPending,
    error: mutation.error,
    toggle: mutation.mutate,
    toggleAsync: mutation.mutateAsync,
  }
}
