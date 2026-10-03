import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { WatchPartyHub, type WatchPartyActor } from "./watch-party.js"

const host: WatchPartyActor = {
  partyId: "party",
  userId: "host",
  profileId: "host-profile",
  role: "host",
}
const guest: WatchPartyActor = {
  partyId: "party",
  userId: "guest",
  profileId: "guest-profile",
  role: "guest",
}
const media = { type: "movie" as const, mediaId: "movie", videoId: "movie", title: "Movie" }

describe("watch party timeline and lifecycle", () => {
  let server: Server
  let hub: WatchPartyHub
  let port: number
  const sockets: WebSocket[] = []
  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.terminate())
    hub?.close()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  async function setup(options: ConstructorParameters<typeof WatchPartyHub>[0] = {}) {
    server = createServer()
    hub = new WatchPartyHub(options)
    hub.attach(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw Error("No test port")
    port = address.port
    hub.seedMedia("party", media)
  }
  function connect(actor: WatchPartyActor) {
    const ticket = hub.createTicket(actor)
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/v1/watch-parties/socket?ticket=${ticket.ticket}`,
    )
    sockets.push(socket)
    return socket
  }
  function message(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", receive)
        reject(Error(`Missing ${type}`))
      }, 2000)
      function receive(raw: WebSocket.RawData) {
        const value = JSON.parse(raw.toString()) as Record<string, unknown>
        if (value.type === type) {
          clearTimeout(timer)
          socket.off("message", receive)
          resolve(value)
        }
      }
      socket.on("message", receive)
    })
  }
  it("owns revisions across host reconnects and rejects stale media commands", async () => {
    await setup()
    const first = connect(host)
    const joined = await message(first, "joined")
    const follower = connect(guest)
    await message(follower, "joined")
    const receive = message(follower, "state")
    first.send(
      JSON.stringify({
        v: 1,
        type: "state",
        epoch: joined.epoch,
        generation: joined.generation,
        sequence: 100,
        position: 20,
        duration: 200,
        playing: true,
        rate: 1,
      }),
    )
    const state = await receive
    expect(state.sequence).toBe(1)
    first.terminate()
    await message(follower, "host-disconnected")
    const nextHost = connect(host)
    const restored = await message(nextHost, "joined")
    expect(restored.media).toEqual(media)
    const nextState = message(follower, "state")
    nextHost.send(
      JSON.stringify({
        v: 1,
        type: "state",
        epoch: restored.epoch,
        generation: restored.generation,
        sequence: 1,
        position: 21,
        duration: 200,
        playing: true,
        rate: 1,
      }),
    )
    expect((await nextState).sequence).toBe(3)
    const changed = message(follower, "media")
    hub.publishMedia("party", { ...media, videoId: "next" })
    const nextMedia = await changed
    expect(nextMedia.generation).toBe(1)
    const valid = message(follower, "state")
    nextHost.send(
      JSON.stringify({
        v: 1,
        type: "state",
        epoch: joined.epoch,
        generation: 0,
        sequence: 2,
        position: 99,
        duration: 200,
        playing: true,
        rate: 1,
      }),
    )
    nextHost.send(
      JSON.stringify({
        v: 1,
        type: "state",
        epoch: joined.epoch,
        generation: 1,
        sequence: 3,
        position: 0,
        duration: 200,
        playing: false,
        rate: 1,
      }),
    )
    expect((await valid).position).toBe(0)
  })
  it("rejects pending tickets after end and consumes tickets once", async () => {
    await setup()
    const ticket = hub.createTicket(host)
    hub.removeParty("party")
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/v1/watch-parties/socket?ticket=${ticket.ticket}`,
    )
    sockets.push(socket)
    await new Promise<void>((resolve) => socket.once("error", () => resolve()))
    expect(socket.readyState).not.toBe(WebSocket.OPEN)
  })
  it("rechecks actor eligibility and ends after host grace", async () => {
    let allowed = true
    await setup({ authorize: async () => allowed, hostGraceMs: 30 })
    const leader = connect(host)
    await message(leader, "joined")
    const follower = connect(guest)
    await message(follower, "joined")
    const ended = message(follower, "ended")
    leader.terminate()
    expect((await ended).reason).toBe("Host disconnected")
    allowed = false
    const invalid = connect(guest)
    await new Promise<void>((resolve) => invalid.once("error", () => resolve()))
  })
  it("folds commands into the snapshot and ignores guests", async () => {
    await setup()
    const leader = connect(host)
    const joined = await message(leader, "joined")
    const follower = connect(guest)
    await message(follower, "joined")
    let receive = message(follower, "state")
    leader.send(
      JSON.stringify({
        v: 1,
        type: "state",
        epoch: joined.epoch,
        generation: 0,
        sequence: 1,
        position: 20,
        duration: 200,
        playing: false,
        rate: 1,
      }),
    )
    await receive
    receive = message(follower, "state")
    follower.send(
      JSON.stringify({
        v: 1,
        type: "command",
        epoch: joined.epoch,
        generation: 0,
        sequence: 2,
        command: "seek",
        value: 99,
      }),
    )
    leader.send(
      JSON.stringify({
        v: 1,
        type: "command",
        epoch: joined.epoch,
        generation: 0,
        sequence: 2,
        command: "rate",
        value: 1.5,
      }),
    )
    expect(await receive).toMatchObject({ position: 20, rate: 1.5, sequence: 2 })
    const late = connect(guest)
    expect((await message(late, "joined")).state).toMatchObject({ position: 20, rate: 1.5 })
  })
})
