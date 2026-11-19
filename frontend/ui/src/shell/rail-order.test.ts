import { context, describe, expect, it } from "../test"
import { movedPanel, railOrder } from "./rail-order"

describe("the rail's order", () => {
  it("is the rail's own until the person moves a panel", () => {
    expect(railOrder([])).toEqual(["terminals", "inbox", "worktrees", "files", "notes", "history"])
  })

  it("keeps the panels the person placed, then any never placed, in the rail's order", () => {
    expect(railOrder(["inbox", "terminals"])).toEqual([
      "inbox",
      "terminals",
      "worktrees",
      "files",
      "notes",
      "history",
    ])
  })

  it("drops what isn't a panel, or is one twice", () => {
    expect(railOrder(["inbox", "gone", "inbox", "files"])).toEqual([
      "inbox",
      "files",
      "terminals",
      "worktrees",
      "notes",
      "history",
    ])
  })

  it("puts the panels newer than a person's saved order after the ones they placed", () => {
    expect(railOrder(["inbox", "files", "terminals"])).toEqual([
      "inbox",
      "files",
      "terminals",
      "worktrees",
      "notes",
      "history",
    ])
  })

  context("with an order saved while Sessions had a toggle of its own", () => {
    it("keeps Terminals where the person placed it, and Sessions' place goes", () => {
      expect(railOrder(["inbox", "sessions", "files", "terminals"])).toEqual([
        "inbox",
        "files",
        "terminals",
        "worktrees",
        "notes",
        "history",
      ])
    })

    it("puts Terminals in Sessions' place where only Sessions was placed", () => {
      expect(railOrder(["inbox", "sessions", "files"])).toEqual([
        "inbox",
        "terminals",
        "files",
        "worktrees",
        "notes",
        "history",
      ])
    })

    it("keeps an order saved under the rail's former default as it was, Notes after it", () => {
      expect(
        railOrder(["terminals", "files", "sessions", "history", "inbox", "worktrees"]),
      ).toEqual(["terminals", "files", "history", "inbox", "worktrees", "notes"])
    })
  })

  it("reads a panel stored under its former id in its place", () => {
    expect(railOrder(["inbox", "changes", "terminals", "source"])).toEqual([
      "inbox",
      "worktrees",
      "terminals",
      "files",
      "notes",
      "history",
    ])
  })

  it("keeps a panel stored under both its ids once, where it first stands", () => {
    expect(railOrder(["source", "inbox", "files"])).toEqual([
      "files",
      "inbox",
      "terminals",
      "worktrees",
      "notes",
      "history",
    ])
  })

  it("moves a panel among those shown", () => {
    const order = railOrder([])
    expect(movedPanel(order, order, 3, 0)).toEqual([
      "files",
      "terminals",
      "inbox",
      "worktrees",
      "notes",
      "history",
    ])
    expect(movedPanel(order, order, 0, 2)).toEqual([
      "inbox",
      "worktrees",
      "terminals",
      "files",
      "notes",
      "history",
    ])
  })

  it("leaves a panel the backend doesn't show where it was", () => {
    const order = railOrder([])
    const shown = order.filter((panel) => panel !== "files" && panel !== "history")
    expect(movedPanel(order, shown, 2, 0)).toEqual([
      "worktrees",
      "terminals",
      "inbox",
      "files",
      "notes",
      "history",
    ])
  })
})
