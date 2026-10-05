// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { InstalledAddon, Profile } from "../lib/api"
import { AddonsView } from "./addons-view"

;(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean
  }
).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
}))

vi.mock("../lib/api", async (original) => ({
  ...(await original<object>()),
  api: mocks.api,
}))

const profile = {
  id: "profile",
  name: "Alex",
  isKids: false,
} as Profile

const addons: InstalledAddon[] = [
  {
    id: "addon",
    manifestId: "addon",
    manifestUrl: "https://addon.example/manifest.json",
    position: 0,
    enabled: true,
    manifest: {
      id: "addon",
      version: "1",
      name: "Sample Add-on",
      description: "A test add-on",
      resources: [],
      types: [],
      catalogs: [],
    },
  },
]

describe("AddonsView mutation failures", () => {
  let root: Root
  let host: HTMLDivElement
  let client: QueryClient

  beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    host.remove()
    vi.restoreAllMocks()
    vi.resetAllMocks()
  })

  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AddonsView profile={profile} addons={addons} onRefresh={() => {}} />
        </QueryClientProvider>,
      )
    })
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  function toggle(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('[role="switch"]')
    if (!element) throw new Error("Could not find add-on toggle")
    return element
  }

  function uninstall(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(
      '[title="Uninstall Sample Add-on"]',
    )
    if (!element) throw new Error("Could not find uninstall button")
    return element
  }

  it("shows an accessible update error and clears it after a successful retry", async () => {
    mocks.api
      .mockRejectedValueOnce(new Error("Could not update add-on"))
      .mockResolvedValueOnce(undefined)

    await render()

    await act(async () => toggle().click())
    await settle()

    const alert = host.querySelector<HTMLElement>('[role="alert"]')

    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain("Could not update add-on")
    expect(alert?.className).toContain("text-red-400")

    await act(async () => toggle().click())
    await settle()

    expect(mocks.api).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it("prevents duplicate updates while an update is pending", async () => {
    let resolveUpdate!: () => void

    mocks.api.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve
      }),
    )

    await render()

    await act(async () => toggle().click())
    await settle()

    expect(toggle().disabled).toBe(true)

    toggle().click()

    expect(mocks.api).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveUpdate()
    })
    await settle()
  })

  it("shows an accessible removal error and clears it after a successful retry", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)

    mocks.api
      .mockRejectedValueOnce(new Error("Could not uninstall add-on"))
      .mockResolvedValueOnce(undefined)

    await render()

    await act(async () => uninstall().click())
    await settle()

    const alert = host.querySelector<HTMLElement>('[role="alert"]')

    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain("Could not uninstall add-on")
    expect(alert?.className).toContain("text-red-400")

    await act(async () => uninstall().click())
    await settle()

    expect(mocks.api).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it("prevents duplicate removals while a removal is pending", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)

    let resolveRemoval!: () => void

    mocks.api.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRemoval = resolve
      }),
    )

    await render()

    await act(async () => uninstall().click())
    await settle()

    expect(uninstall().disabled).toBe(true)

    uninstall().click()

    expect(mocks.api).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRemoval()
    })
    await settle()
  })
})
