// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  progressOutboxStorageKey,
  usePlaybackProgress,
} from "./progress"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("playback progress outbox", () => {
  let root: Root
  let host: HTMLDivElement
  let queryClient: QueryClient

  beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    window.localStorage.clear()
  })

  afterEach(() => {
    act(() => root?.unmount())
    queryClient.clear()
    host.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("keeps a failed checkpoint and retries the newest position", async () => {
    let save: ((position: number, duration: number, force?: boolean) => Promise<void>) | undefined
    function Harness() {
      save = usePlaybackProgress(
        "00000000-0000-4000-8000-000000000001",
        "episode-1",
        { mediaType: "series", mediaId: "show", name: "Show", videoTitle: "Episode 1" },
        undefined,
        "user-1",
      ).save
      return null
    }

    let putAttempts = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        putAttempts += 1
        if (putAttempts === 1) throw new Error("offline")
      }
      return new Response(JSON.stringify({ item: null }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)),
      )
      await Promise.resolve()
    })
    expect(save).toBeDefined()
    await act(async () => {
      await save?.(10, 100, true)
    })

    const queued = JSON.parse(window.localStorage.getItem(progressOutboxStorageKey("user-1")) ?? "[]")
    expect(queued).toHaveLength(1)
    expect(queued[0].positionMs).toBe(10_000)

    await act(async () => {
      await save?.(20, 100, true)
    })

    expect(window.localStorage.getItem(progressOutboxStorageKey("user-1"))).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/profiles/00000000-0000-4000-8000-000000000001/progress/episode-1"),
      expect.objectContaining({ method: "PUT" }),
    )
    const putBodies = fetchMock.mock.calls
      .map(([, init]) => init?.body)
      .filter((body): body is string => typeof body === "string")
      .map((body) => JSON.parse(body))
    expect(putBodies.at(-1)?.positionMs).toBe(20_000)
  })
})
