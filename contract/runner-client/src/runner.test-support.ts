import { contract, protocolVersion } from "@novadeck/protocol"
import type { MessagePortLike } from "@novadeck/wire"
import { messagePort } from "@novadeck/wire/client"
import { memoryPorts } from "@novadeck/wire/testing"
import { implement } from "@orpc/server"
import { RPCHandler } from "@orpc/server/message-port"
import { onTestFinished } from "vitest"

import { connectRunner, type Runner } from "./runner.js"

/** Builds handlers for the contract's procedures, as a runner's router has them. */
export const api = implement(contract)

type Router = Record<string, unknown>

/**
 * A runner that serves `router` (beside the handshake) to a client over ports held in memory,
 * one pair per connection. A test cuts the link with `drop()`, and the client reconnects; with
 * `restart()`, to a runner of a new lifetime.
 */
export const fakeRunner = async (router: Router) => {
  let epoch = crypto.randomUUID()
  const links: MessagePortLike[] = []
  const handshake = {
    wire: {
      handshake: api.wire.handshake.handler(() => ({ epoch, protocolVersion })),
    },
  }
  const handler = new RPCHandler({ ...router, ...handshake } as never)
  const transport = messagePort(async () => {
    const [served, own] = memoryPorts()
    handler.upgrade(served as never, { context: {} })
    links.push(served)
    return own
  })
  const runner: Runner = await connectRunner(transport, { retryDelay: () => 10 })
  onTestFinished(() => runner.close())
  return {
    runner,
    /** Sends the client `data` on the live link, as if the runner had. */
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- A port, not a window.
    send: (data: unknown) => links.at(-1)?.postMessage(data),
    /** Cuts the live link; the client reconnects to the same runner. */
    drop: () => links.at(-1)?.close(),
    /** Cuts the live link as the runner restarts; the client reconnects in its new epoch. */
    restart: () => {
      epoch = crypto.randomUUID()
      links.at(-1)?.close()
    },
    /** The runner's lifetime now. */
    epoch: () => epoch,
  }
}
