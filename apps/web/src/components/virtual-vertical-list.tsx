import { useRef, type ReactNode } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

export function VirtualVerticalList<T>({
  items,
  itemKey,
  renderItem,
  estimateSize = 420,
  gap = 40,
}: {
  items: T[]
  itemKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  estimateSize?: number
  gap?: number
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const scrollElement = appScrollElement()
  const scrollMargin = listRef.current
    ? listRef.current.getBoundingClientRect().top + (scrollElement?.scrollTop ?? 0)
    : 0
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: appScrollElement,
    estimateSize: () => estimateSize,
    gap,
    overscan: 1,
    scrollMargin,
    getItemKey: (index) => itemKey(items[index]!),
    useFlushSync: false,
  })

  return (
    <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtualItem) => (
        <div
          ref={virtualizer.measureElement}
          data-index={virtualItem.index}
          key={virtualItem.key}
          className="absolute left-0 top-0 w-full"
          style={{ transform: `translateY(${virtualItem.start - scrollMargin}px)` }}
        >
          {renderItem(items[virtualItem.index]!)}
        </div>
      ))}
    </div>
  )
}

function appScrollElement(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.getElementById("app-scroll-viewport")
}
