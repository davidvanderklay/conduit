// @vitest-environment jsdom
import { act, type ComponentProps } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { expect, it, vi } from "vitest"
import { App } from "./app"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  party: {
    id: "party",
    mode: "private" as const,
    status: "active" as const,
    isHost: false,
    hostProfileId: "host",
    members: [],
    memberCount: 2,
    createdAt: "2026",
    expiresAt: "2099",
    media: { type: "movie" as const, mediaId: "movie", videoId: "movie", title: "Party movie" },
  },
}))
vi.mock("./lib/auth", () => ({
  API_URL: "http://localhost",
  DESKTOP_SESSION_TOKEN: undefined,
  authClient: {
    useSession: () => ({
      data: { user: { id: "user", email: "guest@example.test" } },
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
            name: "Household",
            role: "owner",
            profiles: [{ id: "guest", name: "Guest", isKids: false }],
          },
        ],
      }
    if (path.endsWith("/addons")) return { addons: [] }
    return { items: [] }
  }),
}))
vi.mock("./components/watch-party-dialog", async () => {
  const { createElement } = await import("react")
  const { WatchPartySession } = await import("./lib/watch-party")
  return {
    WatchPartyButton: ({ onClick }: { onClick: () => void }) =>
      createElement("button", { onClick }, "Watch together"),
    WatchPartyDialog: ({
      open,
      onPartyJoined,
    }: ComponentProps<typeof import("./components/watch-party-dialog").WatchPartyDialog>) =>
      open
        ? createElement(
            "button",
            {
              onClick: () =>
                onPartyJoined?.(
                  fixture.party,
                  new WatchPartySession({
                    partyId: "party",
                    party: fixture.party,
                    role: "guest",
                    ticket: "ticket",
                    socketPath: "/socket",
                    expiresAt: "2099",
                  }),
                  {
                    party: fixture.party,
                    ticket: "ticket",
                    socketPath: "/socket",
                    expiresAt: "2099",
                  },
                ),
            },
            "Join fixture party",
          )
        : null,
  }
})
vi.mock("./components/media-details", async () => {
  const { createElement, useEffect } = await import("react")
  return {
    MediaDetails: ({
      item,
      initialWatchPartySession,
      onWatchPartySessionChange,
    }: ComponentProps<typeof import("./components/media-details").MediaDetails>) => {
      useEffect(() => {
        fixture.mounts++
        return () => {
          fixture.unmounts++
        }
      }, [])
      return createElement(
        "button",
        { onClick: () => onWatchPartySessionChange?.(undefined) },
        `${item.name}: ${initialWatchPartySession ? "Leave party" : "Independent playback"}`,
      )
    },
  }
})

it.each(["home", "discover"])(
  "keeps party-launched playback mounted after leaving from %s",
  async (section) => {
    localStorage.clear()
    fixture.mounts = 0
    fixture.unmounts = 0
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const click = async (text: string) => {
      const button = [...container.querySelectorAll("button")].find(
        (button) =>
          button.textContent?.includes(text) || button.getAttribute("aria-label") === text,
      )
      expect(button).toBeDefined()
      await act(async () => button?.click())
    }
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <App />
          </QueryClientProvider>,
        ),
      )
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      if (section === "discover") await click("Discover")
      await click("Watch together")
      await click("Join fixture party")
      expect(container.textContent).toContain("Party movie: Leave party")
      await click("Party movie: Leave party")
      expect(container.textContent).toContain("Party movie: Independent playback")
      expect(fixture.mounts).toBe(1)
      expect(fixture.unmounts).toBe(0)
    } finally {
      await act(async () => root.unmount())
      client.clear()
      container.remove()
      localStorage.clear()
    }
  },
)
