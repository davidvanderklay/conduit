// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({
  status: {
    version: "1.0.0",
    track: "stable",
    enabled: true,
    platform: "win32",
    installation: "native",
    phase: "idle",
  },
  owner: false,
}))
vi.mock("../lib/updates", () => ({
  useUpdates: () => ({
    desktop: { data: state.status },
    server: {
      data: {
        version: "1.0.0",
        track: "stable",
        apiLevel: 1,
        enabled: true,
        release: {
          version: "1.1.0",
          notesUrl: "https://github.com/davidvanderklay/conduit/releases/tag/server%2Fv1.1.0",
        },
      },
    },
  }),
}))
vi.mock("../lib/progress", () => ({ flushProgressOutbox: vi.fn() }))
import { UpdatesView } from "./updates-view"
const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount())
  document.body.innerHTML = ""
  delete window.__CONDUIT_ELECTRON__
})
async function render(isOwner = false) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <UpdatesView isOwner={isOwner} accountId="user" />
      </QueryClientProvider>,
    ),
  )
  return container
}
it("requires explicit Nightly opt-in before changing update preferences", async () => {
  const updates = vi.fn().mockResolvedValue(state.status)
  Object.defineProperty(window, "__CONDUIT_ELECTRON__", {
    value: { updates },
    writable: true,
    configurable: true,
  })
  const container = await render()
  const select = container.querySelector("select")!
  await act(() => {
    select.value = "nightly"
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
  expect(updates).not.toHaveBeenCalled()
  const confirm = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Use Nightly",
  )!
  await act(async () => confirm.click())
  expect(updates).toHaveBeenCalledWith("configure", { track: "nightly", enabled: true })
})
it("shows deployment instructions only to the owner and uses the independent server pin", async () => {
  const ordinary = await render()
  expect(ordinary.textContent).toContain("server owner can install")
  expect(ordinary.textContent).not.toContain("Update instructions")
  const owner = await render(true)
  await act(() =>
    [...owner.querySelectorAll("button")]
      .find((button) => button.textContent === "Update instructions")!
      .click(),
  )
  expect(owner.textContent).toContain("CONDUIT_SERVER_VERSION=1.1.0")
  expect(owner.textContent).toContain("docker compose up -d server")
  expect(owner.textContent).not.toContain("up -d server web")
})
