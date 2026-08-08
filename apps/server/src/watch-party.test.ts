import { afterEach, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import WebSocket from "ws"
import { WatchPartyHub } from "./watch-party.js"

describe("watch party socket protocol", () => {
  let server: Server | undefined
  let hub: WatchPartyHub | undefined
  const sockets: WebSocket[] = []

  afterEach(async () => {
    sockets.forEach((socket) => socket.close())
    hub?.close()
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
    hub = undefined
  })

  it("binds a socket to a single-use actor ticket and relays host state", async () => {
    server = createServer()
    hub = new WatchPartyHub()
    hub.attach(server)
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Test server did not expose a port")
    const hostTicket = hub.createTicket({ partyId: "party", userId: "host", profileId: "host-profile", role: "host" })
    const guestTicket = hub.createTicket({ partyId: "party", userId: "guest", profileId: "guest-profile", role: "guest" })
    const host = connect(`ws://127.0.0.1:${address.port}/v1/watch-parties/socket?ticket=${hostTicket.ticket}`)
    const guest = connect(`ws://127.0.0.1:${address.port}/v1/watch-parties/socket?ticket=${guestTicket.ticket}`)
    sockets.push(host.socket, guest.socket)

    expect((await host.joined).type).toBe("joined")
    expect((await guest.joined).type).toBe("joined")
    host.socket.send(JSON.stringify({
      v: 1,
      type: "state",
      position: 12,
      duration: 100,
      playing: true,
      rate: 1,
      sequence: 1,
    }))
    await expectMessage(guest.socket, (message) => message.type === "state" && message.sequence === 1)

    const replay = new WebSocket(`ws://127.0.0.1:${address.port}/v1/watch-parties/socket?ticket=${hostTicket.ticket}`)
    sockets.push(replay)
    await expectClose(replay)
  })
})

function connect(url: string): { socket: WebSocket; joined: Promise<Record<string, unknown>> } {
  const socket = new WebSocket(url)
  const joined = new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.once("message", (value) => resolve(JSON.parse(value.toString()) as Record<string, unknown>))
    socket.once("error", reject)
  })
  return { socket, joined }
}

async function expectMessage(socket: WebSocket, predicate: (message: Record<string, unknown>) => boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for party message")), 2_000)
    socket.on("message", (value) => {
      const message = JSON.parse(value.toString()) as Record<string, unknown>
      if (!predicate(message)) return
      clearTimeout(timeout)
      resolve()
    })
    socket.once("error", reject)
  })
}

async function expectClose(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Ticket replay was accepted")), 2_000)
    socket.once("close", () => {
      clearTimeout(timeout)
      resolve()
    })
    socket.once("error", () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}
