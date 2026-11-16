import type { MessagePortMain } from "electron"
import { afterEach, beforeEach, vi } from "vitest"

import { context, describe, expect, it } from "../../test"
import { appLog } from "../logs/logs.test-support"
import { answerMs, pingMs, remoteRunner, type RemoteState, type RunnerSocket } from "./runner"

const settings = {
  url: "ws://127.0.0.1:8787/api/rpc",
  token: "desktop-tests-only-not-a-production-credential",
}

type Kind = "open" | "close" | "error" | "message"

/**
 * A socket as the runner's host opens one: what it was sent, and its events for the test to
 * raise. It answers each ping while `answering`, as a live runner does.
 */
class FakeSocket implements RunnerSocket {
  readonly sent: unknown[] = []
  readonly listeners: { kind: Kind; listener: (event: { data: unknown }) => void }[] = []
  readonly pongs: (() => void)[] = []
  binaryType = "blob"
  readyState = 0
  closes = 0
  pings = 0
  terminations = 0
  answering = true
  constructor(readonly url: string) {}
  send(data: unknown): void {
    this.sent.push(data)
  }
  close(): void {
    this.closes += 1
  }
  ping(): void {
    this.pings += 1
    if (this.answering) for (const pong of this.pongs) pong()
  }
  terminate(): void {
    this.terminations += 1
    this.raise("close")
  }
  on(_type: "pong", listener: () => void): this {
    this.pongs.push(listener)
    return this
  }
  addEventListener(kind: Kind, listener: (event: { data: unknown }) => void): void {
    this.listeners.push({ kind, listener })
  }
  raise(kind: Kind, data?: unknown): void {
    if (kind === "open") this.readyState = 1
    if (kind === "close") this.readyState = 3
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
  const states: RemoteState[] = []
  const { logger, lines } = appLog()
  const runner = remoteRunner({
    settings,
    log: logger.for("remote"),
    state: (state) => states.push(state),
    open: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
  })
  const events = () => lines().map((line) => line.evt)
  return { runner, sockets, lines, events, states }
}

describe("remoteRunner", () => {
  it("reports the connection state while any window still has an open connection", () => {
    const { runner, sockets, states } = start()
    runner.deliver(port().port)
    runner.deliver(port().port)
    sockets[0]!.raise("open")
    sockets[1]!.raise("open")
    sockets[0]!.raise("close")
    expect(states).toEqual(["connecting", "connected"])
    sockets[1]!.raise("close")
    expect(states).toEqual(["connecting", "connected", "disconnected"])
    runner.reconnect()
    expect(states.at(-1)).toBe("connecting")
  })
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

  context("while a connection is open", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it("keeps it while the runner answers its pings", () => {
      const { runner, sockets, events } = start()
      const { fake, port: delivered } = port()
      runner.deliver(delivered)
      sockets[0]!.raise("open")

      vi.advanceTimersByTime(pingMs * 5 + answerMs)

      expect(sockets[0]!.pings).toBe(5)
      expect(sockets[0]!.terminations).toBe(0)
      expect(fake.closes).toBe(0)
      expect(events()).toEqual(["remote.connected"])
    })

    it("drops it, and closes the page's port, when a ping goes unanswered", () => {
      const { runner, sockets } = start()
      const { fake, port: delivered } = port()
      runner.deliver(delivered)
      sockets[0]!.raise("open")
      sockets[0]!.answering = false

      vi.advanceTimersByTime(pingMs + answerMs - 1)
      expect(sockets[0]!.terminations).toBe(0)
      expect(fake.closes).toBe(0)

      vi.advanceTimersByTime(1)
      expect(sockets[0]!.terminations).toBe(1)
      expect(fake.closes).toBe(1)
    })

    it("pings nothing before it opens or after it closes", () => {
      const { runner, sockets } = start()
      runner.deliver(port().port)
      vi.advanceTimersByTime(pingMs * 2)
      expect(sockets[0]!.pings).toBe(0)

      sockets[0]!.raise("open")
      sockets[0]!.raise("close")
      vi.advanceTimersByTime(pingMs * 2)
      expect(sockets[0]!.pings).toBe(0)
    })

    it("says once that the runner stopped answering, by its origin alone, and once that it answered again", () => {
      const { runner, sockets, events, lines } = start()
      runner.deliver(port().port)
      runner.deliver(port().port)
      for (const socket of sockets) {
        socket.raise("open")
        socket.answering = false
      }

      vi.advanceTimersByTime(pingMs + answerMs)
      // The page asks again while the runner is still out of reach.
      runner.deliver(port().port)
      sockets.at(-1)!.raise("close")
      expect(events()).toEqual(["remote.connected", "remote.stalled"])
      expect(lines().at(-1)).toMatchObject({ data: { origin: "ws://127.0.0.1:8787" } })

      runner.deliver(port().port)
      sockets.at(-1)!.raise("open")
      expect(events()).toEqual(["remote.connected", "remote.stalled", "remote.connected"])
      expect(JSON.stringify(lines())).not.toContain(settings.token)
    })
  })

  it("drops every connection when told to connect afresh, and serves the ports asked for next", () => {
    const { runner, sockets } = start()
    const ports = [port(), port()]
    for (const { port: delivered } of ports) runner.deliver(delivered)
    sockets[0]!.raise("open")

    runner.reconnect()

    expect(sockets.map((socket) => socket.terminations)).toEqual([1, 1])
    expect(ports.map(({ fake }) => fake.closes)).toEqual([1, 1])
    expect(runner.deliver(port().port)).toBe(true)
    expect(sockets).toHaveLength(3)
    runner.reconnect()
    expect(sockets[2]!.terminations).toBe(1)
  })

  it("has nothing to save as the system session ends", () => {
    const { runner, sockets } = start()
    runner.deliver(port().port)
    runner.persist()
    expect(sockets[0]!.sent).toEqual([])
  })
})
