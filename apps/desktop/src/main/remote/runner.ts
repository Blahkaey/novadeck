import type { Log } from "@novadeck/log"
import type { WebSocketLike } from "@novadeck/wire"
import { tunnelPort } from "@novadeck/wire/electron"
import { WebSocket } from "ws"

import type { RunnerProcess } from "../runner.js"
import type { RemoteSettings } from "./settings.js"

/**
 * A socket to the runner that can be pinged, as `ws`'s can: Node's own WebSocket answers
 * the runner's pings but never sends one, so it can't tell a link that died.
 */
export type RunnerSocket = WebSocketLike & {
  ping(): void
  /** Drops the connection at once, with no closing handshake a dead link would never answer. */
  terminate(): void
  on(type: "pong", listener: () => void): unknown
}

/** A runner on another machine, which the app can tell to connect afresh. */
export type RemoteRunner = RunnerProcess & {
  /**
   * Drops every connection, so the page asks for fresh ones, as after the machine wakes,
   * when a connection can look open while nothing reaches the runner.
   */
  reconnect(): void
}

export type RemoteState = "connecting" | "connected" | "disconnected"

/** How often each connection pings the runner, and how long it waits for the answer. */
export const pingMs = 20_000
export const answerMs = 10_000
/** How long a connection may take to open. */
export const connectMs = 15_000

const openSocket = (url: string): RunnerSocket =>
  new WebSocket(url, { handshakeTimeout: connectMs })

/**
 * Pings the runner once `socket` opens, every `pingMs`, and drops the socket when an answer
 * takes longer than `answerMs`, telling `stalled`; stops as the socket closes.
 */
const watch = (socket: RunnerSocket, stalled: () => void): void => {
  let waiting: ReturnType<typeof setTimeout> | undefined
  let pings: ReturnType<typeof setInterval> | undefined
  const stop = (): void => {
    clearInterval(pings)
    clearTimeout(waiting)
    waiting = undefined
  }
  socket.on("pong", () => {
    clearTimeout(waiting)
    waiting = undefined
  })
  socket.addEventListener("open", () => {
    pings = setInterval(() => {
      waiting ??= setTimeout(() => {
        stop()
        stalled()
        socket.terminate()
      }, answerMs)
      try {
        socket.ping()
      } catch {
        // A socket that can't send is one the wait above ends.
      }
    }, pingMs)
  })
  socket.addEventListener("close", stop)
}

/**
 * A runner on another machine, in the place of the one the app starts: each port the page
 * asks for is carried to the runner's WebSocket, with the runner's token added to its
 * handshake here, so the page never holds it. Each connection pings the runner and is
 * dropped when it stops answering, so the page asks for a fresh one rather than wait on a
 * dead link. The runner is not the app's to stop: closing only disconnects, and its shells
 * run on, for the next launch to find; nor is there anything of its to save as the system
 * session ends.
 */
export const remoteRunner = (options: {
  readonly settings: Pick<RemoteSettings, "url" | "token">
  readonly log: Log
  /** How a socket to the runner is opened: `ws`'s, or a test's stand-in. */
  readonly open?: (url: string) => RunnerSocket
  readonly state?: (state: RemoteState) => void
}): RemoteRunner => {
  const { settings, log, open = openSocket } = options
  // Named in the log by its origin alone: never the token.
  const origin = new URL(settings.url).origin
  const tunnels = new Map<object, { readonly end: () => void; readonly socket?: RunnerSocket }>()
  let closed = false
  let state: RemoteState = "connecting"
  const tell = (next: RemoteState): void => {
    if (state === next) return
    state = next
    options.state?.(next)
  }
  const live = new Set<object>()
  options.state?.(state)
  // Whether the last tunnel reached the runner, so a runner that stays out of reach, which
  // the page asks for again and again, is logged once, and so is its coming back. A stall
  // counts as out of reach, so every connection that stalls with it says it once.
  let reached: boolean | undefined
  const stalled = (): void => {
    if (reached === false) return
    reached = false
    tell("disconnected")
    log.warn("remote.stalled", "The remote runner stopped answering.", { data: { origin } })
  }
  return {
    deliver(port) {
      if (closed) return false
      const key = {}
      // A tunnel with no socket to open ends before it is handed back.
      let over = false
      const tunnel: { end: () => void; socket?: RunnerSocket } = { end: () => {} }
      tunnel.end = tunnelPort(port, {
        open: () => {
          const socket = open(settings.url)
          tunnel.socket = socket
          socket.addEventListener("open", () => {
            live.add(key)
            tell("connected")
            if (reached !== true)
              log.info("remote.connected", "The remote runner answered.", { data: { origin } })
            reached = true
          })
          watch(socket, stalled)
          return socket
        },
        token: settings.token,
        ended: (opened) => {
          over = true
          tunnels.delete(key)
          live.delete(key)
          if (live.size === 0) tell("disconnected")
          if (opened || closed || reached === false) return
          reached = false
          log.warn("remote.unreachable", "The remote runner could not be reached.", {
            data: { origin },
          })
        },
      })
      if (!over) tunnels.set(key, tunnel)
      return true
    },
    reconnect() {
      for (const { end, socket } of tunnels.values()) {
        socket?.terminate()
        end()
      }
      tell("connecting")
    },
    persist() {},
    close() {
      closed = true
      for (const { end } of tunnels.values()) end()
      return Promise.resolve("closed")
    },
  }
}
