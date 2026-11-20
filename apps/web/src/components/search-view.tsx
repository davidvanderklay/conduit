import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, Film, LoaderCircle, Search } from "lucide-react"
import type { InstalledAddon } from "../lib/api"
import type { CatalogItem } from "../lib/core"
import { posterCoverClass, posterGridClass, posterTitleClass } from "../lib/poster-layout"
import { searchAddons, searchableCatalogs, type SearchResult } from "../lib/search"
import { BrowsePosterMenu } from "./browse-poster-menu"
import { PosterWatchStatus } from "./poster-watch-status"
import { PageHeader, pageClassName } from "./ui/page"
import { EmptyState } from "./ui/empty-state"
import { mediaTypeLabel } from "../lib/catalog-title"

export function SearchView({
  profileId,
  addons,
  query,
  onSelect,
}: {
  profileId: string
  addons: InstalledAddon[]
  query: string
  onSelect: (item: CatalogItem) => void
}) {
  const capableCount = searchableCatalogs(addons).length
  const search = useQuery({
    queryKey: ["search", addons.map((addon) => [addon.id, addon.enabled]), query],
    enabled: query.length > 0 && capableCount > 0,
    queryFn: () => searchAddons(addons, query),
  })
  const sections = useMemo(() => groupByPrimarySource(search.data?.results ?? []), [search.data])

  return (
    <main className={pageClassName}>
      <PageHeader
        title={<>Results for “{query}”</>}
        description={
          search.data
            ? `${search.data.results.length} ${search.data.results.length === 1 ? "title" : "titles"} from your add-ons`
            : "Searching your add-ons…"
        }
        actions={
          search.data?.failedSources ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-300">
              <AlertCircle size={14} />
              {search.data.failedSources} source
              {search.data.failedSources === 1 ? "" : "s"} unavailable
            </p>
          ) : null
        }
      />

      <div aria-live="polite">
        {capableCount === 0 && (
          <SearchMessage
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
          <SearchMessage title="Search could not start" message={search.error.message} error />
        )}
        {search.data && sections.length === 0 && (
          <SearchMessage
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
              <span className="text-sm text-zinc-400">{section.addonName}</span>
            </div>
            <div className={posterGridClass}>
              {section.items.map((item) => {
                const key = `${item.type}:${item.id}`
                return (
                  <div className="group relative" key={key}>
                    <button
                      className="w-full rounded-xl text-left outline-none"
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
      // Search catalogs are usually named after a browse list ("Popular"), which misleads here.
      title: mediaTypeLabel(source.type),
      addonName: source.addonName,
      items: [],
    }
    group.items.push(result)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function SearchMessage({
  title,
  message,
  error = false,
}: {
  title: string
  message: string
  error?: boolean
}) {
  return (
    <EmptyState
      icon={error ? AlertCircle : Search}
      iconClassName={error ? "text-red-400" : undefined}
      title={title}
      description={message}
    />
  )
}
