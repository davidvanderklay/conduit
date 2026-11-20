import { ChevronDown } from "lucide-react"
import { cn } from "../../lib/utils"

/** Native select styled to match Input and Button. `options` are `[value, label]` pairs. */
export function Select<Value extends string>({
  label,
  value,
  options,
  disabled,
  className,
  onChange,
}: {
  label: string
  value: Value
  options: ReadonlyArray<readonly [Value, string]>
  disabled?: boolean
  className?: string
  onChange: (value: Value) => void
}) {
  return (
    <label className={cn("relative block w-full sm:w-60", className)}>
      <select
        aria-label={label}
        className="library-select h-10 w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 pr-9 text-sm text-zinc-100 outline-none transition hover:border-zinc-700 focus:border-amber-400/70 focus:ring-2 focus:ring-amber-400/15 disabled:text-zinc-500"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = options.find(([option]) => option === event.target.value)
          if (next) onChange(next[0])
        }}
      >
        {options.map(([option, name]) => (
          <option value={option} key={option}>
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
