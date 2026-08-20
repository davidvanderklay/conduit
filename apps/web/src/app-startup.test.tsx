// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { App } from "./app"

const session = vi.hoisted(() => ({
  current: {
    data: undefined,
    error: null,
    isPending: true,
    isRefetching: false,
    refetch: vi.fn(),
  },
}))

const desktop = vi.hoisted(() => ({
  isDesktop: vi.fn(() => true),
}))

const serverRequest = vi.hoisted(() => vi.fn(() => new Promise<never>(() => undefined)))

vi.mock("./lib/auth", () => ({
  API_URL: "https://conduit.example",
  DESKTOP_SESSION_TOKEN: undefined,
  authClient: {
    useSession: () => session.current,
  },
}))

vi.mock("./lib/desktop", () => desktop)

vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api")
  return { ...actual, api: serverRequest }
})

describe("desktop startup", () => {
  let host: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    host.remove()
    vi.clearAllMocks()
  })

  it("shows the login screen while the desktop session request is pending", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>,
      )
    })

    expect(host.textContent).toContain("Welcome back")
    expect(host.textContent).toContain("Waking server…")
    expect(host.textContent).not.toContain("Starting conduit…")
    expect(document.querySelector<HTMLInputElement>('input[placeholder="you@example.com"]')?.disabled).toBe(true)
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Enter your password"]')?.disabled).toBe(true)
    expect(button("Sign in").disabled).toBe(true)
  })
})

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  )
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Could not find button "${label}"`)
  return match
}
