import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo, Socket } from "node:net"

import { eventIterator, oc, type } from "@orpc/contract"
import { implement } from "@orpc/server"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import { WebSocket, type ClientOptions, type RawData } from "ws"

import { socketChannel } from "./channel.js"
import { connect } from "./connection.js"
import { wireContract } from "./handshake.js"
import {
  createSessions,
  type Session,
  type SessionContext,
  type SessionsOptions,
} from "./sessions.js"
import { websocket } from "./transport.js"
import { serveWebSocket, type WebSocketOptions } from "./websocket.js"
import { createWireClient } from "./wire-client.js"

const contract = {
  ...wireContract,
  echo: oc.input(type<string>()).output(type<string>()),
  twice: oc.input(type<string>()).output(eventIterator(type<string>())),
}

const protocolVersion = 1
const token = "wire-tests-only-not-a-production-credential"

// Serves the test contract's sessions on a fresh HTTP server, at /rpc, with the TCP
// connections its clients made: their byte counts are what crossed the wire, and their data
// tells when what a peer sent has arrived.
const serve = async (
  options: Partial<WebSocketOptions> = {},
  sessionOptions: Partial<SessionsOptions> = {},
) => {
  const { wire: _, ...app } = contract
  const api = implement(app).$context<SessionContext>()
  const sessions = createSessions({
    protocolVersion,
    router: api.router({
      echo: api.echo.handler(({ input }) => input),
      // Two messages sent back to back, with nothing between them to let zlib finish.
      twice: api.twice.handler(async function* ({ input }) {
        yield input
        yield input
      }),
    }),
    ...sessionOptions,
  })
  const sockets = serveWebSocket(sessions, {
    path: "/rpc",
    ...(options.verify === undefined && { token }),
    origins: ["https://trusted.test"],
    maxPayloadBytes: 1024 * 1024,
    sendBudgetBytes: 1024 * 1024,
    ...options,
  })
  const server = createServer()
  const connections: Socket[] = []
  server.on("connection", (connection) => connections.push(connection))
  server.on("upgrade", sockets.upgrade)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(async () => {
    await sockets.close()
    server.close()
  })
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`
  return { sessions, sockets, url, connections }
}

// A raw socket's client, without the handshake.
const raw = async (url: string, options: ClientOptions = {}) => {
  const socket = new WebSocket(url, options)
  onTestFinished(() => socket.terminate())
  await once(socket, "open", { signal: AbortSignal.timeout(5_000) })
  return { socket, client: createWireClient<typeof contract>(socketChannel(socket)) }
}

type Served = { readonly url: string; readonly connections: readonly Socket[] }

// The server's end of the TCP connection its latest client made.
const latest = (served: Served): Socket => {
  const connection = served.connections.at(-1)
  if (!connection) throw new Error("No client's connection reached the server")
  return connection
}

// A raw client of `served` that has handshaked, beside the server's end of its TCP connection.
const joined = async (served: Served, options: ClientOptions = {}) => {
  const { socket, client } = await raw(served.url, options)
  await client.wire.handshake({ protocolVersion, token })
  return { socket, client, connection: latest(served) }
}

// The bytes the server wrote while `call` ran, beside the length of the message it answered with.
const sent = async (
  socket: WebSocket,
  connection: Socket,
  call: () => Promise<unknown>,
): Promise<{ readonly wire: number; readonly message: number }> => {
  let message = 0
  const received = (data: RawData) => {
    message = [data].flat().reduce((total, part) => total + part.byteLength, 0)
  }
  socket.on("message", received)
  const before = connection.bytesWritten
  await call()
  socket.off("message", received)
  return { wire: connection.bytesWritten - before, message }
}

// Terminal output as an agent colours it, where each escape takes six bytes in JSON.
const coloured = Array.from(
  { length: 2_000 },
  (_, line) => `\u001b[38;5;${line % 256}m${line}: \u001b[1mbuilt\u001b[0m in ${line % 97} ms\r\n`,
).join("")

const refusal = async (url: string, options: ClientOptions = {}) => {
  const socket = new WebSocket(url, options)
  onTestFinished(() => socket.terminate())
  const [error] = (await once(socket, "error")) as [Error]
  return error.message
}

describe("serveWebSocket", () => {
  it("serves a client that proves its token in the handshake", async () => {
    const { url, sessions } = await serve()
    const wire = await connect({
      contract,
      transport: websocket(url, { token }),
      protocolVersion,
      retryDelay: () => 0,
    })
    onTestFinished(() => wire.close())
    expect(wire.status.value).toEqual({ state: "connected", epoch: sessions.epoch })
    await expect(wire.session().client.echo("hi")).resolves.toBe("hi")
  })

  it("refuses a wrong token, and calls before the handshake", async () => {
    const { url } = await serve()
    const { client } = await raw(url)
    await expect(client.echo("hi")).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    await expect(client.wire.handshake({ protocolVersion, token: "wrong" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
    await expect(client.echo("hi")).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    await client.wire.handshake({ protocolVersion, token })
    await expect(client.echo("hi")).resolves.toBe("hi")
  })

  it("cuts off a socket that goes on being refused before it authenticates", async () => {
    const closed = vi.fn<(session: Session) => void>()
    const { url } = await serve({}, { closed })
    const { socket, client } = await raw(url)
    const ended = once(socket, "close")
    const wrong = () =>
      client.wire.handshake({ protocolVersion, token: "wrong" }).catch((error: unknown) => error)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- One refusal at a time.
      expect(await wrong()).toMatchObject({ code: "UNAUTHORIZED" })
    }
    expect(closed).not.toHaveBeenCalled()
    expect(await wrong()).toMatchObject({ code: "DISCONNECTED" })
    await ended
    expect(closed).toHaveBeenCalledOnce()
  })

  it("lets `verify` decide in place of a token", async () => {
    const { url } = await serve({ verify: (given) => given === "pass" })
    const { client } = await raw(url)
    await expect(client.wire.handshake({ protocolVersion, token })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
    await client.wire.handshake({ protocolVersion, token: "pass" })
    await expect(client.echo("hi")).resolves.toBe("hi")
  })

  it("refuses tokens too short or too long, and a server with neither token nor verify", () => {
    const sessions = createSessions({ protocolVersion, router: {} })
    const base = { path: "/rpc", origins: [], maxPayloadBytes: 1, sendBudgetBytes: 1 }
    expect(() => serveWebSocket(sessions, { ...base, token: "short" })).toThrow(
      "between 32 and 512",
    )
    expect(() => serveWebSocket(sessions, { ...base, token: "x".repeat(513) })).toThrow(
      "between 32 and 512",
    )
    expect(() => serveWebSocket(sessions, base)).toThrow("token or verify")
    expect(() => serveWebSocket(sessions, { ...base, token, verify: () => true })).toThrow(
      "not both",
    )
    expect(() => serveWebSocket(sessions, { ...base, token, sendBudgetBytes: Number.NaN })).toThrow(
      "sendBudgetBytes",
    )
  })

  it("refuses other paths and browser origins it doesn't allow", async () => {
    const { url } = await serve()
    expect(await refusal(url.replace("/rpc", "/other"))).toContain("404")
    expect(await refusal(url, { origin: "https://untrusted.test" })).toContain("403")
    await raw(url, { origin: "https://trusted.test" })
  })

  it("counts unauthenticated sockets against its connections", async () => {
    const { url } = await serve({ maxConnections: 1 })
    await raw(url)
    expect(await refusal(url)).toContain("429")
  })

  // The authentication deadline on a fake clock, so a slow machine's handshake still comes in
  // time: only the server's timeouts are faked, and its sockets run as ever.
  const authMs = 10_000
  const onFakeClock = () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    onTestFinished(() => void vi.useRealTimers())
  }

  it("closes a socket that doesn't authenticate in time", async () => {
    onFakeClock()
    const { url } = await serve({ authMs })
    const { socket } = await raw(url)
    const closed = once(socket, "close")
    await vi.advanceTimersByTimeAsync(authMs)
    const [code] = (await closed) as [number]
    expect(code).toBe(1008)
  })

  it("keeps a socket that authenticated in time", async () => {
    onFakeClock()
    const { url } = await serve({ authMs })
    const { client } = await raw(url)
    await client.wire.handshake({ protocolVersion, token })
    await vi.advanceTimersByTimeAsync(authMs)
    await expect(client.echo("hi")).resolves.toBe("hi")
  })

  it("releases a session when its peer closes", async () => {
    const closed = vi.fn<(session: Session) => void>()
    const { url } = await serve({}, { closed })
    const { socket, client } = await raw(url)
    await client.wire.handshake({ protocolVersion, token })
    const ended = once(socket, "close")
    socket.close()
    await ended
    expect(closed).toHaveBeenCalledOnce()
  })

  it("releases the session of a connection that drops without a close", async () => {
    const closed = vi.fn<(session: Session) => void>()
    const { url } = await serve({}, { closed })
    const { socket, client } = await raw(url)
    await client.wire.handshake({ protocolVersion, token })
    // Ends the TCP connection without a close frame, as a lost network does.
    socket.terminate()
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
  })

  // The heartbeat on a fake clock, so the handshake comes before the first ping however slow
  // the machine: only the server's intervals are faked, and its sockets run as ever.
  const heartbeatMs = 10_000
  const onHeartbeatClock = () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    onTestFinished(() => void vi.useRealTimers())
  }

  it("drops a peer that sends nothing at all from one ping to the next, releasing its session", async () => {
    onHeartbeatClock()
    const closed = vi.fn<(session: Session) => void>()
    const { url } = await serve({ heartbeatMs }, { closed })
    const { socket, client } = await raw(url, { autoPong: false })
    await client.wire.handshake({ protocolVersion, token })
    const ended = once(socket, "close")
    // Neither a pong nor anything else comes before the next ping.
    await vi.advanceTimersByTimeAsync(heartbeatMs * 2)
    await ended
    expect(closed).toHaveBeenCalledOnce()
  })

  it("keeps a quiet peer that answers its pings", async () => {
    onHeartbeatClock()
    const closed = vi.fn<(session: Session) => void>()
    const { url, connections } = await serve({ heartbeatMs }, { closed })
    const { client } = await raw(url)
    await client.wire.handshake({ protocolVersion, token })
    // Each beat pings, and the pong is all the server reads before the next.
    const beat = async () => {
      const pong = once(connections[0]!, "data")
      await vi.advanceTimersByTimeAsync(heartbeatMs)
      expect(closed).not.toHaveBeenCalled()
      await pong
    }
    await beat()
    await beat()
    await beat()
    await vi.advanceTimersByTimeAsync(heartbeatMs)
    expect(closed).not.toHaveBeenCalled()
    await expect(client.echo("hi")).resolves.toBe("hi")
  })

  it("keeps a peer whose message is still arriving though no pong comes, until it stops", async () => {
    onHeartbeatClock()
    const closed = vi.fn<(session: Session) => void>()
    const { url, connections } = await serve({ heartbeatMs }, { closed })
    const { socket, client } = await raw(url, { autoPong: false })
    await client.wire.handshake({ protocolVersion, token })
    // One message on its way a part at a time, as a large one on a slow link: the server reads
    // its bytes, never a whole message, and no pong.
    const part = async () => {
      const read = once(connections[0]!, "data")
      socket.send("x".repeat(1024), { fin: false })
      await read
      await vi.advanceTimersByTimeAsync(heartbeatMs)
      expect(closed).not.toHaveBeenCalled()
    }
    await part()
    await part()
    await part()

    // Nothing more comes before the next beat.
    const ended = once(socket, "close")
    await vi.advanceTimersByTimeAsync(heartbeatMs)
    await ended
    expect(closed).toHaveBeenCalledOnce()
  })

  it("cuts off a socket whose unsent bytes outgrow its send budget", async () => {
    const closed = vi.fn<(session: Session) => void>()
    const { url } = await serve({ sendBudgetBytes: 1024 }, { closed })
    const { socket, client } = await raw(url)
    await client.wire.handshake({ protocolVersion, token })
    void client.echo("x".repeat(4096)).catch(() => {})
    await once(socket, "close")
    expect(closed).toHaveBeenCalledOnce()
  })

  it("counts a message waiting to be compressed in full against its send budget", async () => {
    const closed = vi.fn<(session: Session) => void>()
    const { socket, client } = await joined(await serve({ sendBudgetBytes: 60 * 1024 }, { closed }))
    // Compressed, it takes a few hundred bytes, but it waits for zlib at its full 40 KiB: one
    // fits the budget, and a second sent while the first waits doesn't.
    const text = "x".repeat(40 * 1024)
    await expect(client.echo(text)).resolves.toBe(text)
    const ended = once(socket, "close")
    void client.twice(text).catch(() => {})
    await ended
    expect(closed).toHaveBeenCalledOnce()
  })

  it("compresses a large message for a client that offers to, which gets it whole", async () => {
    const { socket, client, connection } = await joined(await serve())
    expect(socket.extensions).toBe("permessage-deflate")
    const { wire, message } = await sent(socket, connection, async () => {
      await expect(client.echo(coloured)).resolves.toBe(coloured)
    })
    expect(wire).toBeLessThan(message / 4)
  })

  it("compresses for Node's own WebSocket, which the websocket transport opens", async () => {
    const served = await serve()
    const wire = await connect({
      contract,
      transport: websocket(served.url, { token }),
      protocolVersion,
      retryDelay: () => 0,
    })
    onTestFinished(() => wire.close())
    const connection = latest(served)
    const before = connection.bytesWritten
    await expect(wire.session().client.echo(coloured)).resolves.toBe(coloured)
    const written = connection.bytesWritten - before
    expect(written).toBeGreaterThan(0)
    expect(written).toBeLessThan(Buffer.byteLength(JSON.stringify(coloured)) / 4)
  })

  it("sends a message under 1 KiB as it is", async () => {
    const { socket, client, connection } = await joined(await serve())
    // Compressed, it would take a few bytes.
    const short = "x".repeat(500)
    const { wire, message } = await sent(socket, connection, async () => {
      await expect(client.echo(short)).resolves.toBe(short)
    })
    expect(message).toBeLessThan(1024)
    expect(wire).toBeGreaterThan(message)
  })

  it("serves a client that doesn't offer compression as before, every message as it is", async () => {
    const { socket, client, connection } = await joined(await serve(), {
      perMessageDeflate: false,
    })
    expect(socket.extensions).toBe("")
    const { wire, message } = await sent(socket, connection, async () => {
      await expect(client.echo(coloured)).resolves.toBe(coloured)
    })
    expect(wire).toBeGreaterThan(message)
  })

  it("refuses a message that inflates past maxPayloadBytes, however few bytes it took", async () => {
    const maxPayloadBytes = 256 * 1024
    const closed = vi.fn<(session: Session) => void>()
    const { socket, client, connection } = await joined(
      await serve({ maxPayloadBytes }, { closed }),
    )
    const fits = "x".repeat(maxPayloadBytes - 1024)
    await expect(client.echo(fits)).resolves.toBe(fits)
    const before = connection.bytesRead
    const ended = once(socket, "close")
    await expect(client.echo("x".repeat(maxPayloadBytes))).rejects.toMatchObject({
      code: "DISCONNECTED",
    })
    await ended
    expect(connection.bytesRead - before).toBeLessThan(maxPayloadBytes / 64)
    expect(closed).toHaveBeenCalledOnce()
  })

  it("ends every socket on close, and refuses new ones", async () => {
    const { url, sockets } = await serve()
    const { socket } = await raw(url)
    const ended = once(socket, "close")
    await sockets.close()
    await ended
    expect(await refusal(url)).toContain("503")
  })
})
