import { useEffect, useMemo, useRef } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { ChevronDown, Film, LoaderCircle } from "lucide-react"
import type { InstalledAddon } from "../lib/api"
import { loadCatalog, type CatalogItem } from "../lib/core"
import { posterCoverClass } from "../lib/poster-layout"
import { Card } from "./ui/card"
import { PosterWatchStatus } from "./poster-watch-status"
import { VirtualPosterGrid } from "./virtual-poster-grid"

export interface DiscoverSelection {
  addonId?: string
  type?: string
  catalogId?: string
  genre?: string
}

export function DiscoverView({
  addons,
  selection,
  onChange,
  onSelect,
}: {
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
    <main className="mx-auto max-w-[2200px] px-4 py-9 sm:px-6 lg:px-8 xl:px-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
        Browse your sources
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Discover</h1>

      <div className="mt-7 grid max-w-5xl gap-3 sm:grid-cols-3">
        <FilterSelect
          label="Media type"
          value={type}
          disabled={types.length === 0}
          onChange={(nextType) => onChange({ type: nextType })}
          options={types.map((value) => [value, formatLabel(value)])}
        />
        <FilterSelect
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
        <FilterSelect
          label="Genre"
          value={genre ?? ""}
          disabled={genres.length === 0}
          onChange={(nextGenre) =>
            onChange({
              type,
              addonId: selected?.addon.id,
              catalogId: selected?.catalog.id,
              genre: nextGenre || undefined,
            })
          }
          options={[
            ...(!genreExtra?.isRequired
              ? [["", genres.length ? "All genres" : "Not available"]]
              : []),
            ...genres.map((value) => [value, value]),
          ]}
        />
      </div>

      <section className="mt-9">
        {results.isLoading && (
          <div className="flex items-center justify-center gap-3 py-24 text-zinc-500">
            <LoaderCircle className="animate-spin text-amber-400" /> Loading catalog…
          </div>
        )}
        {results.isError && (
          <Card className="border-red-900/70 bg-red-950/30 p-5 text-sm text-red-200">
            {results.error.message}
          </Card>
        )}
        {!selected && (
          <Card className="border-dashed py-20 text-center text-zinc-500">
            Install an add-on with catalogs to start discovering.
          </Card>
        )}
        {results.data && items.length === 0 && !results.isFetching && (
          <Card className="border-dashed py-20 text-center text-zinc-500">
            This catalog returned no titles.
          </Card>
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
                        <div className="grid h-full place-items-center text-zinc-700">
                          <Film />
                        </div>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-medium">{item.name}</p>
                  </button>
                  <div className="pointer-events-none absolute right-2 top-2">
                    <PosterWatchStatus item={item} addons={addons} />
                  </div>
                </>
              )}
            />
            <div ref={loadMoreRef} className="flex min-h-28 items-center justify-center">
              {results.isFetchingNextPage && (
                <span className="flex items-center gap-2 text-sm text-zinc-500">
                  <LoaderCircle className="animate-spin text-amber-400" size={18} />
                  Loading more…
                </span>
              )}
              {!results.hasNextPage && (
                <span className="text-xs text-zinc-700">You’ve reached the end</span>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

function FilterSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: string[][]
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        className="h-11 w-full appearance-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 pr-10 text-sm text-zinc-200 outline-none transition hover:border-zinc-700 focus:border-amber-400 disabled:text-zinc-600"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([option, name]) => (
          <option value={option} key={option}>
            {name}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
        size={16}
      />
    </label>
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
