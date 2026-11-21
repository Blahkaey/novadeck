import { panelTile } from "@novadeck/core/roster"
import { terminalFixture } from "@novadeck/core/testing"
import { render } from "@novadeck/test-kit/render"
import { createElement } from "react"

import { describe, expect, it } from "../test"
import { TerminalSwitcher } from "./TerminalSwitcher"

describe("the terminal switcher", () => {
  it("lists a panel's window under its panel's icon, as a panel window", () => {
    const { container } = render(
      createElement(TerminalSwitcher, {
        terminals: [terminalFixture(1, "/project"), panelTile("notes")],
        selected: "01",
        project: "Storefront",
        mode: "held",
        onSelect: () => {},
        onClose: () => {},
      }),
    )
    const row = (name: string) => container.querySelector(`[role="option"][aria-label="${name}"]`)!
    expect(row("Notes").querySelector("svg")!.classList).toContain("lucide-notebook-pen")
    expect(row("Notes").querySelector(".switcher-process")!.textContent).toBe("panel window")
    expect(row("Terminal").querySelector("svg")!.classList).toContain("lucide-terminal")
    expect(row("Terminal").querySelector(".switcher-process")!.textContent).toBe("zsh")
  })
})
