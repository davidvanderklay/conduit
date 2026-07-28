import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, Film, LoaderCircle, Search } from "lucide-react"
import type { InstalledAddon } from "../lib/api"
import type { CatalogItem } from "../lib/core"
import { searchAddons, searchableCatalogs, type SearchResult } from "../lib/search"
import { Card } from "./ui/card"

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
    <main className="mx-auto max-w-7xl px-5 py-10">
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
            <div className="flex gap-4 overflow-x-auto pb-4">
              {section.items.map((item) => {
                const key = `${item.type}:${item.id}`
                return (
                  <button
                    className={`group w-36 shrink-0 rounded-xl text-left outline-none sm:w-40 ${
                      activeKey === key
                        ? "ring-2 ring-amber-400 ring-offset-4 ring-offset-zinc-950"
                        : ""
                    }`}
                    key={key}
                    onMouseEnter={() => setActiveKey(key)}
                    onFocus={() => setActiveKey(key)}
                    onClick={() => onSelect(item)}
                  >
                    <div className="aspect-[2/3] overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-800 transition group-hover:-translate-y-1 group-hover:ring-amber-400/60">
                      {item.poster ? (
                        <img
                          className="h-full w-full object-cover"
                          src={item.poster}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-zinc-700">
                          <Film />
                        </div>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-medium">{item.name}</p>
                  </button>
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
