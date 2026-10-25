// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MigrateSettings } from "./migrate-settings"

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

const session = {
  source: "nuvio",
  backendUrl: "https://api.nuvio.tv",
  publishableKey: "anon",
  accessToken: "jwt",
}
const snapshot = {
  data: {
    format: "conduit-profile",
    library: [{ mediaId: "tt1" }],
    progress: [
      { videoId: "tt1:1:2", continueWatching: true },
      { videoId: "tt1:1:1", continueWatching: false },
    ],
    addons: [{ manifestId: "org.addon" }],
  },
  counts: { library: 1, continueWatching: 1, watched: 1, addons: 1 },
  warnings: ["1 add-on(s) did not return a manifest and will be skipped"],
}

describe("MigrateSettings", () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/v1/migrations/connect") {
        return {
          session,
          email: "a@b.c",
          profiles: [
            { id: "1", name: "Main" },
            { id: "2", name: "Kids" },
          ],
        }
      }
      if (path === "/v1/migrations/read") return snapshot
      return { added: { library: 1, progress: 1, addons: 0 } }
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    mocks.api.mockReset()
  })

  it("connects to Nuvio, reads the chosen profile, and imports only selected categories", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MigrateSettings
            profile={{ id: "target", name: "Main", isKids: false }}
            onBackup={async () => {}}
          />
        </QueryClientProvider>,
      )
    })
    await act(async () => click(button("Nuvio")))
    input("email").value = "a@b.c"
    input("password").value = "pw"
    await act(async () => host.querySelector("form")!.requestSubmit())

    expect(mocks.api).toHaveBeenCalledWith(
      "/v1/migrations/connect",
      expect.objectContaining({
        body: JSON.stringify({ source: "nuvio", email: "a@b.c", password: "pw" }),
      }),
    )
    const select = host.querySelector<HTMLSelectElement>("select[aria-label='Nuvio profile']")!
    await act(async () => {
      select.value = "2"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(mocks.api).toHaveBeenCalledWith(
      "/v1/migrations/read",
      expect.objectContaining({ body: JSON.stringify({ session, profileId: "2" }) }),
    )
    expect(host.textContent).toContain("did not return a manifest")

    await act(async () => click(checkbox("Watched")))
    await act(async () => click(checkbox("Add-ons")))
    await act(async () => click(button("Migrate to Main")))

    const [, init] = mocks.api.mock.calls.find(([path]) => path === "/v1/profiles/target/import")!
    expect(JSON.parse(init.body)).toEqual({
      mode: "additive",
      data: {
        ...snapshot.data,
        progress: [{ videoId: "tt1:1:2", continueWatching: true }],
        addons: [],
      },
    })
    expect(host.textContent).toContain("Added 1 titles, 1 progress entries, and 0 add-ons")
  })

  function button(label: string) {
    return [...host.querySelectorAll("button")].find((element) =>
      element.textContent?.includes(label),
    )!
  }
  function checkbox(label: string) {
    return [...host.querySelectorAll("label")]
      .find((element) => element.textContent?.startsWith(label))!
      .querySelector("input")!
  }
  function input(name: string) {
    return host.querySelector<HTMLInputElement>(`input[name='${name}']`)!
  }
})

function click(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}
