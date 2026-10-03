import { afterEach, describe, expect, it, vi } from "vitest"
import { WatchPartySession, partyPositionAt, type WatchPartyEvent } from "./watch-party"
class Socket {
  static OPEN = 1
  static CLOSED = 3
  static instances: Socket[] = []
  readyState = 1
  onmessage?: (event: { data: string }) => void
  onclose?: (event: { code: number; reason: string }) => void
  onopen?: () => void
  constructor(_url: string) {
    Socket.instances.push(this)
  }
  send(_value: string) {}
  close() {
    this.readyState = 3
  }
  receive(value: object) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, ...value }) })
  }
}
const state = {
  epoch: "one",
  generation: 0,
  sequence: 100,
  position: 20,
  duration: 200,
  playing: true,
  rate: 1,
  serverTime: 1000,
}
const sessions: WatchPartySession[] = []
function session(
  refreshTicket?: () => Promise<{ ticket: string; expiresAt: string; socketPath: string }>,
) {
  vi.stubGlobal("window", { location: { origin: "http://localhost" } })
  vi.stubGlobal("WebSocket", Socket)
  const value = new WatchPartySession({
    partyId: "party",
    role: "guest",
    ticket: "ticket",
    expiresAt: "2099",
    socketPath: "/socket",
    refreshTicket,
  })
  sessions.push(value)
  value.connect()
  return value
}
afterEach(() => {
  sessions.splice(0).forEach((value) => value.close())
  Socket.instances = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe("party client recovery", () => {
  it("replays state to a player mounted after joining and accepts a new server epoch", () => {
    const client = session()
    const socket = Socket.instances[0]!
    socket.receive({
      type: "joined",
      role: "guest",
      epoch: "one",
      generation: 0,
      state,
      participants: [],
      serverTime: Date.now(),
    })
    const events: WatchPartyEvent[] = []
    client.subscribe((event) => events.push(event))
    expect(events[0]).toMatchObject({ type: "joined", state })
    socket.receive({
      type: "joined",
      epoch: "two",
      generation: 0,
      participants: [],
      serverTime: Date.now(),
    })
    socket.receive({ type: "state", ...state, epoch: "two", sequence: 1 })
    expect(client.state?.sequence).toBe(1)
    socket.receive({ type: "state", ...state, epoch: "one", sequence: 101 })
    expect(client.state?.epoch).toBe("two")
  })
  it("corrects clock skew using a round trip", () => {
    vi.useFakeTimers()
    vi.setSystemTime(31_000)
    let monotonic = 0
    vi.spyOn(performance, "now").mockImplementation(() => monotonic)
    const client = session()
    const socket = Socket.instances[0]!
    socket.receive({
      type: "joined",
      epoch: "one",
      generation: 0,
      participants: [],
      serverTime: 1000,
    })
    socket.receive({ type: "clock", clientTime: 31_000, serverTime: 1000 })
    expect(client.positionAt(state)).toBe(20)
    vi.setSystemTime(320_000)
    monotonic = 1000
    expect(client.positionAt(state)).toBe(21)
    expect(partyPositionAt({ ...state, playing: false }, 50_000)).toBe(20)
  })
  it("keeps retrying after ticket refresh fails and stops on explicit end", async () => {
    vi.useFakeTimers()
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(Error("offline"))
      .mockResolvedValue({ ticket: "fresh", expiresAt: "2099", socketPath: "/socket" })
    session(refresh)
    const socket = Socket.instances[0]!
    socket.readyState = 3
    socket.onclose?.({ code: 1006, reason: "" })
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(Socket.instances).toHaveLength(2)
    Socket.instances[1]!.receive({ type: "ended", reason: "Party ended" })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
