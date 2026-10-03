// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { WatchPartyDialog } from "./watch-party-dialog"
import { WatchPartySession } from "../lib/watch-party"
import { listWatchParties } from "../lib/watch-party-api"
vi.mock("../lib/auth", () => ({ API_URL: "http://localhost" }))
vi.mock("../lib/watch-party-api", () => ({
  listWatchParties: vi.fn().mockResolvedValue({ parties: [] }),
}))

it("does not refetch the list or replay the subscription when parent callbacks change", async () => {
  const container = document.createElement("div")
  const root = createRoot(container)
  const session = new WatchPartySession({
    partyId: "party",
    role: "guest",
    ticket: "ticket",
    expiresAt: "2099",
    socketPath: "/socket",
  })
  const subscribe = vi.spyOn(session, "subscribe")
  const profile = {
    id: "profile",
    name: "Guest",
    isKids: false,
    usesPrimaryAddons: false,
    avatarColor: "#000",
    avatarUrl: null,
  }
  const render = () =>
    root.render(
      <WatchPartyDialog
        open
        profile={profile}
        initialSession={session}
        onOpenChange={() => {}}
        onSessionChange={() => {}}
        onPartyMediaChange={() => {}}
      />,
    )
  try {
    await act(async () => render())
    await act(async () => render())
    expect(listWatchParties).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    session.close()
  }
})
