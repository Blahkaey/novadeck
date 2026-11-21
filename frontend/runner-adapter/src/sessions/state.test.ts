import { messagesKey } from "@novadeck/core/items/companion-bar"
import { addPanel, orderedIds, panelTile } from "@novadeck/core/roster"
import { workspaceFromSeed, type RestoredView } from "@novadeck/core/seed"
import { createTerminalState } from "@novadeck/core/state"
import { itemFixture, terminalFixture } from "@novadeck/core/testing"
import type { WorkspaceSession } from "@novadeck/core/types"

import { context, describe, expect, it } from "../test"
import { decodeSession, encodeSession } from "./state"

const session = (): WorkspaceSession => {
  const state = createTerminalState(
    [terminalFixture(1, "~/one"), { ...terminalFixture(2, "~/one"), state: "running" }],
    "canvas",
    "canvas",
    {
      canvasLayout: {
        geometry: {
          "01": { position: { x: 10, y: 20 }, width: 400, height: 300, dragging: true },
        },
      },
    },
  )
  return {
    id: "session",
    name: "Session",
    visitedAt: 1_234,
    state: { ...state, roster: { ...state.roster, order: ["02", "01"] }, selected: "02" },
  }
}

describe("saved session state", () => {
  context("after a round trip", () => {
    const saved = decodeSession(encodeSession(session()))

    it("keeps order, layouts, view and selection", () => {
      expect(saved).toMatchObject({
        state: { order: ["02", "01"], view: "canvas", windowedView: "canvas", selected: "02" },
      })
    })

    it("leaves out the camera an older build saved", () => {
      const before = session()
      const canvas = { ...before.state.layout.canvas, viewport: { x: 1, y: 2, zoom: 0.5 } }
      const layout = { ...before.state.layout, canvas }
      const text = encodeSession({ ...before, state: { ...before.state, layout } })
      expect(text).not.toContain("viewport")
    })

    it("leaves out the terminals, which the runner keeps, and gestures in progress", () => {
      const text = encodeSession(session())
      expect(text).not.toContain("Terminal")
      expect(text).not.toContain("~/one")
      expect(JSON.parse(text).state).not.toHaveProperty("roster")
      expect(JSON.parse(text)).toMatchObject({ version: 2 })
      expect(JSON.parse(text)).not.toHaveProperty("visitedAt")
      expect(JSON.parse(text)).not.toHaveProperty("rank")
      expect(saved?.state.layout.canvas.geometry["01"]).toEqual({
        position: { x: 10, y: 20 },
        width: 400,
        height: 300,
      })
    })
  })

  context("when an older build reads what this one saved", () => {
    // What that build's decoder asks of a layout, from before Grid took its own: each of these
    // keys an object, the canvas has `geometry` and the size presets `grid`. Without them it
    // drops the whole view.
    const readable = (layout: Record<string, unknown>): boolean => {
      const isObject = (value: unknown): value is Record<string, unknown> =>
        typeof value === "object" && value !== null && !Array.isArray(value)
      const keys = ["canvas", "grid", "gridRestoreWidths", "sizePresets", "hidden"]
      return (
        keys.every((key) => isObject(layout[key])) &&
        isObject((layout.canvas as Record<string, unknown>).geometry) &&
        isObject((layout.sizePresets as Record<string, unknown>).grid)
      )
    }

    it("finds the layout keys it needs, empty", () => {
      const { layout } = (JSON.parse(encodeSession(session())) as { state: { layout: never } })
        .state
      expect(readable(layout)).toBe(true)
      expect(layout).toMatchObject({ grid: {}, gridRestoreWidths: {}, sizePresets: { grid: {} } })
    })

    it("is still read by this build, and its own decoder asks for no more than it saved", () => {
      expect(decodeSession(encodeSession(session()))).toBeDefined()
    })
  })

  context("when it was saved by a build that kept Grid's cells and widths", () => {
    const old = (): string => {
      const current = JSON.parse(encodeSession(session())) as {
        state: { layout: Record<string, unknown> }
      }
      current.state.layout = {
        ...current.state.layout,
        grid: { desktop: [{ i: "01", x: 4, y: 0, w: 4, h: 18, minW: 4, minH: 10 }] },
        gridRestoreWidths: { "01": { desktop: 4 } },
        sizePresets: { grid: { "01": "large" } },
      }
      return JSON.stringify(current)
    }

    it("reads it, and carries on none of what Grid took from the sidebar", () => {
      const saved = decodeSession(old())
      expect(saved?.state).toMatchObject({ order: ["02", "01"], selected: "02" })
      expect(Object.keys(saved!.state.layout).toSorted()).toEqual(["canvas", "hidden", "spans"])
      expect(saved?.state.layout.spans).toEqual({})
      expect(saved?.state.layout.canvas.geometry["01"]?.position).toEqual({ x: 10, y: 20 })
      // What it wrote of them is empty, so none of the old cells comes back.
      const again = JSON.parse(
        encodeSession({ ...session(), state: { ...session().state, layout: saved!.state.layout } }),
      ) as { state: { layout: Record<string, unknown> } }
      expect(again.state.layout).toMatchObject({ grid: {}, sizePresets: { grid: {} } })
    })
  })

  context("with tiles sized to span several of Grid's cells", () => {
    const sized = (spans: Record<string, unknown>): string => {
      const current = JSON.parse(encodeSession(session())) as {
        state: { layout: Record<string, unknown> }
      }
      current.state.layout = { ...current.state.layout, spans }
      return JSON.stringify(current)
    }

    it("keeps each tile's span through a save", () => {
      const before = session()
      const layout = { ...before.state.layout, spans: { "01": { columns: 2, rows: 2 } } }
      const saved = decodeSession(encodeSession({ ...before, state: { ...before.state, layout } }))
      expect(saved?.state.layout.spans).toEqual({ "01": { columns: 2, rows: 2 } })
    })

    it("reads a save from before tiles had spans as none", () => {
      const current = JSON.parse(encodeSession(session())) as {
        state: { layout: Record<string, unknown> }
      }
      delete current.state.layout.spans
      expect(decodeSession(JSON.stringify(current))?.state.layout.spans).toEqual({})
    })

    it("leaves out a span that isn't whole cells, and holds one too tall to three", () => {
      const saved = decodeSession(
        sized({
          "01": { columns: 2, rows: 9 },
          "02": { columns: 0, rows: 1 },
          "03": { columns: 1.5, rows: 1 },
          "04": "wide",
        }),
      )
      expect(saved?.state.layout.spans).toEqual({ "01": { columns: 2, rows: 3 } })
    })
  })

  context("with panels open on the stage", () => {
    // The session with Notes and Todo open among its terminals, Notes selected, sized and
    // placed on the canvas.
    const withPanels = (): WorkspaceSession => {
      const base = session()
      const roster = addPanel(addPanel(base.state.roster, panelTile("notes")), panelTile("todo"))
      const layout = {
        ...base.state.layout,
        canvas: {
          geometry: {
            ...base.state.layout.canvas.geometry,
            "panel:notes": { position: { x: 30, y: 40 }, width: 320, height: 480 },
          },
        },
        spans: { "panel:notes": { columns: 2, rows: 1 } },
        hidden: { "panel:todo": true },
      }
      return {
        ...base,
        state: {
          ...base.state,
          roster: { ...roster, order: ["02", "panel:notes", "01", "panel:todo"] },
          layout,
          selected: "panel:notes",
        },
      }
    }
    // A saved state with `panels` as given in place of what this build wrote.
    const savedWith = (panels: unknown): string => {
      const current = JSON.parse(encodeSession(withPanels())) as { state: Record<string, unknown> }
      current.state.panels = panels
      return JSON.stringify(current)
    }
    const restore = (view: RestoredView) =>
      workspaceFromSeed(
        {
          projects: [
            {
              id: "project",
              name: "Project",
              directory: "~/one",
              sessions: [
                {
                  id: "session",
                  name: "Session",
                  items: [],
                  windows: [],
                  terminals: session().state.roster.terminals,
                  restored: view,
                },
              ],
            },
          ],
        },
        { view: "focus", windowedView: "grid", now: 0 },
      ).projects[0]!.history[0]!.state

    it("saves them by name", () => {
      expect(JSON.parse(encodeSession(withPanels())).state.panels).toEqual(["notes", "todo"])
    })

    it("saves a session without them as it did before they could open there", () => {
      const state = JSON.parse(encodeSession(session())).state as Record<string, unknown>
      expect(Object.keys(state)).toEqual([
        "order",
        "layout",
        "view",
        "windowedView",
        "selected",
        "bars",
      ])
    })

    it("opens them again with their places, layout and the selection", () => {
      const saved = decodeSession(encodeSession(withPanels()))
      expect(saved?.state.panels).toEqual(["notes", "todo"])
      const state = restore(saved!.state)
      expect(state.roster.panels).toEqual([panelTile("notes"), panelTile("todo")])
      expect(orderedIds(state.roster)).toEqual(["02", "panel:notes", "01", "panel:todo"])
      expect(state.selected).toBe("panel:notes")
      expect(state.layout.spans).toEqual({ "panel:notes": { columns: 2, rows: 1 } })
      expect(state.layout.hidden).toEqual({ "panel:todo": true })
      expect(state.layout.canvas.geometry["panel:notes"]).toEqual({
        position: { x: 30, y: 40 },
        width: 320,
        height: 480,
      })
    })

    it("reads a save from before panels could open there as none", () => {
      const saved = decodeSession(encodeSession(session()))
      expect(saved?.state.panels).toEqual([])
      expect(restore(saved!.state).roster.panels).toEqual([])
    })

    it("opens each panel it knows once, by its former name too, and none of the rest", () => {
      const saved = decodeSession(
        savedWith(["notes", "notes", 3, null, "sessions", "nope", "source", "todo"]),
      )
      expect(saved?.state.panels).toEqual(["notes", "files", "todo"])
      expect(saved?.state.order).toEqual(["02", "panel:notes", "01", "panel:todo"])
    })

    it("opens none from a list it can't read, and still reads the rest", () => {
      for (const panels of ["notes", { notes: true }, null]) {
        const saved = decodeSession(savedWith(panels))
        expect(saved?.state.panels).toEqual([])
        expect(saved?.state.selected).toBe("panel:notes")
      }
    })

    context("when an older build reads what this one saved", () => {
      // That build's decoder, as far as it goes: the key list of `decodeSession` before
      // panels were saved. It rebuilds the state from the keys it knows alone, so it passes
      // over `panels`; the cast stands for its checks of each key's shape.
      const olderDecode = (text: string): Omit<RestoredView, "panels"> | undefined => {
        const value = JSON.parse(text) as { version: unknown; state: Record<string, unknown> }
        if (value.version !== 2) return undefined
        const { order, layout, view, windowedView, selected, bars } = value.state
        if (!Array.isArray(order) || typeof selected !== "string") return undefined
        return { order, layout, view, windowedView, selected, bars } as Omit<RestoredView, "panels">
      }

      it("reads it, and restores the session without them", () => {
        const older = olderDecode(encodeSession(withPanels()))
        expect(older).toBeDefined()
        // Its restore knows no panels, so it drops the `panel:` ids and hands the
        // selection on.
        const state = restore({ ...older!, panels: [] })
        expect(state.roster.order).toEqual(["02", "01"])
        expect(state.selected).toBe("02")
        expect(Object.keys(state.layout.spans)).toEqual([])
        expect(state.layout.canvas.geometry).not.toHaveProperty("panel:notes")
      })
    })
  })

  context("when it was saved by a build that kept the terminals too", () => {
    it("reads nothing, as that build is gone", () => {
      const current = JSON.parse(encodeSession(session())) as {
        state: Record<string, unknown>
      }
      const { order, ...rest } = current.state
      const old = JSON.stringify({ ...current, state: { ...rest, roster: { order } } })
      expect(decodeSession(old)).toBeUndefined()
    })
  })

  context("when the runner has nothing this build can read", () => {
    it("reads nothing", () => {
      const text = encodeSession(session())
      const broken = JSON.parse(text) as Record<string, unknown>
      expect(
        [
          null,
          "",
          "not json",
          "[]",
          JSON.stringify({ ...broken, version: 99 }),
          JSON.stringify({ ...broken, version: 1 }),
          JSON.stringify({ ...broken, state: { ...(broken.state as object), view: "list" } }),
          JSON.stringify({ ...broken, state: { ...(broken.state as object), layout: {} } }),
          JSON.stringify({ ...broken, state: { ...(broken.state as object), order: [1] } }),
        ].map(decodeSession),
      ).toEqual(Array.from({ length: 9 }, () => undefined))
    })
  })

  context("with companion bars", () => {
    // The first terminal holds `count` items on its bar, and 02 holds one; 01's bar also
    // remembers an item that's gone and hides its messages.
    const withBars = (count: number): WorkspaceSession => {
      const base = session()
      const many = Array.from({ length: count }, (_, index) =>
        itemFixture(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, "01"),
      )
      const other = itemFixture("other", "02")
      return {
        ...base,
        state: {
          ...base.state,
          items: [...many, other],
          bars: {
            "01": {
              order: [...many.map((item) => item.id), "gone" as (typeof many)[number]["id"]],
              hidden: [messagesKey],
              stack: many.slice(0, 1).map((item) => item.id),
              open: true,
            },
            "02": { order: [other.id], hidden: [], stack: [], open: false },
            "99": { order: [other.id], hidden: [], stack: [], open: false },
          },
        },
      }
    }

    it("keeps each terminal's bar, less what's gone", () => {
      const saved = decodeSession(encodeSession(withBars(2)))
      const ids = withBars(2).state.items.map((item) => item.id)
      expect(saved?.state.bars).toEqual({
        "01": { order: [ids[0], ids[1]], hidden: [messagesKey], stack: [ids[0]], open: true },
        "02": { order: ["other"], hidden: [], stack: [], open: false },
      })
    })

    it("drops the order and hidden entries of the largest bars first when it would not fit", () => {
      const big = withBars(40)
      const whole = encodeSession(big, Infinity)
      const text = encodeSession(big, whole.length - 1)
      expect(text.length).toBeLessThan(whole.length)
      const saved = decodeSession(text)
      expect(saved?.state.bars?.["01"]).toMatchObject({ order: [], hidden: [], open: true })
      expect(saved?.state.bars?.["02"]?.order).toEqual(["other"])
    })

    it("reads a bar it can't make sense of as none", () => {
      const text = JSON.parse(encodeSession(withBars(1))) as {
        state: { bars: Record<string, unknown> }
      }
      text.state.bars["01"] = { order: "nope" }
      expect(decodeSession(JSON.stringify(text))?.state.bars).toEqual({
        "02": { order: ["other"], hidden: [], stack: [], open: false },
      })
    })
  })
})
