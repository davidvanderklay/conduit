import { useEffect, useMemo, useRef } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Compass, Film, LoaderCircle } from "lucide-react"
import type { InstalledAddon } from "../lib/api"
import { loadCatalog, type CatalogItem } from "../lib/core"
import { genreFilterOptions } from "../lib/discover"
import { posterCoverClass, posterTitleClass } from "../lib/poster-layout"
import { Card } from "./ui/card"
import { BrowsePosterMenu } from "./browse-poster-menu"
import { PosterWatchStatus } from "./poster-watch-status"
import { VirtualPosterGrid } from "./virtual-poster-grid"
import { PageHeader, pageClassName } from "./ui/page"
import { Select } from "./ui/select"
import { EmptyState } from "./ui/empty-state"
import { mediaTypeLabel } from "../lib/catalog-title"

export interface DiscoverSelection {
  addonId?: string
  type?: string
  catalogId?: string
  genre?: string
}

export function DiscoverView({
  profileId,
  addons,
  selection,
  onChange,
  onSelect,
}: {
  profileId: string
  addons: InstalledAddon[]
  selection: DiscoverSelection
  onChange: (selection: DiscoverSelection) => void
  onSelect: (item: CatalogItem) => void
}) {
  const catalogs = useMemo(
    () =>
      addons
        .filter((addon) => addon.enabled)
        .flatMap((addon) =>
          addon.manifest.catalogs
            .filter((catalog) =>
              (catalog.extra ?? []).every((extra) => !extra.isRequired || extra.name === "genre"),
            )
            .map((catalog) => ({ addon, catalog })),
        ),
    [addons],
  )
  const types = [...new Set(catalogs.map(({ catalog }) => catalog.type))]
  const type = types.includes(selection.type ?? "") ? selection.type! : (types[0] ?? "")
  const typeCatalogs = catalogs.filter(({ catalog }) => catalog.type === type)
  const explicitlySelected = typeCatalogs.find(
    ({ addon, catalog }) => addon.id === selection.addonId && catalog.id === selection.catalogId,
  )
  const genreSelected = selection.genre
    ? typeCatalogs.find(({ catalog }) => {
        const extra = catalog.extra?.find((candidate) => candidate.name === "genre")
        const options = extra?.options ?? []
        return Boolean(extra) && (options.length === 0 || options.includes(selection.genre!))
      })
    : undefined
  const selected = explicitlySelected ?? genreSelected ?? typeCatalogs[0]
  const genreExtra = selected?.catalog.extra?.find((extra) => extra.name === "genre")
  const genres = genreExtra?.options ?? []
  const genre = genres.includes(selection.genre ?? "")
    ? selection.genre
    : genreExtra?.isRequired
      ? genres[0]
      : undefined

  useEffect(() => {
    if (!selected) return
    if (
      selection.type !== type ||
      selection.addonId !== selected.addon.id ||
      selection.catalogId !== selected.catalog.id ||
      selection.genre !== genre
    ) {
      onChange({
        type,
        addonId: selected.addon.id,
        catalogId: selected.catalog.id,
        genre,
      })
    }
  }, [genre, onChange, selected, selection, type])

  const results = useInfiniteQuery({
    queryKey: ["discover", selected?.addon.id, selected?.catalog.type, selected?.catalog.id, genre],
    enabled: Boolean(selected),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      loadCatalog(selected!.addon.manifestUrl, selected!.catalog.type, selected!.catalog.id, [
        ...(genre ? [{ name: "genre", value: genre }] : []),
        ...(pageParam > 0 ? [{ name: "skip", value: String(pageParam) }] : []),
      ]),
    getNextPageParam: (lastPage, pages) => {
      if (lastPage.length === 0) return undefined
      const previousIds = new Set(
        pages
          .slice(0, -1)
          .flat()
          .map((item) => `${item.type}:${item.id}`),
      )
      if (
        previousIds.size > 0 &&
        lastPage.every((item) => previousIds.has(`${item.type}:${item.id}`))
      ) {
        return undefined
      }
      return pages.reduce((count, page) => count + page.length, 0)
    },
  })
  const items = useMemo(() => deduplicate(results.data?.pages.flat() ?? []), [results.data?.pages])
  const loadMoreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !results.hasNextPage) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !results.isFetchingNextPage) {
          void results.fetchNextPage()
        }
      },
      { rootMargin: "600px 0px" },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [results.fetchNextPage, results.hasNextPage, results.isFetchingNextPage])

  return (
    <main className={pageClassName}>
      <PageHeader title="Discover" description="Browse catalogs from your add-ons." />

      <div className="flex flex-wrap gap-3">
        <Select
          label="Media type"
          value={type}
          disabled={types.length === 0}
          onChange={(nextType) => onChange({ type: nextType })}
          options={types.map((value) => [value, mediaTypeLabel(value)])}
        />
        <Select
          label="Content"
          value={selected ? `${selected.addon.id}:${selected.catalog.id}` : ""}
          disabled={typeCatalogs.length === 0}
          onChange={(value) => {
            const [addonId, ...catalogParts] = value.split(":")
            onChange({ type, addonId, catalogId: catalogParts.join(":") })
          }}
          options={typeCatalogs.map(({ addon, catalog }) => [
            `${addon.id}:${catalog.id}`,
            `${catalog.name ?? formatLabel(catalog.id)} · ${addon.manifest.name}`,
          ])}
        />
        <Select
          label="Genre"
          value={genre ?? ""}
          disabled={!genreExtra}
          onChange={(nextGenre) =>
            onChange({
              type,
              addonId: selected?.addon.id,
              catalogId: selected?.catalog.id,
              genre: nextGenre || undefined,
            })
          }
          options={genreFilterOptions(genreExtra)}
        />
      </div>

      <section className="mt-9">
        {results.isLoading && (
          <div className="flex items-center justify-center gap-3 py-24 text-zinc-400">
            <LoaderCircle className="animate-spin text-amber-400" /> Loading catalog…
          </div>
        )}
        {results.isError && (
          <Card className="border-red-900/70 bg-red-950/30 p-5 text-sm text-red-200">
            {results.error.message}
          </Card>
        )}
        {!selected && (
          <EmptyState icon={Compass} title="No catalogs yet" description="Install an add-on with catalogs to start discovering." />
        )}
        {results.data && items.length === 0 && !results.isFetching && (
          <EmptyState icon={Film} title="No titles" description="This catalog returned no titles." />
        )}
        {items.length > 0 && (
          <>
            <VirtualPosterGrid
              items={items}
              itemKey={(item) => `${item.type}:${item.id}`}
              renderItem={(item) => (
                <>
                  <button className="w-full text-left" onClick={() => onSelect(item)}>
                    <div className={posterCoverClass}>
                      {item.poster ? (
                        <img
                          className="h-full w-full object-cover"
                          src={item.poster}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          width={300}
                          height={450}
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-zinc-600">
                          <Film />
                        </div>
                      )}
                    </div>
                  </button>
                  <div className="mt-2 flex items-start gap-1">
                    <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(item)}>
                      <p className={posterTitleClass}>{item.name}</p>
                    </button>
                    <BrowsePosterMenu
                      profileId={profileId}
                      item={item}
                      addons={addons}
                      onSelect={() => onSelect(item)}
                    />
                  </div>
                  <div className="pointer-events-none absolute right-2 top-2">
                    <PosterWatchStatus item={item} addons={addons} />
                  </div>
                </>
              )}
            />
            <div ref={loadMoreRef} className="flex min-h-28 items-center justify-center">
              {results.isFetchingNextPage && (
                <span className="flex items-center gap-2 text-sm text-zinc-400">
                  <LoaderCircle className="animate-spin text-amber-400" size={18} />
                  Loading more…
                </span>
              )}
              {!results.hasNextPage && (
                <span className="text-xs text-zinc-600">You’ve reached the end</span>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  )
}


function formatLabel(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function deduplicate(items: CatalogItem[]): CatalogItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.type}:${item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
