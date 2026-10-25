import type { AudioTrackDisplay } from "../lib/audio-track-display"

/** An audio track menu entry: the title with its format, then the language underneath. */
export function AudioTrackRow({
  display,
  selected,
  disabled,
  onSelect,
}: {
  display: AudioTrackDisplay
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      className={`mb-1 block w-full rounded-lg px-3 py-2 text-left disabled:text-zinc-600 ${
        selected ? "bg-amber-400 text-zinc-950" : "text-zinc-300 enabled:hover:bg-zinc-800"
      }`}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="block truncate text-sm font-medium" title={display.primary}>
        {display.primary}
      </span>
      <span className={`text-xs ${selected ? "text-zinc-800" : "text-zinc-500"}`}>
        {display.secondary}
      </span>
    </button>
  )
}
