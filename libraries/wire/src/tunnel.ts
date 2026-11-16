import { decodeRequestMessage, encodeRequestMessage, MessageType } from "@orpc/standard-server-peer"

import type { MessagePortLike, WebSocketLike } from "./channel.js"

/** A port as Electron's main process holds one, a `MessagePortMain`: an emitter, not an event target. */
export type MainPortLike = {
  postMessage(message: unknown): void
  start(): void
  close(): void
  on(type: "message", listener: (event: { data: unknown }) => void): unknown
  on(type: "close", listener: () => void): unknown
}

type Message = string | Uint8Array<ArrayBuffer>

const listen = (
  port: MessagePortLike | MainPortLike,
  message: (data: unknown) => void,
  close: () => void,
): void => {
  if ("on" in port) {
    port.on("message", (event) => message(event.data))
    port.on("close", close)
    return
  }
  port.addEventListener("message", (event) => message(event.data))
  port.addEventListener("close", close)
}

// A message as a client's channel sends one, or undefined for anything else.
const messageOf = (data: unknown): Message | undefined => {
  if (typeof data === "string") return data
  if (data instanceof Uint8Array) return Uint8Array.from(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * A client's handshake with `token` added to it, as the server of a WebSocket asks; any
 * other message, or one that can't be read, as it came.
 */
export const withToken = async (message: Message, token: string): Promise<Message> => {
  try {
    const [id, type, request] = await decodeRequestMessage(message)
    if (type !== MessageType.REQUEST) return message
    if (!request.url.pathname.endsWith("/wire/handshake")) return message
    const body: unknown = request.body
    if (!isRecord(body) || !isRecord(body.json)) return message
    const encoded = await encodeRequestMessage(id, type, {
      ...request,
      body: { ...body, json: { ...body.json, token } },
    })
    return messageOf(encoded) ?? message
  } catch {
    return message
  }
}

/**
 * Carries a trusted port's client to a server reached over a WebSocket, as the page of a
 * desktop app whose service runs on another machine: whoever holds the port is given the
 * server's `token`, which is added to the handshake that opens the connection and never
 * reaches the client. Each port gets a socket of its own from `open`. What the client sends
 * before the socket is open waits for it, in order. Either end closing closes the other, so
 * a client that reconnects asks for a fresh port; `ended` then hears whether the socket had
 * opened. Returns a function that ends the tunnel.
 */
export const tunnelPort = (
  port: MessagePortLike | MainPortLike,
  options: {
    readonly open: () => WebSocketLike
    readonly token: string
    readonly ended?: (opened: boolean) => void
  },
): (() => void) => {
  let over = false
  let opened = false
  let socket: WebSocketLike | undefined
  const end = (): void => {
    if (over) return
    over = true
    socket?.close()
    port.close()
    options.ended?.(opened)
  }
  try {
    socket = options.open()
  } catch {
    end()
    return end
  }
  const live = socket
  live.binaryType = "arraybuffer"
  const ready = new Promise<void>((resolve) => {
    live.addEventListener("open", () => {
      opened = true
      resolve()
    })
  })
  // The handshake is the first message of every connection.
  let first = true
  let sent = ready
  listen(
    port,
    (data) => {
      const handshake = first
      first = false
      sent = sent
        .then(async () => {
          if (over) return
          const message = messageOf(data)
          // A client that sends anything else is not one of the wire's.
          if (message === undefined) return end()
          live.send(handshake ? await withToken(message, options.token) : message)
        })
        .catch(end)
    },
    end,
  )
  live.addEventListener("message", (event) => {
    if (over) return
    try {
      port.postMessage(event.data)
    } catch {
      end()
    }
  })
  live.addEventListener("close", end)
  live.addEventListener("error", end)
  port.start?.()
  return end
}
