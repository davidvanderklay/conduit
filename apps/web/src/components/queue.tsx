import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { GripVertical, ListEnd, ListPlus, ListStart, ListVideo, ListX, X } from "lucide-react"
import type { QueueItem } from "../lib/api"
import {
  applyQueueAction,
  emitQueueNotice,
  moveQueueItem,
  onQueueNotice,
  queueActionKinds,
  queueItemDetail,
  queueItemKey,
  removeFromQueue,
  type QueueActionKind,
  type QueueControls,
} from "../lib/queue"
import type { PosterAction } from "./poster-action-menu"
import { Button } from "./ui/button"

const actionPresentation = {
  add: { label: "Add to queue", icon: <ListPlus size={16} /> },
  next: { label: "Play next", icon: <ListStart size={16} /> },
  remove: { label: "Remove from queue", icon: <ListX size={16} /> },
} satisfies Record<QueueActionKind, Pick<PosterAction, "label" | "icon">>

/** Queue entries for an action menu. Empty when the item cannot be queued. */
export function queueMenuActions(
  queue: QueueControls,
  item: QueueItem | undefined,
  canQueue = true,
): PosterAction[] {
  if (!item) return []
  return queueActionKinds(queue.items, item, canQueue).map((kind) => ({
    ...actionPresentation[kind],
    onSelect: () => {
      const { items, notice } = applyQueueAction(queue.items, item, kind)
      queue.set(items)
      emitQueueNotice(notice)
    },
  }))
}

/** Queue glyph with the number of queued items, for the buttons that open the queue. */
export function QueueIcon({ count, size = 20 }: { count: number; size?: number }) {
  return (
    <span className="relative grid">
      <ListVideo size={size} />
      {count > 0 && (
        <span className="absolute -right-2.5 -top-2.5 min-w-4 rounded-full bg-amber-400 px-1 text-center text-[10px] font-semibold leading-4 text-zinc-950">
          {Math.min(count, 99)}
        </span>
      )}
    </span>
  )
}

/** Adds the item to the queue, or removes it once queued. Renders nothing for unqueueable items. */
export function QueueToggle({
  queue,
  item,
  canQueue = true,
}: {
  queue: QueueControls
  item: QueueItem | undefined
  canQueue?: boolean
}) {
  const action = queueMenuActions(queue, item, canQueue).find(
    (candidate) => candidate.label !== actionPresentation.next.label,
  )
  if (!action) return null
  return (
    <Button type="button" variant="secondary" onClick={action.onSelect}>
      {action.icon}
      {action.label}
    </Button>
  )
}

/** Shows the latest queue notice for a moment. Mount one per window surface. */
export function QueueNotice({ className = "" }: { className?: string }) {
  const [notice, setNotice] = useState<string>()
  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = onQueueNotice((next) => {
      setNotice(next)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setNotice(undefined), 2_200)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])
  if (!notice) return null
  return (
    <p
      role="status"
      className={`pointer-events-none z-[90] whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-100 shadow-xl shadow-black/60 ${className}`}
    >
      {notice}
    </p>
  )
}

/**
 * Queue rows shared by the browse drawer and the player drawer. Dragging the
 * grip reorders live and commits on release; arrow keys on the grip move a row
 * one slot. [compact] stacks artwork above the text for narrow columns.
 */
