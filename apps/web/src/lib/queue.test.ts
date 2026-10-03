import { describe, expect, it } from "vitest"
import type { QueueItem } from "./api"
import {
  addToQueue,
  applyQueueAction,
  moveQueueItem,
  moveToQueueFront,
  nextQueuedItem,
  queueActionKinds,
  queueAfterPlaybackStarted,
  queuedUpNext,
  queueItemFor,
} from "./queue"

const first: QueueItem = { mediaType: "series", mediaId: "show", videoId: "s1e1", name: "Show" }
const second: QueueItem = { mediaType: "movie", mediaId: "movie", videoId: "movie", name: "Movie" }
const third: QueueItem = { mediaType: "series", mediaId: "other", videoId: "s2e1", name: "Other" }

describe("queue", () => {
  it("prevents duplicates and moves an item to the front without dropping others", () => {
    expect(addToQueue([first], first)).toEqual([first])
    expect(moveToQueueFront([first, second], second)).toEqual([second, first])
    expect(moveToQueueFront([first], second)).toEqual([second, first])
  })

  it("reorders without dropping items and ignores out-of-range moves", () => {
    const queue = [first, second, third]
    expect(moveQueueItem(queue, 0, 2)).toEqual([second, third, first])
    expect(moveQueueItem(queue, 0, 3)).toBe(queue)
  })

  it("queues movies and episodes but never a bare series", () => {
    expect(queueItemFor({ id: "show", type: "series", name: "Show" })).toBeUndefined()
    expect(queueItemFor({ id: "channel", type: "tv", name: "Channel" })).toBeUndefined()
    expect(queueItemFor({ id: "movie", type: "movie", name: "Movie" })).toEqual(second)
  })

  it("prefers the episode thumbnail and falls back to the title background", () => {
    const show = { id: "show", type: "series", name: "Show", background: "background.jpg" }
    expect(queueItemFor(show, { id: "s1e1", thumbnail: "episode.jpg" })?.artwork).toBe(
      "episode.jpg",
    )
    expect(queueItemFor(show, { id: "s1e2" })?.artwork).toBe("background.jpg")
  })

  it("consumes the playing item and never offers it as up next", () => {
    expect(queueAfterPlaybackStarted([first, second], "show", "s1e1")).toEqual([second])
    expect(nextQueuedItem([first, second], "show", "s1e1")).toBe(second)
    expect(nextQueuedItem([first], "show", "s1e1")).toBeUndefined()
  })

  it("offers actions that match where the item sits in the queue", () => {
    expect(queueActionKinds([], first)).toEqual(["add"])
    expect(queueActionKinds([second], first)).toEqual(["next", "add"])
    expect(queueActionKinds([first, second], first)).toEqual(["remove"])
    expect(queueActionKinds([second, first], first)).toEqual(["next", "remove"])
    expect(queueActionKinds([second], first, false)).toEqual([])
    expect(queueActionKinds([second, first], first, false)).toEqual(["remove"])
  })

  it("reports the queue position when adding", () => {
    expect(applyQueueAction([], first, "add").notice).toBe("Up next")
    expect(applyQueueAction([second], first, "add")).toEqual({
      items: [second, first],
      notice: "Added to queue · #2",
    })
    expect(applyQueueAction([second, first], first, "next").items).toEqual([first, second])
  })

  it("titles queued episodes by episode and movies by name", () => {
    expect(
      queuedUpNext({ ...first, videoTitle: "Pilot", season: 1, episode: 1 }),
    ).toMatchObject({ queued: true, title: "Pilot", detail: "Show · S1 E1" })
    expect(queuedUpNext(second)).toMatchObject({ title: "Movie", detail: undefined })
  })
})
