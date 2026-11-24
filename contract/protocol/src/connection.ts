/**
 * The largest incoming WebSocket message a runner accepts; every call must fit in one. A
 * look's picture never comes this way: only the desktop app takes them, over its port.
 */
export const maxWebSocketMessageBytes = 256 * 1024

// Room for the request around a text in its WebSocket message.
const envelopeBytes = 8 * 1024

/**
 * Whether the runner takes `text` in one call: within `limit`, its own length limit for it, and,
 * JSON-escaped inside the request, within one WebSocket message, past which the socket closes
 * the whole link. The runner offers a file whole to be edited only where its text fits so.
 */
export const fitsRunner = (text: string, limit: number): boolean =>
  text.length <= limit &&
  new TextEncoder().encode(JSON.stringify(text)).length <= maxWebSocketMessageBytes - envelopeBytes
