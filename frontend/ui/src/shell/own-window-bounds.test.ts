import { afterEach } from "vitest"

import { context, describe, expect, it } from "../test"
import {
  boundsOf,
  keptBoundsOf,
  measuredBounds,
  ownWindowDefault,
  ownWindowFeatures,
  sizeBasis,
  type OwnWindowBounds,
  type WindowMeasures,
} from "./own-window-bounds"
import { readOwnWindowBounds, writeOwnWindowBounds } from "./shell-storage"

afterEach(() => localStorage.clear())

// A window 400 by 700 at (1940, 120) on the screens, its page 400 by 660 under a 40px title bar.
const drawn: WindowMeasures = {
  screenX: 1940,
  screenY: 120,
  outerWidth: 400,
  outerHeight: 700,
  innerWidth: 400,
  innerHeight: 660,
}

describe("a panel's window of its own", () => {
  context("as it opens", () => {
    it("asks for a popup at its place and size, as the desktop app takes them alone", () => {
      expect(ownWindowFeatures({ left: -1200, top: 80, width: 400, height: 700 })).toBe(
        "popup,left=-1200,top=80,width=400,height=700",
      )
    })

    it("asks for its size alone where it has no place yet", () => {
      expect(ownWindowFeatures(ownWindowDefault)).toBe("popup,width=380,height=640")
    })

    it("asks in whole numbers alone, which the desktop app takes, whatever it was given", () => {
      // The desktop app's rule (apps/desktop, `requestedBounds`): `popup`, then bounds whose
      // values are whole numbers.
      const desktopTakes = /^popup(?:,(?:left|top|width|height)=-?\d+)*$/u
      const given: readonly OwnWindowBounds[] = [
        { left: 10.5, top: 0, width: 380.6, height: 640.2 },
        { left: -1200.7, top: -0.4, width: 400, height: 700 },
        { left: 0, top: 0, width: 0.2, height: 0 },
      ]
      for (const bounds of given) expect(ownWindowFeatures(bounds)).toMatch(desktopTakes)
      expect(ownWindowFeatures(given[0]!)).toBe("popup,left=11,top=0,width=381,height=640")
      expect(ownWindowFeatures(given[1]!)).toBe("popup,left=-1201,top=0,width=400,height=700")
    })
  })

  context("as it is measured", () => {
    it("keeps the page's size where the browser opened it at the size asked", () => {
      const basis = sizeBasis(drawn, { width: 400, height: 660 })
      expect(basis).toBe("inner")
      expect(measuredBounds(drawn, basis)).toEqual({
        left: 1940,
        top: 120,
        width: 400,
        height: 660,
      })
    })

    it("takes a page a pixel or two off the size asked as the size asked", () => {
      expect(sizeBasis(drawn, { width: 401, height: 662 })).toBe("inner")
      expect(sizeBasis(drawn, { width: 400, height: 665 })).toBe("outer")
    })

    it("keeps the window's whole size where the desktop app opened it at the size asked", () => {
      const basis = sizeBasis(drawn, { width: 400, height: 700 })
      expect(basis).toBe("outer")
      expect(measuredBounds(drawn, basis)).toMatchObject({ width: 400, height: 700 })
    })
  })

  context("as it was kept", () => {
    it("reads a size and a place, in whole pixels", () => {
      expect(boundsOf({ width: 400.4, height: 700, left: 10, top: -20.6 })).toEqual({
        width: 400,
        height: 700,
        left: 10,
        top: -21,
      })
    })

    it("reads a size without its place where it names only one edge", () => {
      expect(boundsOf({ width: 400, height: 700, left: 10 })).toEqual({ width: 400, height: 700 })
    })

    it("reads none from what makes no window", () => {
      for (const value of [null, "400x700", { width: 0, height: 700 }, { width: "400" }])
        expect(boundsOf(value)).toBeUndefined()
    })

    it("keeps each panel's own, leaving out what isn't a panel or makes no window", () => {
      expect(
        keptBoundsOf({
          notes: { width: 400, height: 700 },
          todo: { width: -1, height: 700 },
          dock: { width: 400, height: 700 },
        }),
      ).toEqual({ notes: { width: 400, height: 700 } })
      expect(keptBoundsOf([{ width: 400, height: 700 }])).toEqual({})
    })
  })

  context("in storage", () => {
    it("opens where the panel's last window was, beside the others' own", () => {
      writeOwnWindowBounds("notes", { left: 10, top: 20, width: 400, height: 700 })
      writeOwnWindowBounds("todo", { width: 500, height: 600 })
      expect(readOwnWindowBounds("notes")).toEqual({ left: 10, top: 20, width: 400, height: 700 })
      expect(readOwnWindowBounds("todo")).toEqual({ width: 500, height: 600 })
      expect(readOwnWindowBounds("files")).toEqual(ownWindowDefault)
    })

    it("opens at the first's size where what was kept is damaged", () => {
      localStorage.setItem("novadeck.panel-windows", "{not json")
      expect(readOwnWindowBounds("notes")).toEqual(ownWindowDefault)
      writeOwnWindowBounds("notes", { width: 400, height: 700 })
      expect(readOwnWindowBounds("notes")).toEqual({ width: 400, height: 700 })
    })
  })
})
