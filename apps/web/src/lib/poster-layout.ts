/**
 * Poster columns for a content width. Home shelves and virtual grids both use it, so a poster is
 * the same size on every page.
 */
export function posterColumnsForWidth(width: number): number {
  if (width >= 2000) return 10
  if (width >= 1700) return 9
  if (width >= 1400) return 8
  if (width >= 1200) return 7
  if (width >= 1000) return 6
  if (width >= 768) return 5
  if (width >= 640) return 4
  if (width >= 340) return 3
  return 2
}

/**
 * CSS-only grid for static result lists. Breakpoints are `posterColumnsForWidth` plus page chrome:
 * 32px of gutters on phones, ~112px (sidebar + gutters) from 768px up.
 */
export const posterGridClass =
  "grid grid-cols-2 gap-x-3 gap-y-6 min-[372px]:grid-cols-3 min-[752px]:grid-cols-4 min-[880px]:grid-cols-5 min-[1112px]:grid-cols-6 min-[1312px]:grid-cols-7 min-[1512px]:grid-cols-8 min-[1812px]:grid-cols-9 min-[2112px]:grid-cols-10"

export const posterCoverClass =
  "poster-cover aspect-[2/3] overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/[0.06] transition group-hover:-translate-y-1 group-hover:ring-white/30 group-has-[:focus-visible]:ring-2 group-has-[:focus-visible]:ring-amber-400/80"

export const posterTitleClass =
  "h-8 overflow-hidden text-[13px] font-medium leading-4 text-zinc-100 line-clamp-2 sm:h-10 sm:text-sm sm:leading-5"

export const posterTitleSlotClass = posterTitleClass
