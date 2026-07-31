import { ChevronLeft, ChevronRight } from "lucide-react"

export function PaginationControls({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <nav className="mt-10 flex items-center justify-center gap-4" aria-label="Pagination">
      <button
        className="grid size-10 place-items-center rounded-xl border border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-40"
        disabled={page === 0}
        aria-label="Previous page"
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={18} />
      </button>
      <span className="min-w-28 text-center text-sm text-zinc-500">
        Page {page + 1} of {pages}
      </span>
      <button
        className="grid size-10 place-items-center rounded-xl border border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-40"
        disabled={page + 1 >= pages}
        aria-label="Next page"
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={18} />
      </button>
    </nav>
  )
}
