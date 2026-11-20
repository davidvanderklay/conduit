import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

/** Container for every top-level view, so gutters and the title's left edge never drift between pages. */
export const pageClassName = "mx-auto w-full max-w-[2200px] px-4 py-8 sm:px-6 2xl:max-w-none 2xl:px-8"

/** Title row at the top of a view. `actions` sits on the right, aligned to the title's baseline. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn("mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-white">
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">{description}</p>}
      </div>
      {actions}
    </header>
  )
}
