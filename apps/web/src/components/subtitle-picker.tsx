import { ChevronLeft, Ear, Minus, Plus, WandSparkles } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { groupSubtitles } from "../lib/subtitle-groups"
import type { SubtitleAutoSyncResult } from "../lib/subtitle-auto-sync"
import {
  SUBTITLE_DELAY_STEP_MS,
  formatSubtitleDelay,
  heldSubtitleDelayStep,
  stepSubtitleDelay,
} from "../lib/title-playback"

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
  delayMs,
  onDelayChange,
  onSyncByEar,
  onAutoSync,
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
  delayMs: number
  onDelayChange: (delayMs: number) => void
  onSyncByEar?: () => void
  onAutoSync?: () => Promise<SubtitleAutoSyncResult>
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
        <SubtitleDelayStepper
          delayMs={delayMs}
          onChange={onDelayChange}
          onSyncByEar={onSyncByEar}
          onAutoSync={onAutoSync}
        />
      </section>
    </div>
  )
}

/**
 * Subtitle delay stepper, remembered per title. Matches the position stepper;
 * holding a button repeats it. Also used by the Electron overlay, so its
 * buttons opt into the overlay's hit regions. Players that show the sync by
 * ear card pass `onSyncByEar` to offer it here, and players that can read the
 * selected add-on subtitle pass `onAutoSync`, whose delay this applies.
 */
export function SubtitleDelayStepper({
  delayMs,
  onChange,
  onSyncByEar,
  onAutoSync,
}: {
  delayMs: number
  onChange: (delayMs: number) => void
  onSyncByEar?: () => void
  onAutoSync?: () => Promise<SubtitleAutoSyncResult>
}) {
  const [autoSync, setAutoSync] = useState<"running" | SubtitleAutoSyncResult>()
  const runAutoSync = async () => {
    if (!onAutoSync || autoSync === "running") return
    setAutoSync("running")
    const result = await onAutoSync()
    if (result.synced) onChange(result.delayMs)
    setAutoSync(result)
  }
  const latestDelay = useRef(delayMs)
  latestDelay.current = delayMs
  // Held repeats can outpace renders, so each step builds on the last one sent.
  const step = (direction: number, stepMs = SUBTITLE_DELAY_STEP_MS) => {
    latestDelay.current = stepSubtitleDelay(latestDelay.current, direction * stepMs)
    onChange(latestDelay.current)
  }
  const earlier = useHoldRepeat((stepMs) => step(-1, stepMs))
  const later = useHoldRepeat((stepMs) => step(1, stepMs))
  const buttonClass =
    "pointer-events-auto grid size-10 place-items-center rounded-full hover:bg-zinc-800"
  return (
    <>
      <div className="mt-4 flex items-center justify-between px-2">
        <p className="text-xs text-zinc-500">Delay</p>
        {delayMs !== 0 && (
          <button
            className="pointer-events-auto text-zinc-400 hover:text-white"
            data-overlay-interactive
            onClick={() => onChange(0)}
          >
            <span className="text-xs">Reset</span>
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center rounded-full bg-zinc-900">
        <button
          className={buttonClass}
          data-overlay-interactive
          {...earlier}
          aria-label="Show subtitles earlier"
        >
          <Minus size={16} />
        </button>
        <output className="flex-1 text-center text-sm tabular-nums">
          {formatSubtitleDelay(delayMs)}
        </output>
        <button
          className={buttonClass}
          data-overlay-interactive
          {...later}
          aria-label="Show subtitles later"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {onSyncByEar && (
          <button className={syncButtonClass} data-overlay-interactive onClick={onSyncByEar}>
            <Ear size={16} />
            Sync by ear
          </button>
        )}
        {onAutoSync && (
          <button
            className={syncButtonClass}
            data-overlay-interactive
            disabled={autoSync === "running"}
            onClick={() => void runAutoSync()}
          >
            <WandSparkles size={16} />
            {autoSync === "running" ? "Syncing…" : "Auto sync"}
          </button>
        )}
      </div>
      {autoSync && autoSync !== "running" && (
        <p role="status" className="mt-2 px-2 text-xs text-zinc-400">
          {autoSync.synced ? "Matched the embedded subtitles." : autoSync.reason}
        </p>
      )}
    </>
  )
}

const syncButtonClass =
  "pointer-events-auto flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-zinc-900 px-3 text-sm hover:bg-zinc-800 disabled:text-zinc-500"

/** Steps once on press, then repeats while held. Keyboard activation steps once per click. */
function useHoldRepeat(onStep: (stepMs: number) => void) {
  const latestStep = useRef(onStep)
  latestStep.current = onStep
  const timer = useRef<number | undefined>(undefined)
  const stop = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(() => stop, [])
  const start = () => {
    stop()
    const startedAt = performance.now()
    latestStep.current(SUBTITLE_DELAY_STEP_MS)
    const repeat = (wait: number) => {
      timer.current = window.setTimeout(() => {
        latestStep.current(heldSubtitleDelayStep(performance.now() - startedAt))
        repeat(100)
      }, wait)
    }
    repeat(400)
  }
  return {
    onPointerDown: (event: { button: number }) => {
      if (event.button === 0) start()
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: (event: { detail: number }) => {
      if (event.detail === 0) latestStep.current(SUBTITLE_DELAY_STEP_MS)
    },
  }
}
