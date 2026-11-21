import { itemIdOf } from "./items"
import {
  addPanel,
  addWindow,
  createRoster,
  hasTile,
  isPanel,
  isTerminal,
  isWindow,
  keepFoldsTogether,
  listFirst,
  orderBefore,
  orderedIds,
  panelTile,
  removePanel,
  reorderTerminals,
  setTerminalProcess,
  setTerminalStatus,
  tileName,
  tileOf,
} from "./roster"
import { context, describe, expect, it } from "./test"
import { terminalFixture } from "./testing"
import type { CompanionWindowMeta, TerminalMetadata, TerminalStatus } from "./types"

// Every field of a terminal that no status carries: what it is, beside what it is doing.
type KeysOf<T> = T extends unknown ? keyof T : never
type IdentityKey = Exclude<KeysOf<TerminalMetadata>, KeysOf<TerminalStatus> | "itemId">

describe("a terminal's status", () => {
  it("keeps every field that is not the status's own", () => {
    // Naming every identity field: one added to `TerminalMetadata` fails to typecheck here
    // until it is set, and then fails below until a status change keeps it.
    const identity = {
      id: "01",
      name: "Terminal 1",
      directory: "/work/app",
      command: "bash",
      process: "bash",
      argv: ["bash", "build.sh"],
      restoredProcess: "claude",
      handle: "moth",
      handleGivenAt: 1_700_000_000_000,
      ledBy: "id-fox",
      openedBy: "id-owl",
      agentRan: true,
      restorable: true,
      busy: true,
      titleSource: { kind: "agent", by: "fox" },
    } satisfies Required<Pick<TerminalMetadata, IdentityKey>>
    const roster = createRoster([
      {
        ...identity,
        state: "exited",
        exitCode: 1,
        signal: null,
        cause: "out-of-memory",
      },
    ])

    const [terminal] = setTerminalStatus(roster, "01", {
      state: "starting",
    }).terminals
    expect(terminal).toEqual({ ...identity, state: "starting" })
  })

  it("names the agent a sleeper resumes once it wakes, and clears it once a shell reports", () => {
    const roster = createRoster([
      { id: "01", name: "Checkout", directory: "/work", command: "", process: "", state: "idle" },
    ])
    const asleep = setTerminalStatus(roster, "01", { state: "sleeping", agent: "claude" })
    expect(asleep.terminals[0]).toMatchObject({ state: "sleeping", agent: "claude" })
    const waking = setTerminalStatus(asleep, "01", { state: "starting" })
    expect(waking.terminals[0]).toMatchObject({ state: "starting", restoredProcess: "claude" })
    const awake = setTerminalStatus(waking, "01", { state: "idle" })
    expect(awake.terminals[0]).not.toHaveProperty("restoredProcess")
  })

  it("takes a program's command line with it, and drops it with the program", () => {
    const roster = createRoster([
      { id: "01", name: "Dev", directory: "/work", command: "", process: "zsh", state: "idle" },
    ])
    const running = setTerminalProcess(roster, "01", "node", ["node", "pnpm.cjs", "dev"])
    expect(running.terminals[0]).toMatchObject({
      process: "node",
      argv: ["node", "pnpm.cjs", "dev"],
    })
    expect(setTerminalProcess(running, "01", "node", ["node", "pnpm.cjs", "dev"])).toBe(running)
    const back = setTerminalProcess(running, "01", "zsh")
    expect(back.terminals[0]).not.toHaveProperty("argv")
  })
})

describe("a tile looked up by id", () => {
  const roster = {
    ...createRoster([
      { id: "01", name: "Checkout", directory: "/work", command: "", process: "", state: "idle" },
      { id: "02", name: "Dev", directory: "/work", command: "", process: "", state: "idle" },
    ]),
    order: ["02", "01"],
  }

  it("finds the tile, and nothing once it is gone", () => {
    expect(tileOf(roster, "02")).toMatchObject({ name: "Dev" })
    expect(tileOf(roster, "03")).toBeUndefined()
  })

  it("lists the ids in sidebar order, the same list while the roster is the same", () => {
    expect(orderedIds(roster)).toEqual(["02", "01"])
    expect(orderedIds(roster)).toBe(orderedIds(roster))
  })
})

