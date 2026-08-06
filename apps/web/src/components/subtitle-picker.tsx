import { ChevronLeft, Minus, Plus } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { groupSubtitles } from "../lib/subtitle-groups"

export interface SubtitlePickerItem {
  key: string
  language?: string
  title: string
  detail: string
  embedded?: boolean
  active: boolean
}

export function SubtitlePicker({
  items,
  preferredLanguage,
  off,
  loading,
  error,
  position,
  onPositionChange,
  onOff,
  onSelect,
}: {
  items: SubtitlePickerItem[]
  preferredLanguage?: string
  off: boolean
  loading?: boolean
  error?: string
  position: number
  onPositionChange: (value: number) => void
  onOff: () => void
  onSelect: (key: string) => void
}) {
  const groups = useMemo(
    () => groupSubtitles(items, (item) => item.language, preferredLanguage),
    [items, preferredLanguage],
  )
  const activeGroup = groups.find((group) => group.tracks.some((track) => track.active))
  const [selectedCode, setSelectedCode] = useState<string>()
  const selectedGroup = groups.find((group) => group.code === selectedCode)

  useEffect(() => {
    setSelectedCode(activeGroup?.code)
  }, [activeGroup?.code])

  useEffect(() => {
    if (selectedCode && !groups.some((group) => group.code === selectedCode)) {
      setSelectedCode(undefined)
    }
  }, [groups, selectedCode])

  const adjustPosition = (amount: number) =>
    onPositionChange(Math.max(10, Math.min(100, position + amount)))

  return (
    <div className="grid grid-cols-1 gap-3 sm:h-80 sm:min-h-0 sm:grid-cols-[minmax(10rem,0.9fr)_minmax(12rem,1.1fr)_minmax(10rem,0.8fr)]">
      <section
        className="max-h-48 min-h-0 overflow-y-auto overscroll-contain pr-1 sm:max-h-none"
        aria-label="Subtitle languages"
      >
        <p className="sticky top-0 z-10 mb-2 bg-zinc-950 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Languages
        </p>
        <button
          className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${
            off && !selectedCode
              ? "bg-amber-400 text-zinc-950"
              : "text-zinc-300 hover:bg-zinc-800"
          }`}
          onClick={() => {
            setSelectedCode(undefined)
            onOff()
          }}
          aria-pressed={off && !selectedCode}
        >
          Off
        </button>
        {groups.map((group) => (
          <button
            key={group.code}
            className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
              selectedCode === group.code ||
              (!selectedCode && activeGroup?.code === group.code)
                ? "bg-zinc-800 text-white"
                : "text-zinc-300 hover:bg-zinc-800"
            }`}
            onClick={() => {
              setSelectedCode(group.code)
              const embeddedTrack = group.tracks.find((track) => track.embedded)
              onSelect(embeddedTrack?.key ?? group.tracks[0]!.key)
            }}
            aria-expanded={selectedCode === group.code}
          >
            <span>{group.label}</span>
            <span className="text-xs text-zinc-500">{group.tracks.length}</span>
          </button>
        ))}
        {loading && <p className="px-3 py-2 text-xs text-zinc-500">Loading subtitles…</p>}
      </section>

      <section
        className="max-h-48 min-h-0 overflow-y-auto overscroll-contain border-zinc-800 pr-1 sm:max-h-none sm:border-l sm:pl-3"
        aria-label="Subtitle variants"
      >
        <div className="sticky top-0 z-10 mb-2 flex items-center gap-1 bg-zinc-950 px-2 pb-1">
          {selectedGroup && (
            <button
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white sm:hidden"
              onClick={() => setSelectedCode(undefined)}
              aria-label="Back to subtitle languages"
            >
              <ChevronLeft size={15} />
            </button>
          )}
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Variants</p>
        </div>
        {selectedGroup ? (
          selectedGroup.tracks.map((item) => (
            <button
              key={item.key}
              className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${
                item.active ? "bg-amber-400 text-zinc-950" : "text-zinc-300 hover:bg-zinc-800"
              }`}
              onClick={() => onSelect(item.key)}
              aria-pressed={item.active}
            >
              <span className="block text-sm font-medium">{item.title}</span>
              <span className={`block text-xs ${item.active ? "text-zinc-800" : "text-zinc-500"}`}>
                {item.detail}
              </span>
            </button>
          ))
        ) : (
          <p className="px-3 py-2 text-sm text-zinc-500">
            Choose a language to see its available variants.
          </p>
        )}
        {error && <p role="alert" className="px-3 py-2 text-xs text-red-400">{error}</p>}
      </section>

      <section className="min-h-0 border-zinc-800 sm:border-l sm:pl-3" aria-label="Subtitle settings">
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Settings
        </p>
        <p className="px-2 text-xs text-zinc-500">Vertical position</p>
        <div className="mt-2 flex items-center rounded-full bg-zinc-900">
          <button
            className="grid size-10 place-items-center rounded-full hover:bg-zinc-800"
            onClick={() => adjustPosition(-5)}
            aria-label="Raise subtitles"
          >
            <Minus size={16} />
          </button>
          <output className="flex-1 text-center text-sm tabular-nums">{position}%</output>
          <button
            className="grid size-10 place-items-center rounded-full hover:bg-zinc-800"
            onClick={() => adjustPosition(5)}
            aria-label="Lower subtitles"
          >
            <Plus size={16} />
          </button>
        </div>
      </section>
    </div>
  )
}
