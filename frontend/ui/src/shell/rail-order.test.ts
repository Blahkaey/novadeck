import { context, describe, expect, it } from "../test"
import { movedPanel, railOrder } from "./rail-order"

describe("the rail's order", () => {
  it("is the rail's own until the person moves a panel", () => {
    expect(railOrder([])).toEqual([
      "terminals",
      "inbox",
      "worktrees",
      "files",
      "notes",
      "todo",
      "history",
    ])
  })

  it("keeps the panels the person placed, then any never placed, in the rail's order", () => {
    expect(railOrder(["inbox", "terminals"])).toEqual([
      "inbox",
      "terminals",
      "worktrees",
      "files",
      "notes",
      "todo",
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
      "todo",
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
      "todo",
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
        "todo",
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
        "todo",
        "history",
      ])
    })

    it("keeps an order saved under the rail's former default as it was, Notes after it", () => {
      expect(
        railOrder(["terminals", "files", "sessions", "history", "inbox", "worktrees"]),
      ).toEqual(["terminals", "files", "history", "inbox", "worktrees", "notes", "todo"])
    })
  })

  context("with an order saved before Todo had a toggle of its own", () => {
    it("puts Todo just after Notes where the person placed Notes", () => {
      expect(railOrder(["notes", "inbox", "terminals", "files", "worktrees", "history"])).toEqual([
        "notes",
        "todo",
        "inbox",
        "terminals",
        "files",
        "worktrees",
        "history",
      ])
    })

    it("appends Todo with the other new panels where Notes was never placed", () => {
      expect(railOrder(["history", "inbox"])).toEqual([
        "history",
        "inbox",
        "terminals",
        "worktrees",
        "files",
        "notes",
        "todo",
      ])
    })

    it("keeps Todo where the person placed it, once they have", () => {
      expect(railOrder(["todo", "inbox", "notes"])).toEqual([
        "todo",
        "inbox",
        "notes",
        "terminals",
        "worktrees",
        "files",
        "history",
      ])
    })
  })

  it("reads a panel stored under its former id in its place", () => {
    expect(railOrder(["inbox", "changes", "terminals", "source"])).toEqual([
      "inbox",
      "worktrees",
      "terminals",
      "files",
      "notes",
      "todo",
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
      "todo",
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
      "todo",
      "history",
    ])
    expect(movedPanel(order, order, 0, 2)).toEqual([
      "inbox",
      "worktrees",
      "terminals",
      "files",
      "notes",
      "todo",
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
      "todo",
      "history",
    ])
  })
})
