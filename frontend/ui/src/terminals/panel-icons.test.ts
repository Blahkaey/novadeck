import { panelTile } from "@novadeck/core/roster"
import { terminalFixture } from "@novadeck/core/testing"
import { railPanels } from "@novadeck/core/types"
import { NotebookPen, Terminal } from "lucide-react"

import { describe, expect, it } from "../test"
import { panelIcons, tileIcon } from "./panel-icons"

describe("a tile's icon", () => {
  it("is its panel's for a panel's window, as on the panel's rail toggle", () => {
    expect(tileIcon(panelTile("notes"))).toBe(NotebookPen)
    for (const panel of railPanels) expect(tileIcon(panelTile(panel))).toBe(panelIcons[panel])
  })

  it("is a terminal's for any other", () => {
    expect(tileIcon(terminalFixture(1, "/project"))).toBe(Terminal)
  })
})