export function QueueList({
  queue,
  compact = false,
  onPlay,
}: {
  queue: QueueControls
  compact?: boolean
  onPlay: (item: QueueItem) => void
}) {
  const [drag, setDrag] = useState<{ from: number; to: number }>()
  const dragOrigin = useRef({ y: 0, step: 1 })
  const displayed = drag ? moveQueueItem(queue.items, drag.from, drag.to) : queue.items
  const draggingKey = drag ? queueItemKey(queue.items[drag.from]!) : undefined

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    const row = event.currentTarget.closest("li")
    const list = row?.parentElement
    if (!row || !list) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0
    dragOrigin.current = { y: event.clientY, step: row.offsetHeight + gap }
    setDrag({ from: index, to: index })
  }

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const { y, step } = dragOrigin.current
    const to = Math.min(
      queue.items.length - 1,
      Math.max(0, drag.from + Math.round((event.clientY - y) / step)),
    )
    if (to !== drag.to) setDrag({ from: drag.from, to })
  }

  const endDrag = (commit: boolean) => {
    if (!drag) return
    if (commit && drag.from !== drag.to) queue.set(displayed)
    setDrag(undefined)
  }

  return (
    <ol className={`flex flex-col ${compact ? "gap-2" : "gap-0.5"}`}>
      {displayed.map((item, index) => {
        const key = queueItemKey(item)
        const dragging = key === draggingKey
        return (
          <li
            key={key}
            className={`group/queue relative flex rounded-lg transition-colors ${
              compact ? "flex-col" : "items-center gap-1"
            } ${dragging ? "z-10 bg-zinc-800 shadow-xl shadow-black/60" : "hover:bg-white/7"}`}
          >
            <button
              type="button"
              aria-label={`Reorder ${item.name}`}
              className={`grid shrink-0 cursor-grab touch-none place-items-center rounded text-zinc-600 hover:text-zinc-200 focus-visible:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 active:cursor-grabbing ${
                compact ? "absolute left-1 top-1 z-10 size-6 bg-black/70" : "h-12 w-6"
              }`}
              onPointerDown={(event) => startDrag(event, index)}
              onPointerMove={moveDrag}
              onPointerUp={() => endDrag(true)}
              onPointerCancel={() => endDrag(false)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
                event.preventDefault()
                const moved = moveQueueItem(
                  queue.items,
                  index,
                  index + (event.key === "ArrowUp" ? -1 : 1),
                )
                if (moved !== queue.items) queue.set(moved)
              }}
            >
              <GripVertical size={15} />
            </button>
            <button
              type="button"
              className={`flex min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                compact ? "flex-col gap-1.5 p-1" : "items-center gap-3 py-1.5 pr-9"
              }`}
              aria-label={`Play ${item.name}, ${queueItemDetail(item)}`}
              onClick={() => onPlay(item)}
            >
              <QueueArtwork src={item.artwork ?? item.poster} compact={compact} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{item.name}</span>
                <span className="block truncate text-[11px] text-zinc-500">
                  <span className="text-zinc-400">{index + 1}</span> · {queueItemDetail(item)}
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-label={`Remove ${item.name} from queue`}
              className={`absolute grid size-7 place-items-center rounded-md text-zinc-400 opacity-0 hover:bg-white/10 hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 group-hover/queue:opacity-100 ${
                compact ? "right-1 top-1 bg-black/70" : "right-1 top-1/2 -translate-y-1/2"
              }`}
              onClick={() => {
                queue.set(removeFromQueue(queue.items, key))
                emitQueueNotice("Removed from queue")
              }}
            >
              <X size={15} />
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** Queue title with its size and a two-step clear, so one stray click cannot empty it. */
export function QueueHeader({ queue, onClose }: { queue: QueueControls; onClose?: () => void }) {
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (queue.items.length === 0) setConfirming(false)
  }, [queue.items.length])
  return (
    <div className="flex h-9 items-center justify-between gap-2">
      <h2 className="truncate text-sm font-semibold text-white">
        Queue
        {queue.items.length > 0 && (
          <span className="font-normal text-zinc-500"> · {queue.items.length}</span>
        )}
      </h2>
      <div className="flex shrink-0 items-center gap-1 text-xs">
        {queue.items.length > 0 &&
          (confirming ? (
            <>
              <button
                type="button"
                className="rounded-md px-2 py-1 font-medium text-red-300 hover:bg-red-500/10"
                onClick={() => {
                  queue.set([])
                  emitQueueNotice("Queue cleared")
                }}
              >
                Clear all
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                onClick={() => setConfirming(false)}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/10 hover:text-white"
              onClick={() => setConfirming(true)}
            >
              Clear
            </button>
          ))}
        {onClose && (
          <button
            type="button"
            aria-label="Close queue"
            className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        )}
      </div>
    </div>
  )
}

/** Queue manager that slides over the browse views from the right edge. */
export function QueueDrawer({
  queue,
  onClose,
  onPlay,
}: {
  queue: QueueControls
  onClose: () => void
  onPlay: (item: QueueItem) => void
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [onClose])

  return (
    <div className="fixed inset-0 top-16 z-40" role="dialog" aria-modal="true" aria-label="Queue">
      <button
        type="button"
        aria-label="Close queue"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 right-0 flex w-[min(100vw,400px)] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/70">
        <div className="border-b border-zinc-800 px-4 py-2">
          <QueueHeader queue={queue} onClose={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 pb-24 md:pb-2">
          {queue.items.length > 0 ? (
            <QueueList queue={queue} onPlay={onPlay} />
          ) : (
            <p className="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-zinc-500">
              <ListEnd size={26} />
              Your queue is empty
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}

function QueueArtwork({ src, compact }: { src?: string; compact: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return (
    <span
      className={`block shrink-0 overflow-hidden rounded-md bg-zinc-900 ${
        compact ? "aspect-video w-full" : "aspect-video w-20"
      }`}
    >
      {src && !failed && (
        <img
          className="size-full object-cover"
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  )
}
