import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { oc, type } from "@orpc/contract"
import { implement } from "@orpc/server"
import { encodeRequestMessage, MessageType } from "@orpc/standard-server-peer"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import type { MessagePortLike, WebSocketLike } from "./channel.js"
import { connect } from "./connection.js"
import { wireContract } from "./handshake.js"
import { createSessions, type Session, type SessionContext } from "./sessions.js"
import { memoryPorts } from "./testing.js"
import { messagePort } from "./transport.js"
import { tunnelPort, withToken, type MainPortLike } from "./tunnel.js"
import { serveWebSocket } from "./websocket.js"

const contract = {
  ...wireContract,
  echo: oc.input(type<string>()).output(type<string>()),
  bytes: oc.input(type<Blob>()).output(type<number>()),
}

const protocolVersion = 1
const token = "wire-tests-only-not-a-production-credential"

// Serves the test contract's sessions to WebSocket clients that prove the token, at /rpc.
const serve = async () => {
  const closed = vi.fn<(session: Session) => void>()
  const { wire: _, ...app } = contract
  const api = implement(app).$context<SessionContext>()
  const sessions = createSessions({
    revision: protocolVersion,
    oldestClient: protocolVersion,
    router: api.router({
      echo: api.echo.handler(({ input }) => input),
      bytes: api.bytes.handler(({ input }) => input.size),
    }),
    closed,
  })
  const sockets = serveWebSocket(sessions, {
    path: "/rpc",
    token,
    origins: ["https://trusted.test"],
    maxPayloadBytes: 1024 * 1024,
    sendBudgetBytes: 1024 * 1024,
  })
  const server = createServer()
  server.on("upgrade", sockets.upgrade)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(async () => {
    await sockets.close()
    server.close()
  })
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`
  return { sockets, closed, url }
}

// A port tunnelled to `url` with `secret`, and the end its client holds. The socket is
// Node's own, as Electron's main process opens one.
const tunnel = (url: string, secret = token) => {
  const [end, client] = memoryPorts()
  const ended = vi.fn<(opened: boolean) => void>()
  const stop = tunnelPort(end, {
    open: () => new WebSocket(url) as unknown as WebSocketLike,
    token: secret,
    ended,
  })
  onTestFinished(stop)
  return { client, ended, stop }
}

const joined = (client: MessagePortLike) =>
  connect({
    contract,
    transport: messagePort(client),
    revision: protocolVersion,
    oldestServer: protocolVersion,
  })

describe("tunnelPort", () => {
  it("carries a port's client to a server that asks for a token", async () => {
    const { url } = await serve()
    const wire = await joined(tunnel(url).client)
    onTestFinished(() => wire.close())
    await expect(wire.session().client.echo("hi")).resolves.toBe("hi")
  })

  it("carries what the client sends as bytes", async () => {
    const { url } = await serve()
    const wire = await joined(tunnel(url).client)
    onTestFinished(() => wire.close())
    await expect(wire.session().client.bytes(new Blob(["12345"]))).resolves.toBe(5)
  })

  it("carries a port held as Electron's main process holds one", async () => {
    const { url } = await serve()
    const [end, client] = memoryPorts()
    const main: MainPortLike = {
      // eslint-disable-next-line unicorn/require-post-message-target-origin -- A port takes none.
      postMessage: (message) => end.postMessage(message),
      start: () => end.start?.(),
      close: () => end.close(),
      on: (kind: "message" | "close", listener: never) =>
        kind === "message"
          ? end.addEventListener("message", listener)
          : end.addEventListener("close", listener),
    }
    onTestFinished(
      tunnelPort(main, { open: () => new WebSocket(url) as unknown as WebSocketLike, token }),
    )
    const wire = await joined(client)
    onTestFinished(() => wire.close())
    await expect(wire.session().client.echo("hi")).resolves.toBe("hi")
  })

  it("leaves the server to refuse a token it doesn't know", async () => {
    const { url } = await serve()
    const { client } = tunnel(url, "another-token-the-server-was-never-given")
    await expect(joined(client)).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })

  it("closes the port of a server that can't be reached, and says it never opened", async () => {
    const { url, sockets } = await serve()
    await sockets.close()
    const { client, ended } = tunnel(url)
    await expect(joined(client)).rejects.toMatchObject({ code: "DISCONNECTED" })
    expect(ended).toHaveBeenCalledExactlyOnceWith(false)
  })

  it("ends the server's session when the client closes its port", async () => {
    const { url, closed } = await serve()
    const { client, ended } = tunnel(url)
    const wire = await joined(client)
    wire.close()
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
    expect(ended).toHaveBeenCalledExactlyOnceWith(true)
  })

  it("closes the port when the server drops the socket", async () => {
    const { url, sockets } = await serve()
    const { client, ended } = tunnel(url)
    const wire = await joined(client)
    onTestFinished(() => wire.close())
    await sockets.close()
    await vi.waitFor(() => expect(ended).toHaveBeenCalledExactlyOnceWith(true))
    await vi.waitFor(() => expect(wire.status.value.state).not.toBe("connected"))
  })

  it("closes the port when no socket can be made", () => {
    const [end] = memoryPorts()
    const closed = vi.fn<() => void>()
    end.addEventListener("close", closed)
    const ended = vi.fn<(opened: boolean) => void>()
    tunnelPort(end, {
      open: () => {
        throw new Error("no socket")
      },
      token,
      ended,
    })
    expect(closed).toHaveBeenCalledOnce()
    expect(ended).toHaveBeenCalledExactlyOnceWith(false)
  })
})

describe("withToken", () => {
  const request = (path: string, json: unknown) =>
    encodeRequestMessage("1", MessageType.REQUEST, {
      url: new URL(path, "http://orpc"),
      method: "POST",
      headers: {},
      body: { json },
    }) as Promise<string>

  it("adds the token to a handshake", async () => {
    const message = await request("/wire/handshake", { protocolVersion })
    const sent = JSON.parse((await withToken(message, token)) as string) as unknown
    expect(sent).toMatchObject({ p: { b: { json: { protocolVersion, token } } } })
  })

  it("leaves any other call as it came", async () => {
    const message = await request("/echo", "hi")
    await expect(withToken(message, token)).resolves.toBe(message)
  })

  it("leaves a message it can't read as it came", async () => {
    await expect(withToken("not a message", token)).resolves.toBe("not a message")
  })
})
