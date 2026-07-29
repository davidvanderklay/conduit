import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, ChevronDown, Film, LoaderCircle } from "lucide-react"
import type { InstalledAddon, LibraryItem } from "../lib/api"
import { addonsForResource } from "../lib/addons"
import { loadMeta, type CatalogItem } from "../lib/core"
import { useLibrary } from "../lib/library"
import { LibraryToggle } from "./library-toggle"
import { Card } from "./ui/card"

type Filter = "all" | "movie" | "series"
type Sort = "added-desc" | "added-asc" | "title-asc" | "title-desc"

interface DisplayItem {
  item: LibraryItem
  catalogItem: CatalogItem
  metadataAvailable: boolean
}

export function LibraryView({
  profileId,
  addons,
  onSelect,
}: {
  profileId: string
  addons: InstalledAddon[]
  onSelect: (item: CatalogItem) => void
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const [sort, setSort] = useState<Sort>("added-desc")
  const library = useLibrary(profileId)
  const resolved = useQuery({
    queryKey: [
      "library-metadata",
      profileId,
      library.data?.items.map((item) => `${item.type}:${item.id}:${item.updatedAt}`),
      addons.map((addon) => [addon.id, addon.enabled]),
    ],
    enabled: Boolean(library.data),
    queryFn: async (): Promise<DisplayItem[]> =>
      Promise.all(
        (library.data?.items ?? []).map(async (item) => {
          const candidates = addonsForResource(addons, "meta", item.type, item.id)
          const attempts = await Promise.allSettled(
            candidates.map((addon) => loadMeta(addon.manifestUrl, item.type, item.id)),
          )
          const match = attempts.find(
            (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof loadMeta>>> =>
              result.status === "fulfilled",
          )
          return {
            item,
            catalogItem: match?.value ?? item,
            metadataAvailable: Boolean(match),
          }
        }),
      ),
  })
  const items = useMemo(() => {
    const filtered = (resolved.data ?? []).filter(
      ({ item }) => filter === "all" || item.type === filter,
    )
    return [...filtered].sort((a, b) => {
      if (sort === "title-asc") return a.catalogItem.name.localeCompare(b.catalogItem.name)
      if (sort === "title-desc") return b.catalogItem.name.localeCompare(a.catalogItem.name)
      const delta = Date.parse(a.item.createdAt) - Date.parse(b.item.createdAt)
      return sort === "added-asc" ? delta : -delta
    })
  }, [filter, resolved.data, sort])

  return (
    <main className="mx-auto max-w-7xl px-5 py-9">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
        Your collection
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Library</h1>
      <p className="mt-2 text-zinc-500">Movies and series saved to this profile.</p>

      <div className="mt-7 flex flex-wrap gap-3">
        <LibrarySelect
          label="Media type"
          value={filter}
          options={[
            ["all", "Movies & series"],
            ["movie", "Movies"],
            ["series", "Series"],
          ]}
          onChange={(value) => setFilter(value as Filter)}
        />
        <LibrarySelect
          label="Sort library"
          value={sort}
          options={[
            ["added-desc", "Recently added"],
            ["added-asc", "Oldest added"],
            ["title-asc", "Title A–Z"],
            ["title-desc", "Title Z–A"],
          ]}
          onChange={(value) => setSort(value as Sort)}
        />
      </div>

      {(library.isLoading || resolved.isLoading) && (
        <div className="flex items-center justify-center gap-3 py-24 text-zinc-500">
          <LoaderCircle className="animate-spin text-amber-400" /> Loading your library…
        </div>
      )}
      {(library.isError || resolved.isError) && (
        <Card className="mt-8 border-red-900/70 bg-red-950/30 p-5 text-red-200">
          <AlertCircle className="mr-2 inline" size={18} />
          {library.error?.message ?? resolved.error?.message}
        </Card>
      )}
      {resolved.data && items.length === 0 && (
        <Card className="mt-8 grid min-h-64 place-items-center border-dashed text-center">
          <div>
            <Film className="mx-auto text-zinc-700" size={34} />
            <p className="mt-4 text-sm text-zinc-500">
              {library.data?.items.length ? "No titles match this filter." : "Nothing saved yet."}
            </p>
          </div>
        </Card>
      )}
      {items.length > 0 && (
        <div className="mt-9 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7">
          {items.map(({ item, catalogItem, metadataAvailable }) => (
            <div className="group relative" key={`${item.type}:${item.id}`}>
              <button className="w-full text-left" onClick={() => onSelect(catalogItem)}>
                <div className="aspect-[2/3] overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-800 transition group-hover:-translate-y-1 group-hover:ring-amber-400/60">
                  {catalogItem.poster ? (
                    <img className="h-full w-full object-cover" src={catalogItem.poster} alt="" />
                  ) : (
                    <div className="grid h-full place-items-center text-zinc-700"><Film /></div>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium">{catalogItem.name}</p>
                {!metadataAvailable && (
                  <p className="mt-1 text-xs text-amber-400">Using saved details · source unavailable</p>
                )}
              </button>
              <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <LibraryToggle profileId={profileId} item={catalogItem} compact />
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

function LibrarySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  return (
    <label className="relative min-w-44">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="library-select h-11 w-full appearance-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 pr-10 text-sm font-medium text-zinc-100 shadow-sm outline-none transition hover:border-zinc-600 hover:bg-zinc-800 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([option, name]) => (
          <option className="bg-zinc-900 text-zinc-100" value={option} key={option}>
            {name}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400"
        size={16}
      />
    </label>
  )
}
