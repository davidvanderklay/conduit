import type { HTMLAttributes } from "react"
import { cn } from "../../lib/utils"

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-zinc-800/80 bg-zinc-900/70 shadow-2xl shadow-black/20",
        className,
      )}
      {...props}
    />
  )
}
