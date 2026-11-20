import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

/**
 * A titled block inside a page: heading and optional description sit above a card.
 * `bare` drops the card for content that brings its own tiles.
 */
export function Section({
  title,
  description,
  actions,
  bare = false,
  className,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  bare?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-5 text-zinc-400">{description}</p>}
        </div>
        {actions}
      </div>
      <div
        className={cn("flex-1", !bare && "overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900")}
      >
        {children}
      </div>
    </section>
  )
}
