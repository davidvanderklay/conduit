import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

const COLUMN_GAP = 16
const ROW_GAP = 28
const POSTER_COPY_HEIGHT = 48

export function VirtualPosterGrid<T>({
  items,
  itemKey,
  renderItem,
}: {
  items: T[]
  itemKey: (item: T) => string
  renderItem: (item: T) => ReactNode
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState(() => ({
    columns: columnsForViewport(window.innerWidth),
    width: 0,
  }))

  useEffect(() => {
    const update = () => {
      const width = gridRef.current?.clientWidth ?? 0
      setLayout((current) => {
        const next = { columns: columnsForViewport(window.innerWidth), width }
        return current.columns === next.columns && current.width === next.width ? current : next
      })
    }
    update()
    window.addEventListener("resize", update)
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update)
    if (gridRef.current) observer?.observe(gridRef.current)
    return () => {
      window.removeEventListener("resize", update)
      observer?.disconnect()
    }
  }, [])

  const rows = useMemo(() => chunk(items, layout.columns), [items, layout.columns])
  const scrollElement = appScrollElement()
  const scrollMargin = gridRef.current
    ? gridRef.current.getBoundingClientRect().top + (scrollElement?.scrollTop ?? 0)
    : 0
  const posterWidth =
    layout.width > 0 ? (layout.width - COLUMN_GAP * (layout.columns - 1)) / layout.columns : 180
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: appScrollElement,
    estimateSize: () => posterWidth * 1.5 + POSTER_COPY_HEIGHT,
    gap: ROW_GAP,
    overscan: 2,
    scrollMargin,
    getItemKey: (index) => rows[index]?.map(itemKey).join("|") ?? index,
    useFlushSync: false,
  })

  useEffect(() => rowVirtualizer.measure(), [layout, rowVirtualizer])

  return (
    <div
      ref={gridRef}
      className="relative w-full"
      style={{ height: rowVirtualizer.getTotalSize() }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => (
        <div
          ref={rowVirtualizer.measureElement}
          data-index={virtualRow.index}
          key={virtualRow.key}
          className="absolute left-0 top-0 grid w-full gap-x-4"
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            transform: `translateY(${virtualRow.start - scrollMargin}px)`,
          }}
        >
          {rows[virtualRow.index]?.map((item) => (
            <div className="group relative" key={itemKey(item)}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function appScrollElement(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.getElementById("app-scroll-viewport")
}

function columnsForViewport(width: number): number {
  if (width >= 1536) return 8
  if (width >= 1280) return 6
  if (width >= 1024) return 5
  if (width >= 768) return 4
  if (width >= 640) return 3
  return 2
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }
  return rows
}
