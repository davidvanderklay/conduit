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
  leaveWatchParty: vi.fn().mockResolvedValue(undefined),
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

it("does not restore the initial guest session after leaving", async () => {
  const container = document.createElement("div")
  const root = createRoot(container)
  const session = new WatchPartySession({
    partyId: "party",
    role: "guest",
    ticket: "ticket",
    expiresAt: "2099",
    socketPath: "/socket",
  })
  const onSessionChange = vi.fn()
  try {
    await act(async () =>
      root.render(
        <WatchPartyDialog
          open
          profile={{ id: "guest", name: "Guest", isKids: false }}
          onOpenChange={() => {}}
          initialParty={{
            id: "party",
            mode: "private",
            status: "active",
            isHost: false,
            hostProfileId: "host",
            members: [],
            memberCount: 2,
            createdAt: "2026",
            expiresAt: "2099",
          }}
          initialSession={session}
          onSessionChange={onSessionChange}
        />,
      ),
    )
    const leave = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Leave party",
    )
    expect(leave).toBeDefined()
    await act(async () => leave?.click())
    expect(onSessionChange).toHaveBeenLastCalledWith(undefined)
    expect(container.textContent).toContain("Join a party")
    expect(container.textContent).not.toContain("Leave party")
  } finally {
    await act(async () => root.unmount())
    session.close()
  }
})
