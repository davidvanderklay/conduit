// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { InstalledAddon, WatchProgress } from "../lib/api"
import type { MetaItem } from "../lib/core"
import { ContinueWatching, ContinueWatchingView } from "./progress-view"

const mocks = vi.hoisted(() => ({
  api: vi.fn<(path: string) => Promise<{ items: WatchProgress[]; nextOffset?: number | null }>>(),
  loadMeta: vi.fn<(url: string, type: string, id: string) => Promise<MetaItem>>(),
}))
vi.mock("../lib/api", async (original) => ({ ...(await original<object>()), api: mocks.api }))
vi.mock("../lib/core", async (original) => ({
  ...(await original<object>()),
  loadMeta: mocks.loadMeta,
}))
// The behavior under test is list resolution; virtualization is tested separately.
vi.mock("./virtual-poster-grid", () => ({
  VirtualPosterGrid: ({
    items,
    renderItem,
  }: {
    items: unknown[]
    renderItem: (item: unknown) => ReactNode
  }) => items.map(renderItem),
}))

const addons: InstalledAddon[] = [
  {
    id: "addon",
    manifestId: "addon",
    position: 0,
    manifestUrl: "https://addon.example/manifest.json",
    enabled: true,
    manifest: {
      id: "addon",
      version: "1",
      name: "Addon",
      resources: ["meta"],
      types: ["series"],
      catalogs: [],
    },
  },
]
const finale = { id: "finale", season: 1, episode: 2 }
function progress(id: string, watched = true): WatchProgress {
  return {
    videoId: "finale",
    mediaType: "series",
    mediaId: id,
    name: id,
    season: 1,
    episode: 2,
    positionMs: 60_000,
    durationMs: 60_000,
    watched,
    updatedAt: "2026-10-01T12:00:00Z",
  }
}

describe("Continue Watching lists", () => {
  let root: Root
  let element: HTMLDivElement
  let client: QueryClient
  beforeEach(() => {
    element = document.createElement("div")
    document.body.append(element)
    root = createRoot(element)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.api.mockResolvedValue({ items: [] })
  })
  afterEach(() => {
    act(() => root.unmount())
    client.clear()
    element.remove()
    vi.resetAllMocks()
  })
  async function render(children: ReactNode) {
    await act(async () => {
      root.render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  it("hides completed titles, keeps uncertain metadata, and restores a hidden show after refresh", async () => {
    const items = [
      progress("finished"),
      progress("missing"),
      progress("upcoming"),
      { ...progress("movie"), mediaType: "movie" },
    ]
    mocks.loadMeta.mockImplementation(async (_url, _type, id) => {
      if (id === "missing") throw new Error("Offline")
      return {
        id,
        type: "series",
        name: id,
        videos:
          id === "upcoming"
            ? [
                finale,
                { id: "future", season: 2, episode: 1, available: false, released: "2099-01-01" },
              ]
            : [finale],
      }
    })
    await render(
      <ContinueWatching
        items={items}
        addons={addons}
        profileId="profile"
        onSelect={() => {}}
        onSeeMore={() => {}}
      />,
    )
    expect(element.querySelector('[aria-label="View finished, caught up"]')).toBeNull()
    expect(element.textContent).not.toContain("finished")
    expect(element.textContent).not.toContain("movie")
    expect(element.textContent).toContain("missing")
    expect(element.textContent).toContain("upcoming")
    await act(async () => {
      client.setQueryData(["meta", "series", "finished", ["addon"]], {
        id: "finished",
        type: "series",
        name: "finished",
        videos: [finale, { id: "new", season: 2, episode: 1 }],
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(element.querySelector('[aria-label="Play the next episode of finished"]')).not.toBeNull()
  })

  it("fills the full page from later candidates and opens the next episode", async () => {
    const movies = Array.from({ length: 50 }, (_, index) => ({
      ...progress(`movie-${index}`),
      mediaType: "movie",
    }))
    const series = progress("older-show")
    mocks.api.mockImplementation(async (path) => {
      if (path.includes("view=continue"))
        return path.includes("offset=50")
          ? { items: [series], nextOffset: null }
          : { items: movies, nextOffset: 50 }
      return { items: [] }
    })
    mocks.loadMeta.mockResolvedValue({
      id: series.mediaId,
      type: "series",
      name: series.name,
      videos: [finale, { id: "next", season: 2, episode: 1 }],
    })
    const onSelect = vi.fn()
    await render(<ContinueWatchingView profileId="profile" addons={addons} onSelect={onSelect} />)
    expect(element.textContent).toContain("older-show")
    expect(element.textContent).not.toContain("movie-0")
    expect(mocks.api).toHaveBeenCalledWith(expect.stringContaining("offset=50"))
    await act(async () =>
      element.querySelector<HTMLButtonElement>('[aria-label="View older-show"]')!.click(),
    )
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "older-show" }),
      "next",
      series,
      "resume",
    )
  })
})
