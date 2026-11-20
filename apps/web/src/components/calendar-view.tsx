import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Film,
  LoaderCircle,
  Play,
  RotateCcw,
} from "lucide-react"
import type { InstalledAddon, LibraryItem } from "../lib/api"
import {
  dateKey,
  daysInMonth,
  mondayOffset,
  monthFor,
  monthKey,
  releaseDateKey,
  shiftMonth,
  type CalendarMonth,
} from "../lib/calendar"
import { addonsForResource } from "../lib/addons"
import { loadMeta, type CatalogItem, type MetaItem, type Video } from "../lib/core"
import { useLibrary } from "../lib/library"
import { episodeLabel, normalizeMetaItem } from "../lib/metadata"
import { Card } from "./ui/card"
import { PageHeader, pageClassName } from "./ui/page"
import { EmptyState } from "./ui/empty-state"

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const compactDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })

interface CalendarRelease {
  key: string
  date: string
  item: CatalogItem
  video?: Video
  image?: string
  title: string
  subtitle: string
  playable: boolean
}

interface ResolvedLibraryItem {
  saved: LibraryItem
  meta: MetaItem
}

export function CalendarView({
  profileId,
  addons,
  onSelect,
}: {
  profileId: string
  addons: InstalledAddon[]
  onSelect: (item: CatalogItem, videoId?: string) => void
}) {
  const [month, setMonth] = useState<CalendarMonth>(() => monthFor(new Date()))
  const currentMonth = monthFor(new Date())
  const library = useLibrary(profileId)
  const metadata = useQuery({
    queryKey: [
      "calendar-metadata",
      profileId,
      library.data?.items.map((item) => `${item.type}:${item.id}:${item.updatedAt}`),
      addons.map((addon) => [addon.id, addon.enabled]),
    ],
    enabled: Boolean(library.data),
    queryFn: async (): Promise<ResolvedLibraryItem[]> =>
      Promise.all(
        (library.data?.items ?? []).map(async (saved) => ({
          saved,
          meta: await resolveMetadata(addons, saved),
        })),
      ),
  })
  const releases = useMemo(
    () => buildReleases(metadata.data ?? []).filter((release) => release.date.startsWith(monthKey(month))),
    [metadata.data, month],
  )
  const releasesByDate = useMemo(() => {
    const grouped = new Map<string, CalendarRelease[]>()
    for (const release of releases) {
      const values = grouped.get(release.date) ?? []
      values.push(release)
      grouped.set(release.date, values)
    }
    return grouped
  }, [releases])
  const cells = useMemo(
    () => [
      ...Array.from({ length: mondayOffset(month) }, () => undefined),
      ...Array.from({ length: daysInMonth(month) }, (_, index) => index + 1),
    ],
    [month],
  )
  // Pad the last week so every row has seven bordered cells.
  const paddedCells = [...cells, ...Array.from({ length: (7 - (cells.length % 7)) % 7 }, () => undefined)]
  const weekCount = Math.ceil(cells.length / 7)
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(month.year, month.month, 1))
  const isCurrentMonth = monthKey(month) === monthKey(currentMonth)

  return (
    <main className={`${pageClassName} xl:flex xl:h-[calc(100vh-4rem-1px)] xl:flex-col xl:overflow-hidden xl:pb-8`}>
      {/* One top row on xl: title, month switcher over the grid, release count over the rail. */}
      <div className="mb-5 grid shrink-0 items-end gap-5 xl:grid-cols-[auto_minmax(0,1fr)_20rem]">
        <PageHeader
          className="mb-0"
          title="Calendar"
          description="New episodes and releases from your library."
        />
        <div className="flex xl:justify-center">
          <MonthControl
            monthLabel={monthLabel}
            isCurrentMonth={isCurrentMonth}
            onPrevious={() => setMonth((value) => shiftMonth(value, -1))}
            onNext={() => setMonth((value) => shiftMonth(value, 1))}
            onToday={() => setMonth(currentMonth)}
          />
        </div>
        <div className="hidden xl:block">
          <ReleaseRailHeader releaseCount={releases.length} />
        </div>
      </div>

      {(library.isLoading || metadata.isLoading) && (
        <div className="flex min-h-96 items-center justify-center gap-3 text-zinc-400">
          <LoaderCircle className="animate-spin text-amber-400" /> Building your calendar…
        </div>
      )}
      {(library.isError || metadata.isError) && (
        <Card className="border-red-900/70 bg-red-950/30 p-5 text-red-200">
          <AlertCircle className="mr-2 inline" size={18} />
          {library.error?.message ?? metadata.error?.message ?? "Calendar data could not be loaded."}
        </Card>
      )}
      {library.data && metadata.data && (
        <div className="grid items-start gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 xl:h-full xl:min-h-0">
            <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 xl:h-full">
              <div className="h-full overflow-x-auto">
                <div className="flex h-full min-w-[760px] flex-col">
                  <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-900/90">
                    {WEEKDAYS.map((day) => (
                      <div
                        className="px-3 py-3 text-xs font-semibold text-zinc-400"
                        key={day}
                      >
                        {day}
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid flex-1 grid-cols-7"
                    style={{ gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))` }}
                  >
                    {paddedCells.map((day, index) =>
                      day ? (
                        <CalendarDay
                          key={day}
                          day={day}
                          today={dateKey(currentMonth, new Date().getDate()) === dateKey(month, day)}
                          releases={releasesByDate.get(dateKey(month, day)) ?? []}
                          onSelect={onSelect}
                        />
                      ) : (
                        <div
                          className="min-h-32 border-b border-r border-zinc-800/80 bg-zinc-950/35 xl:min-h-0"
                          key={`blank-${index}`}
                        />
                      ),
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside className="xl:flex xl:h-full xl:min-h-0 xl:flex-col">
            <div className="mb-3 shrink-0 xl:hidden">
              <ReleaseRailHeader releaseCount={releases.length} />
            </div>
            <div className="max-h-[calc(100vh-10rem)] space-y-2 overflow-y-auto pr-1 xl:min-h-0 xl:flex-1 xl:max-h-none">
              {releases.length ? (
                releases.map((release) => (
                  <button
                    className="group flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/75 p-3 text-left transition hover:border-amber-400/40 hover:bg-zinc-800"
                    key={release.key}
                    onClick={() => onSelect(release.item, release.video?.id)}
                  >
                    <ReleaseImage release={release} className="h-14 w-10 shrink-0 rounded-md" />
                    <span className="min-w-0 flex-1">
                      <span className="text-xs font-semibold text-amber-400">
                        {formatDateKey(release.date)}
                      </span>
                      <span className="mt-1 block truncate text-sm font-medium">{release.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-400">
                        {release.subtitle}
                      </span>
                    </span>
                    <Play
                      className="shrink-0 text-zinc-500 transition group-hover:text-amber-300"
                      fill="currentColor"
                      size={16}
                    />
                  </button>
                ))
              ) : (
                <EmptyState
                  framed
                  icon={CalendarDays}
                  title="No releases this month"
                  description="Add a series to your library or try another month."
                />
              )}
            </div>
          </aside>
        </div>
      )}
    </main>
  )
}

function MonthControl({
  monthLabel,
  isCurrentMonth,
  onPrevious,
  onNext,
  onToday,
}: {
  monthLabel: string
  isCurrentMonth: boolean
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}) {
  return (
    <div className="flex h-10 items-center rounded-lg border border-zinc-800 bg-zinc-900 p-1">
      <MonthButton label="Previous month" onClick={onPrevious}>
        <ChevronLeft size={18} />
      </MonthButton>
      <div className="min-w-40 px-3 text-center">
        <p className="text-sm font-semibold text-zinc-100">{monthLabel}</p>
      </div>
      <MonthButton label="Next month" onClick={onNext}>
        <ChevronRight size={18} />
      </MonthButton>
      {!isCurrentMonth && (
        <button
          className="ml-1 flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          onClick={onToday}
        >
          <RotateCcw size={14} /> Today
        </button>
      )}
    </div>
  )
}

function ReleaseRailHeader({ releaseCount }: { releaseCount: number }) {
  return (
    <div className="flex h-10 w-full items-center justify-between px-1">
      <p className="text-sm font-semibold text-zinc-100">This month</p>
      <p className="text-xs tabular-nums text-zinc-400">
        {releaseCount} {releaseCount === 1 ? "release" : "releases"}
      </p>
    </div>
  )
}

function MonthButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      aria-label={label}
      className="grid size-8 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function CalendarDay({
  day,
  today,
  releases,
  onSelect,
}: {
  day: number
  today: boolean
  releases: CalendarRelease[]
  onSelect: (item: CatalogItem, videoId?: string) => void
}) {
  return (
    <div className="min-h-32 overflow-hidden border-b border-r border-zinc-800/80 p-2.5 xl:min-h-0">
      <span
        className={`grid size-6 place-items-center rounded-full text-xs font-medium tabular-nums ${
          today ? "bg-amber-400 font-semibold text-zinc-950" : "text-zinc-400"
        }`}
      >
        {day}
      </span>
      <div className="mt-2 flex h-[calc(100%-2rem)] gap-1.5 overflow-hidden">
        {releases.map((release) => (
          <button
            aria-label={`${release.title}, ${release.subtitle}`}
            className="group relative h-full max-h-[7.1rem] w-auto shrink-0 aspect-[2/3] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-left shadow-md transition hover:z-10 hover:-translate-y-0.5 hover:border-amber-400/70 hover:shadow-xl hover:shadow-black/50 focus-visible:outline-2 focus-visible:outline-amber-400"
            key={release.key}
            title={`${release.title} · ${release.subtitle}`}
            onClick={() => onSelect(release.item, release.video?.id)}
          >
            <ReleaseImage release={release} className="h-full w-full" />
            <span className="absolute inset-0 grid place-items-center bg-zinc-950/65 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="grid size-9 place-items-center rounded-full bg-amber-400 text-zinc-950 shadow-lg">
                <Play fill="currentColor" size={16} />
              </span>
            </span>
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent px-1.5 pb-1.5 pt-5 text-[10px] font-semibold leading-tight">
              {release.subtitle}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ReleaseImage({
  release,
  className,
}: {
  release: CalendarRelease
  className: string
}) {
  return release.image ? (
    <img
      className={`${className} object-cover`}
      src={release.image}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className={`${className} grid place-items-center bg-zinc-800 text-zinc-500`}>
      <Film size={18} />
    </span>
  )
}

async function resolveMetadata(
  addons: InstalledAddon[],
  saved: LibraryItem,
): Promise<MetaItem> {
  const candidates = addonsForResource(addons, "meta", saved.type, saved.id)
  const attempts = await Promise.allSettled(
    candidates.map((addon) => loadMeta(addon.manifestUrl, saved.type, saved.id)),
  )
  const match = attempts.find(
    (result): result is PromiseFulfilledResult<MetaItem> => result.status === "fulfilled",
  )
  return normalizeMetaItem(match?.value, saved)
}

function buildReleases(items: ResolvedLibraryItem[]): CalendarRelease[] {
  const releases: CalendarRelease[] = items.flatMap(({ saved, meta }): CalendarRelease[] => {
      const item: CatalogItem = meta
      if (saved.type === "movie") {
        const date = releaseDateKey(meta.released)
        return date
          ? [{
              key: `movie:${saved.id}:${date}`,
              date,
              item,
              image: meta.poster,
              title: meta.name,
              subtitle: "Movie release",
              playable: true,
            }]
          : []
      }

      return (meta.videos ?? []).flatMap((video) => {
        const date = releaseDateKey(video.released)
        return date
          ? [{
              key: `series:${saved.id}:${video.id}:${date}`,
              date,
              item,
              video,
              image: meta.poster ?? video.thumbnail,
              title: meta.name,
              subtitle: `${episodeLabel(video)}${video.title ? ` · ${video.title}` : ""}`,
              playable: video.available !== false,
            }]
          : []
      })
    })
  return releases.sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.title.localeCompare(b.title) ||
      (a.video?.season ?? 0) - (b.video?.season ?? 0) ||
      (a.video?.episode ?? 0) - (b.video?.episode ?? 0),
  )
}

function formatDateKey(value: string): string {
  const [year, month, day] = value.split("-").map(Number)
  return compactDate.format(new Date(year!, month! - 1, day))
}
