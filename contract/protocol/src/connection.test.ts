import { describe, expect, it } from "vitest"

import { fitsRunner, maxWebSocketMessageBytes } from "./connection.js"

describe("a text the runner takes in one call", () => {
  it("is within its own limit and, JSON-escaped, within one WebSocket message", () => {
    expect(fitsRunner("x".repeat(100), 100)).toBe(true)
    expect(fitsRunner("x".repeat(101), 100)).toBe(false)
    // Within the limit, but past a message once each quote is escaped.
    const quoted = '"'.repeat(maxWebSocketMessageBytes / 2)
    expect(fitsRunner(quoted, maxWebSocketMessageBytes)).toBe(false)
    expect(fitsRunner("x".repeat(maxWebSocketMessageBytes / 2), maxWebSocketMessageBytes)).toBe(
      true,
    )
  })

  it("counts the bytes a character takes, not its units", () => {
    const wide = "ż".repeat(maxWebSocketMessageBytes / 2)
    expect(wide.length).toBeLessThanOrEqual(maxWebSocketMessageBytes)
    expect(fitsRunner(wide, maxWebSocketMessageBytes)).toBe(false)
  })
})
