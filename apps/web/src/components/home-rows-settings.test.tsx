// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Bootstrap, InstalledAddon } from "../lib/api"
import { SettingsView } from "./settings-view"

;(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean
  }
).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock("../lib/api", async (original) => ({
  ...(await original<object>()),
  api: mocks.api,
}))

const addons: InstalledAddon[] = [
  {
    id: "install",
    manifestId: "cinemeta",
    manifestUrl: "https://cinemeta.example/manifest.json",
    position: 0,
    enabled: true,
    manifest: {
      id: "cinemeta",
      version: "1",
      name: "Cinemeta",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [
        { id: "top", type: "movie", name: "Popular" },
        { id: "top", type: "series", name: "Popular" },
      ],
    },
  },
]

const bootstrap: Bootstrap = {
  households: [
    {
      id: "home",
      name: "Home",
      role: "owner",
      profiles: [{ id: "main", name: "Main", isKids: false }],
    },
  ],
}

function Harness() {
  const data = useQuery({
    queryKey: ["bootstrap", "user"],
    queryFn: () => mocks.api("/v1/bootstrap") as Promise<Bootstrap>,
    staleTime: Infinity,
  }).data
  const profile = data?.households[0]?.profiles[0]
  if (!profile) return null
  return (
    <SettingsView
      profile={profile}
      profiles={[profile]}
      addons={addons}
      householdId="home"
      initialPage="content"
      onSelectProfile={() => {}}
      onNavigate={() => {}}
      onSignedOut={() => {}}
    />
  )
}

describe("home rows settings", () => {
  let root: Root
  let host: HTMLDivElement
  let queryClient: QueryClient

  beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    queryClient = new QueryClient()
    queryClient.setQueryData(["bootstrap", "user"], bootstrap)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    mocks.api.mockReset()
  })

  const render = (open: boolean) =>
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>{open && <Harness />}</QueryClientProvider>,
      ),
    )
  const titles = () =>
    [...host.querySelectorAll<HTMLInputElement>("input[aria-label^='Rename']")].map(
      (input) => input.value,
    )

  const click = (label: string) =>
    act(async () => host.querySelector<HTMLButtonElement>(`[aria-label='${label}']`)!.click())
  const seriesShown = () =>
    host.querySelector("[aria-label='Show Popular - Series on Home']")!.getAttribute("aria-checked")

  it("reopens with edits whose saves have not finished", async () => {
    // The server applies each save only when the test finishes it.
    let serverRows: unknown = undefined
    const pendingSaves: Array<() => void> = []
    mocks.api.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method !== "PATCH") {
        const [household] = bootstrap.households
        return Promise.resolve({
          households: [
            { ...household, profiles: [{ ...household!.profiles[0], homeRows: serverRows }] },
          ],
        })
      }
      return new Promise((resolve) =>
        pendingSaves.push(() => {
          serverRows = JSON.parse(String(init.body)).homeRows
          resolve({})
        }),
      )
    })
    render(true)
    expect(titles()).toEqual(["Popular - Movie", "Popular - Series"])

    await click("Move Popular - Series up")
    await click("Show Popular - Series on Home")
    render(false)
    render(true)
    expect(titles()).toEqual(["Popular - Series", "Popular - Movie"])
    expect(seriesShown()).toBe("false")

    // The first save landing must not bring back its older rows while the second is queued.
    await act(async () => pendingSaves.shift()!())
    await act(async () => {})
    render(false)
    render(true)
    expect(seriesShown()).toBe("false")
    await act(async () => pendingSaves.shift()?.())
  })
})
