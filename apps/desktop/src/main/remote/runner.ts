import type { Log } from "@novadeck/log"
import type { WebSocketLike } from "@novadeck/wire"
import { tunnelPort } from "@novadeck/wire/electron"

import type { RunnerProcess } from "../runner.js"
import type { RemoteSettings } from "./settings.js"

/**
 * A runner on another machine, in the place of the one the app starts: each port the page
 * asks for is carried to the runner's WebSocket, with the runner's token added to its
 * handshake here, so the page never holds it. The runner is not the app's to stop: closing
 * only disconnects, and its shells run on, for the next launch to find; nor is there
 * anything of its to save as the system session ends.
 */
export const remoteRunner = (options: {
  readonly settings: Pick<RemoteSettings, "url" | "token">
  readonly log: Log
  /** How a socket to the runner is opened: Node's `WebSocket`, or a test's stand-in. */
  readonly open?: (url: string) => WebSocketLike
}): RunnerProcess => {
  const { settings, log, open = (url) => new WebSocket(url) as unknown as WebSocketLike } = options
  // Named in the log by its origin alone: never the token.
  const origin = new URL(settings.url).origin
  const tunnels = new Map<object, () => void>()
  let closed = false
  // Whether the last tunnel reached the runner, so a runner that stays out of reach, which
  // the page asks for again and again, is logged once, and so is its coming back.
  let reached: boolean | undefined
  return {
    deliver(port) {
      if (closed) return false
      const key = {}
      // A tunnel with no socket to open ends before it is handed back.
      let over = false
      const end = tunnelPort(port, {
        open: () => {
          const socket = open(settings.url)
          socket.addEventListener("open", () => {
            if (reached !== true)
              log.info("remote.connected", "The remote runner answered.", { data: { origin } })
            reached = true
          })
          return socket
        },
        token: settings.token,
        ended: (opened) => {
          over = true
          tunnels.delete(key)
          if (opened || closed || reached === false) return
          reached = false
          log.warn("remote.unreachable", "The remote runner could not be reached.", {
            data: { origin },
          })
        },
      })
      if (!over) tunnels.set(key, end)
      return true
    },
    persist() {},
    close() {
      closed = true
      for (const end of tunnels.values()) end()
      return Promise.resolve("closed")
    },
  }
}
