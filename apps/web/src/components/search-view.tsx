import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, Film, LoaderCircle, Search } from "lucide-react"
import type { InstalledAddon } from "../lib/api"
import type { CatalogItem } from "../lib/core"
import { posterCoverClass, posterGridClass } from "../lib/poster-layout"
import { searchAddons, searchableCatalogs, type SearchResult } from "../lib/search"
import { Card } from "./ui/card"
import { PosterWatchStatus } from "./poster-watch-status"

export function SearchView({
  addons,
  query,
  onSelect,
}: {
  addons: InstalledAddon[]
  query: string
  onSelect: (item: CatalogItem) => void
}) {
  const [activeKey, setActiveKey] = useState("")
  const capableCount = searchableCatalogs(addons).length
  const search = useQuery({
    queryKey: ["search", addons.map((addon) => [addon.id, addon.enabled]), query],
    enabled: query.length > 0 && capableCount > 0,
    queryFn: () => searchAddons(addons, query),
  })
  const sections = useMemo(() => groupByPrimarySource(search.data?.results ?? []), [search.data])

  return (
    <main className="mx-auto max-w-[2200px] 2xl:max-w-none px-4 py-10 sm:px-6 lg:px-6 xl:px-6 2xl:px-8">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
            Search results
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">“{query}”</h1>
        </div>
        {search.data?.failedSources ? (
          <p className="flex items-center gap-1.5 text-xs text-amber-300">
            <AlertCircle size={14} />
            {search.data.failedSources} source
            {search.data.failedSources === 1 ? "" : "s"} unavailable
          </p>
        ) : null}
      </div>

      <div aria-live="polite">
        {capableCount === 0 && (
          <EmptyState
            title="No searchable add-ons"
            message="Install or enable an add-on that exposes a catalog with search support."
          />
        )}
        {search.isFetching && !search.data && (
          <div className="flex items-center justify-center gap-3 py-20 text-zinc-400">
            <LoaderCircle className="animate-spin text-amber-400" />
            Searching your add-ons…
          </div>
        )}
        {search.isError && (
          <EmptyState title="Search could not start" message={search.error.message} error />
        )}
        {search.data && sections.length === 0 && (
          <EmptyState
            title={`No results for “${query}”`}
            message={
              search.data.failedSources
                ? `${search.data.failedSources} source${search.data.failedSources === 1 ? "" : "s"} could not be reached.`
                : "Try another title or spelling."
            }
          />
        )}
        {sections.map((section) => (
          <section className="mb-12" key={section.key}>
            <div className="mb-4 flex items-baseline gap-2">
              <h2 className="font-display text-xl font-semibold">{section.title}</h2>
              <span className="text-xs text-zinc-600">{section.addonName}</span>
            </div>
            <div className={posterGridClass}>
              {section.items.map((item) => {
                const key = `${item.type}:${item.id}`
                return (
                  <div className="group relative" key={key}>
                    <button
                      className={`w-full rounded-xl text-left outline-none ${
                        activeKey === key
                          ? "ring-2 ring-amber-400 ring-offset-4 ring-offset-zinc-950"
                          : ""
                      }`}
                      onMouseEnter={() => setActiveKey(key)}
                      onFocus={() => setActiveKey(key)}
                      onClick={() => onSelect(item)}
                    >
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
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

function groupByPrimarySource(results: SearchResult[]) {
  const groups = new Map<
    string,
    { key: string; title: string; addonName: string; items: SearchResult[] }
  >()
  for (const result of results) {
    const source = result.sources[0]
    if (!source) continue
    const key = `${source.addonId}:${source.type}:${source.catalogId}`
    const group = groups.get(key) ?? {
      key,
      title: `${source.catalogName} · ${formatType(source.type)}`,
      addonName: source.addonName,
      items: [],
    }
    group.items.push(result)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function formatType(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function EmptyState({
  title,
  message,
  error = false,
}: {
  title: string
  message: string
  error?: boolean
}) {
  return (
    <Card className="border-dashed py-16 text-center">
      {error ? (
        <AlertCircle className="mx-auto mb-4 text-red-400" />
      ) : (
        <Search className="mx-auto mb-4 text-zinc-700" />
      )}
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">{message}</p>
    </Card>
  )
}
