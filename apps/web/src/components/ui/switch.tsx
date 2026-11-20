import { cn } from "../../lib/utils"

/**
 * The app's one switch visual. It owns no state: pair it with the real control, either an
 * `sr-only peer` checkbox placed just before it inside a label, or a `role="switch"` button
 * that wraps it.
 */
export function SwitchIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-amber-300",
        checked ? "bg-amber-400" : "bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "absolute left-1 top-1 size-4 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-5",
        )}
      />
    </span>
  )
}
