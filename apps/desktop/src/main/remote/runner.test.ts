import type { WebSocketLike } from "@novadeck/wire"
import type { MessagePortMain } from "electron"

import { describe, expect, it } from "../../test"
import { appLog } from "../logs/logs.test-support"
import { remoteRunner } from "./runner"

const settings = {
  url: "ws://127.0.0.1:8787/api/rpc",
  token: "desktop-tests-only-not-a-production-credential",
}

type Kind = "open" | "close" | "error" | "message"

/** A socket as the runner's host opens one: what it was sent, and its events for the test to raise. */
class FakeSocket implements WebSocketLike {
  readonly sent: unknown[] = []
  readonly listeners: { kind: Kind; listener: (event: { data: unknown }) => void }[] = []
  binaryType = "blob"
  readyState = 0
  closes = 0
  constructor(readonly url: string) {}
  send(data: unknown): void {
    this.sent.push(data)
  }
  close(): void {
    this.closes += 1
  }
  addEventListener(kind: Kind, listener: (event: { data: unknown }) => void): void {
    this.listeners.push({ kind, listener })
  }
  raise(kind: Kind, data?: unknown): void {
    if (kind === "open") this.readyState = 1
    for (const each of this.listeners) if (each.kind === kind) each.listener({ data })
  }
}

/** A port as the main process holds one: what was posted to it, and whether it was closed. */
class FakePort {
  readonly posted: unknown[] = []
  closes = 0
  postMessage(message: unknown): void {
    this.posted.push(message)
  }
  start(): void {}
  close(): void {
    this.closes += 1
  }
  on(): this {
    return this
  }
}

const port = () => {
  const fake = new FakePort()
  return { fake, port: fake as unknown as MessagePortMain }
}

/** A remote runner on fake sockets, with what it logged. */
const start = () => {
  const sockets: FakeSocket[] = []
  const { logger, lines } = appLog()
  const runner = remoteRunner({
    settings,
    log: logger.for("remote"),
    open: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
  })
  const events = () => lines().map((line) => line.evt)
  return { runner, sockets, lines, events }
}

describe("remoteRunner", () => {
  it("opens a socket to the runner for each port the page asks for", () => {
    const { runner, sockets } = start()
    expect(runner.deliver(port().port)).toBe(true)
    expect(runner.deliver(port().port)).toBe(true)
    expect(sockets.map((socket) => socket.url)).toEqual([settings.url, settings.url])
  })

  it("carries what the runner sends to the page's port", () => {
    const { runner, sockets } = start()
    const { fake, port: delivered } = port()
    runner.deliver(delivered)
    sockets[0]!.raise("open")
    sockets[0]!.raise("message", "from the runner")
    expect(fake.posted).toEqual(["from the runner"])
  })

  it("only disconnects when the app closes it, and delivers no port afterwards", async () => {
    const { runner, sockets } = start()
    const { fake, port: delivered } = port()
    runner.deliver(delivered)
    sockets[0]!.raise("open")
    await expect(runner.close()).resolves.toBe("closed")
    expect(sockets[0]!.closes).toBe(1)
    expect(fake.closes).toBe(1)
    expect(sockets[0]!.sent).toEqual([])
    expect(runner.deliver(port().port)).toBe(false)
    expect(sockets).toHaveLength(1)
  })

  it("closes the port of a runner it can't reach, so the page asks again", () => {
    const { runner, sockets } = start()
    const { fake, port: delivered } = port()
    runner.deliver(delivered)
    sockets[0]!.raise("error")
    expect(fake.closes).toBe(1)
  })

  it("says once that the runner is out of reach, and once that it answered", () => {
    const { runner, sockets, events, lines } = start()
    for (const _ of [0, 1, 2]) {
      runner.deliver(port().port)
      sockets.at(-1)!.raise("close")
    }
    expect(events()).toEqual(["remote.unreachable"])
    for (const _ of [0, 1]) {
      runner.deliver(port().port)
      sockets.at(-1)!.raise("open")
    }
    expect(events()).toEqual(["remote.unreachable", "remote.connected"])
    expect(JSON.stringify(lines())).not.toContain(settings.token)
  })

  it("says nothing of a connection that ends after it opened, as when the page closes", () => {
    const { runner, sockets, events } = start()
    runner.deliver(port().port)
    sockets[0]!.raise("open")
    sockets[0]!.raise("close")
    expect(events()).toEqual(["remote.connected"])
  })

  it("has nothing to save as the system session ends", () => {
    const { runner, sockets } = start()
    runner.deliver(port().port)
    runner.persist()
    expect(sockets[0]!.sent).toEqual([])
  })
})
