import { describe, expect, it } from "vitest"
import { TV_PARTY_HANDOFF_TTL_MS, TvPartyHandoffs, inviteTokenFromInput } from "./tv-party-handoff.js"

const token = "a".repeat(43)

describe("TV watch party invitation handoff", () => {
  it("reads the token from a bare value or an invitation link", () => {
    expect(inviteTokenFromInput(token)).toBe(token)
    expect(inviteTokenFromInput(` https://conduit.example/party/${token} `)).toBe(token)
    expect(inviteTokenFromInput(`conduit://party/${token}?server=https%3A%2F%2Fconduit.example`)).toBe(token)
    expect(inviteTokenFromInput("https://conduit.example/party/short")).toBeUndefined()
  })

  it("delivers one invitation once, only to the account that asked", () => {
    const handoffs = new TvPartyHandoffs()
    const { id } = handoffs.start("user-a", 0)
    expect(handoffs.collect(id, "user-a", 1)).toBe("pending")
    expect(handoffs.submit(id, token, 2)).toBe(true)
    expect(handoffs.submit(id, "b".repeat(43), 3)).toBe(false)
    expect(handoffs.collect(id, "user-b", 4)).toBe("expired")
    expect(handoffs.collect(id, "user-a", 5)).toEqual({ token })
    expect(handoffs.collect(id, "user-a", 6)).toBe("expired")
  })

  it("expires unanswered requests", () => {
    const handoffs = new TvPartyHandoffs()
    const { id } = handoffs.start("user-a", 0)
    expect(handoffs.isOpen(id, TV_PARTY_HANDOFF_TTL_MS - 1)).toBe(true)
    expect(handoffs.submit(id, token, TV_PARTY_HANDOFF_TTL_MS)).toBe(false)
    expect(handoffs.collect(id, "user-a", TV_PARTY_HANDOFF_TTL_MS)).toBe("expired")
  })
})
