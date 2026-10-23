// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { expect, it, vi } from "vitest"
import { App } from "./app"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("./lib/auth", () => ({
  API_URL: "http://localhost",
  DESKTOP_SESSION_TOKEN: undefined,
  authClient: {
    useSession: () => ({
      data: { user: { id: "user", email: "viewer@example.test" } },
      isPending: false,
    }),
  },
}))

vi.mock("./lib/api", async () => ({
  ...(await vi.importActual<typeof import("./lib/api")>("./lib/api")),
  api: vi.fn(async (path: string) => {
    if (path === "/v1/bootstrap")
      return {
        households: [
          {
            id: "household",
            profiles: [{ id: "profile", name: "Viewer", isKids: false }],
          },
        ],
      }
    if (path.endsWith("/addons"))
      return {
        addons: [
          {
            id: "catalog",
            enabled: true,
            manifestUrl: "https://catalog.example/manifest.json",
            manifest: {
              id: "catalog",
              name: "Catalog",
              resources: ["catalog", "meta"],
              types: ["series"],
              catalogs: [
                { id: "search", type: "series", extra: [{ name: "search", isRequired: true }] },
              ],
            },
          },
        ],
      }
    return { items: [] }
  }),
}))

vi.mock("./lib/core", async () => ({
  ...(await vi.importActual<typeof import("./lib/core")>("./lib/core")),
  loadCatalog: vi.fn(async (_url, _type, _id, extras) => [
    {
      id: extras?.[0]?.value === "Example Actor" ? "related-show" : "show",
      type: "series",
      name: extras?.[0]?.value === "Example Actor" ? "Actor's other show" : "Original show",
    },
  ]),
  loadMeta: vi.fn(async () => ({
    id: "show",
    type: "series",
    name: "Original show",
    cast: ["Example Actor"],
    videos: [],
  })),
}))

it("shows actor results immediately after opening a title from search and clicking its cast", async () => {
  localStorage.clear()
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === label,
    )
    expect(button, label).toBeDefined()
    await act(async () => button!.click())
    await settle()
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <App />
        </QueryClientProvider>,
      ),
    )
    await settle()
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Original show",
      )
      input.dispatchEvent(new Event("input", { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    await settle()
    const viewport = container.querySelector<HTMLDivElement>("#app-scroll-viewport")!
    viewport.scrollTop = 1200
    await click("Original show")
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Example Actor")
    await click("Example Actor")
    expect(input.value).toBe("Example Actor")
    expect(container.textContent).toContain("Actor's other show")
    expect(container.querySelector('[aria-label="Original show details"]')).toBeNull()
    expect(viewport.scrollTop).toBe(0)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    localStorage.clear()
  }
})