describe("where a tile dropped between two others goes", () => {
  const order = ["a", "b", "c"]

  it("sits just before the tile it was dropped on, wherever it was", () => {
    expect(orderBefore(order, "x", "b")).toEqual(["a", "x", "b", "c"])
    expect(orderBefore(order, "c", "a")).toEqual(["c", "a", "b"])
    expect(orderBefore(order, "a", "c")).toEqual(["b", "a", "c"])
  })

  it("goes last when nothing follows it, or the tile it names is gone", () => {
    expect(orderBefore(order, "x", null)).toEqual(["a", "b", "c", "x"])
    expect(orderBefore(order, "a", null)).toEqual(["b", "c", "a"])
    expect(orderBefore(order, "x", "gone")).toEqual(["a", "b", "c", "x"])
    expect(orderBefore(order, "b", "b")).toEqual(order)
  })
})

describe("a drag past a folded lead", () => {
  const folds = [{ lead: "L", hidden: ["a", "b"] }]

  it("takes its hidden team along when the lead is dragged away", () => {
    expect(keepFoldsTogether(["a", "b", "X", "L"], folds)).toEqual(["X", "L", "a", "b"])
  })

  it("keeps a tab dropped on the lead out of its hidden team", () => {
    expect(keepFoldsTogether(["L", "X", "a", "b"], folds)).toEqual(["L", "a", "b", "X"])
  })

  it("leaves an order with nothing folded as it is", () => {
    expect(keepFoldsTogether(["X", "L", "a"], [])).toEqual(["X", "L", "a"])
  })
})

describe("a panel opened on the stage", () => {
  const window: CompanionWindowMeta = {
    id: "w1",
    home: "undocked",
    itemId: itemIdOf("hero"),
    name: "hero.png",
    titleSource: { kind: "default" },
  }
  const notes = panelTile("notes")
  const roster = addPanel(
    addWindow(createRoster([terminalFixture(1, "~/one"), terminalFixture(2, "~/one")]), window),
    notes,
  )

  it("is its panel's one tile, by an id no terminal's or window's can be", () => {
    expect(notes).toEqual({ id: "panel:notes", panel: "notes" })
    expect(panelTile("notes")).toEqual(notes)
  })

  it("is neither a terminal nor a companion window, and goes by its panel's name", () => {
    expect([isPanel(notes), isTerminal(notes), isWindow(notes)]).toEqual([true, false, false])
    expect([isPanel(window), isTerminal(window)]).toEqual([false, false])
    expect(isTerminal(roster.terminals[0]!)).toBe(true)
    expect(tileName(notes)).toBe("Notes")
    expect(tileName(window)).toBe("hero.png")
  })

  it("is laid out after the terminals and windows the order doesn't place", () => {
    expect(hasTile(roster, "panel:notes")).toBe(true)
    expect(tileOf(roster, "panel:notes")).toBe(notes)
    expect(orderedIds(roster)).toEqual(["01", "02", "w1", "panel:notes"])
  })

  it("keeps the place the person gave it", () => {
    const moved = reorderTerminals(roster, ["panel:notes", "02", "01"])
    expect(orderedIds(moved)).toEqual(["panel:notes", "02", "01", "w1"])
  })

  context("when a terminal is listed first", () => {
    it("still follows the terminals while the person hasn't placed it", () => {
      expect(orderedIds(listFirst(roster, "02"))).toEqual(["02", "01", "w1", "panel:notes"])
    })

    it("keeps its place once they have", () => {
      const placed = reorderTerminals(roster, ["panel:notes", "01", "02"])
      expect(orderedIds(listFirst(placed, "02"))).toEqual(["02", "panel:notes", "01", "w1"])
    })
  })

  it("leaves the roster and its order once removed", () => {
    const removed = removePanel(reorderTerminals(roster, ["panel:notes", "01"]), "panel:notes")
    expect(removed.panels).toEqual([])
    expect(removed.order).toEqual(["01"])
    expect(removePanel(removed, "panel:notes")).toBe(removed)
  })
})
