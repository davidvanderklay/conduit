import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "../../lib/utils"
import { Card } from "./card"

/**
 * The one empty-state recipe: icon, title, optional description, optional actions.
 * Page-level empty states sit on the page background; pass `framed` where one stands in for a card.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  framed = false,
  iconClassName,
  className,
}: {
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  framed?: boolean
  iconClassName?: string
  className?: string
}) {
  const body = (
    <div className="mx-auto max-w-sm text-center">
      <Icon className={cn("mx-auto text-zinc-500", iconClassName)} size={28} />
      <p className="mt-3 text-base font-medium text-zinc-100">{title}</p>
      {description && (
        <p className="mt-1 text-balance text-sm leading-5 text-zinc-400">{description}</p>
      )}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
  return framed ? (
    <Card className={cn("grid place-items-center px-6 py-14", className)}>{body}</Card>
  ) : (
    <div className={cn("grid place-items-center px-6 py-14", className)}>{body}</div>
  )
}
