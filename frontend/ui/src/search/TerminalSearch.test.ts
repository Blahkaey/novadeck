import { isPanel, panelTile } from "@novadeck/core/roster"
import { terminalFixture } from "@novadeck/core/testing"
import type { Tile } from "@novadeck/core/types"
import { render } from "@novadeck/test-kit/render"
import { NotebookPen, Terminal } from "lucide-react"
import { act, createElement } from "react"

import { describe, expect, it } from "../test"
import { TerminalSearch } from "./TerminalSearch"

describe("terminal search", () => {
  it("draws each result with the icon it is given, and calls a panel's window a panel window", async () => {
    render(
      createElement(TerminalSearch, {
        open: true,
        terminals: [terminalFixture(1, "/project"), panelTile("notes")],
        iconOf: (tile: Tile) => (isPanel(tile) ? NotebookPen : Terminal),
        destination: "Grid",
        onSelect: () => {},
        onClose: () => {},
      }),
    )
    // The combobox settles its list after it mounts.
    await act(async () => {})
    const result = (name: string) =>
      [...document.querySelectorAll('[role="option"]')].find((option) =>
        option.querySelector("strong")?.textContent?.includes(name),
      )!
    expect(result("Notes").querySelector("svg")!.classList).toContain("lucide-notebook-pen")
    expect(result("Notes").querySelector(".search-result-meta")!.textContent).toBe("panel window")
    expect(result("Terminal").querySelector("svg")!.classList).toContain("lucide-terminal")
    expect(result("Terminal").querySelector(".search-result-meta")!.textContent).toBe("zsh/project")
  })
})
