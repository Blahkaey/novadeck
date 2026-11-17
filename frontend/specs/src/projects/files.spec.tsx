import { vi } from "vitest"
import { page, userEvent } from "vitest/browser"

import { expectStaysTrue } from "../support/layouts"
import { layoutSettled, openWorkspace, sidebarPanel, terminal } from "../support/workspace"
import { context, describe, expect, it } from "../test"

// The agents demo has a Files panel with the storefront's files. Specs run with reduced motion,
// so the demo's agents write nothing while a test looks, and a row's marks and chips hold still.
const agents = "/?demo=agents"
// The messages demo adds a team: @moth leads @crow.
const messages = "/?demo=messages"

describe("The Files panel", () => {
  context("when the demo has files to show", () => {
    it("opens from its toggle on the storefront's files, each with who changed it", async () => {
      await openWorkspace(agents)

      await sidebarPanel("Files").click()

      await expect.element(page.getByRole("tree", { name: "Project files" })).toBeVisible()
      await expect
        .element(page.getByRole("treeitem", { name: /^Checkout\.tsx, modified, .*@crow/ }))
        .toHaveAccessibleName(/@moth/)
    })

    it("keeps one chip and a count on a row whose name has no room beside two", async () => {
      await openWorkspace(agents)
      await sidebarPanel("Files").click()

      const select = page.getByRole("treeitem", { name: /^Checkout\.tsx,/ })
      await expect.element(select).toBeVisible()
      const row = select.element().closest(".files-row")!

      // Checkout.tsx was changed by two agents, and its row at the default width cannot hold
      // its name and two chips.
      expect(row.querySelectorAll(".files-chip")).toHaveLength(1)
      expect(row.querySelector(".files-more")?.textContent).toBe("+1")
    })
  })

  context("when the demo has a team whose members both worked here", () => {
    it("groups them in a squad track, and a click on the lead shows only their work", async () => {
      await openWorkspace(messages)
      await sidebarPanel("Files").click()

      const strip = page.getByRole("group", { name: "Show agents' work" })
      const squad = strip.getByRole("group", { name: "@moth's squad" })
      await expect.element(squad.getByRole("button", { name: "@moth" })).toBeVisible()
      await expect.element(squad.getByRole("button", { name: "@crow" })).toBeVisible()

      // Only @crow touched this test file, so it is dimmed while the selected agent is lit.
      const crowOnly = page.getByRole("treeitem", { name: /^Checkout\.test\.tsx,/ })
      const rowOf = (): Element | null => crowOnly.element().closest(".files-row")
      await expect.element(crowOnly).toBeVisible()
      await expect.poll(() => rowOf()?.getAttribute("data-dim")).toBe("true")
      // The squad's crow lights its file, and what neither touched is gone from the tree, which
      // comes back whole once they're let go.
      const untouched = page.getByRole("treeitem", { name: /^index\.html/ })
      await expect.element(untouched).toBeVisible()
      await squad.getByRole("button", { name: "@moth" }).click()

      await expect
        .element(squad.getByRole("button", { name: "@moth" }))
        .toHaveAttribute("aria-pressed", "true")
      await expect
        .element(squad.getByRole("button", { name: "@crow" }))
        .toHaveAttribute("aria-pressed", "true")
      await expect.poll(() => rowOf()?.getAttribute("data-dim")).toBe("false")
      await expect.element(untouched).not.toBeInTheDocument()
      await expect.poll(() => document.querySelector(".files-row[data-dim=true]")).toBeNull()

      await squad.getByRole("button", { name: "@moth" }).click()
      await expect.element(untouched).toBeVisible()
    })

    it("lets go of the kept agents on Escape after a mouse click, not sending it to the terminal", async () => {
      await openWorkspace(messages)
      await sidebarPanel("Files").click()
      const strip = page.getByRole("group", { name: "Show agents' work" })
      const crow = strip.getByRole("button", { name: "@crow" })

      await crow.click()
      await expect.element(crow).toHaveAttribute("aria-pressed", "true")
      // Let the keyboard policy's next-frame focus handback run, as it would for a real click.
      await layoutSettled()
      await userEvent.keyboard("{Escape}")

      await expect.element(crow).toHaveAttribute("aria-pressed", "false")
      expect(
        strip.element().querySelectorAll("[aria-pressed=true], [aria-pressed=mixed]"),
      ).toHaveLength(0)
      // Focus stayed in the strip rather than going back to the terminal.
      await expectStaysTrue(
        () => document.activeElement?.closest(".files-strip") != null,
        "focus in the strip",
      )
    })
  })

  context("when the tree is as wide as the real fonts need", () => {
    const px = (value: string): number => Number.parseFloat(value) || 0

    // What a row asks for, with two chips and its name in full: the row's borders, the select's
    // padding and gaps, its parts at their own width, and the chips.
    const naturalWidth = (row: Element): number => {
      const select = row.querySelector<HTMLElement>(".files-row-select")!
      const [rowStyle, selectStyle] = [getComputedStyle(row), getComputedStyle(select)]
      const parts = Array.from(select.children) as HTMLElement[]
      return (
        px(rowStyle.borderLeftWidth) +
        px(rowStyle.borderRightWidth) +
        px(selectStyle.paddingLeft) +
        px(selectStyle.paddingRight) +
        px(selectStyle.columnGap) * (parts.length - 1) +
        parts.reduce(
          (sum, part) =>
            sum + (part.classList.contains("files-name") ? part.scrollWidth : part.offsetWidth),
          0,
        ) +
        row.querySelector<HTMLElement>(".files-chips")!.offsetWidth
      )
    }

    it("keeps two chips only where the name still reads in full, at every width around it", async () => {
      await openWorkspace(agents)
      await sidebarPanel("Files").click()

      const tree = page.getByRole("tree", { name: "Project files" }).element() as HTMLElement
      const select = page.getByRole("treeitem", { name: /^Checkout\.tsx,/ })
      await expect.element(select).toBeVisible()
      const row = select.element().closest(".files-row")!
      const name = row.querySelector<HTMLElement>(".files-name")!
      const chips = (): number => row.querySelectorAll(".files-chip").length
      const resizeTo = async (width: number): Promise<void> => {
        tree.style.width = `${width}px`
        await expect.poll(() => tree.clientWidth).toBe(width)
        await layoutSettled()
      }

      // The width where this row, with both of its chips, needs no more than it has.
      await resizeTo(640)
      expect(chips()).toBe(2)
      const needed = Math.ceil(naturalWidth(row))

      // Two chips never cut the name, and one chip is kept wherever two would: sweeping across
      // the width where the real glyph widths and the estimate part ways, a few px at a time.
      const seen: { width: number; truncated: boolean; count: number }[] = []
      for (let width = needed - 14; width <= needed + 14; width += 2) {
        // eslint-disable-next-line no-await-in-loop -- One width after another.
        await resizeTo(width)
        seen.push({ width, truncated: name.scrollWidth > name.clientWidth, count: chips() })
      }
      expect(seen.filter(({ truncated }) => truncated)).toEqual([])
      expect(seen.filter(({ width, count }) => width >= needed + 2 && count !== 2)).toEqual([])
      expect(seen.filter(({ width, count }) => width < needed && count !== 1)).toEqual([])
    })
  })

  context("when the person asks for a row's menu", () => {
    it("copies the row's path in the project's folder, and its path from the root", async () => {
      await openWorkspace(agents)
      await sidebarPanel("Files").click()
      const copied = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
      const select = page.getByRole("treeitem", { name: /^Checkout\.tsx,/ })
      const menu = page.getByRole("menu", { name: "Checkout.tsx actions" })

      await select.click({ button: "right" })
      await expect.element(menu).toBeVisible()
      // The right-click moved the tree's one tab stop onto the row.
      await expect.element(select).toHaveAttribute("tabindex", "0")
      await menu.getByRole("menuitem", { name: /^Copy Path/ }).click()
      await select.click({ button: "right" })
      await menu.getByRole("menuitem", { name: "Copy Relative Path" }).click()

      await expect
        .poll(() => copied.mock.calls)
        .toEqual([
          ["~/projects/storefront/src/checkout/Checkout.tsx"],
          ["src/checkout/Checkout.tsx"],
        ])
      await expect.element(page.getByRole("alert")).not.toBeInTheDocument()
    })

    it("says above the tree that it couldn't copy, until dismissed", async () => {
      await openWorkspace(agents)
      await sidebarPanel("Files").click()
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"))
      const files = page.getByRole("region", { name: "Files" })

      await page.getByRole("treeitem", { name: /^Checkout\.tsx,/ }).click({ button: "right" })
      await page.getByRole("menuitem", { name: "Copy Relative Path" }).click()

      const failure = files.getByRole("alert")
      await expect
        .element(failure)
        .toHaveTextContent("Couldn't copy src/checkout/Checkout.tsx to the clipboard.")
      await failure.getByRole("button", { name: "Dismiss" }).click()
      await expect.element(failure).not.toBeInTheDocument()
    })
  })

  context("when the person hides files in a project", () => {
    it("hides a row from its menu, and shows it again by switching its pattern off", async () => {
      await openWorkspace(agents)
      await sidebarPanel("Files").click()
      const readme = page.getByRole("treeitem", { name: /^README\.md/ })
      await expect.element(readme).toBeVisible()

      await readme.click({ button: "right" })
      await page.getByRole("menuitem", { name: "Hide in This Project" }).click()
      await expect.element(readme).not.toBeInTheDocument()

      await page.getByRole("button", { name: "Hidden files" }).click()
      const dialog = page.getByRole("dialog", { name: "Hidden files" })
      const mine = dialog.getByRole("list", { name: "This project's patterns" })
      await mine.getByRole("checkbox", { name: "README.md" }).click()
      await dialog.getByRole("button", { name: "Save" }).click()

      await expect.element(dialog).not.toBeInTheDocument()
      await expect.element(readme).toBeVisible()
    })

    it("hides what a pattern added in Hidden files matches, and opens Preferences at the patterns for every project, which hide it everywhere", async () => {
      await openWorkspace(agents)
      await sidebarPanel("Files").click()
      const test = page.getByRole("treeitem", { name: /^Checkout\.test\.tsx,/ })
      const manifest = page.getByRole("treeitem", { name: /^package\.json/ })
      await expect.element(test).toBeVisible()
      await expect.element(manifest).toBeVisible()

      await page.getByRole("button", { name: "Hidden files" }).click()
      const dialog = page.getByRole("dialog", { name: "Hidden files" })
      await dialog.getByRole("textbox", { name: "Pattern to hide" }).fill("**/*.test.tsx")
      await dialog.getByRole("button", { name: "Add" }).click()
      await dialog.getByRole("button", { name: "Save" }).click()
      await expect.element(dialog).not.toBeInTheDocument()
      await expect.element(test).not.toBeInTheDocument()

      await page.getByRole("button", { name: "Hidden files" }).click()
      await dialog.getByRole("button", { name: "Edit in Preferences" }).click()
      const preferences = page.getByRole("dialog", { name: "Preferences" })
      await expect
        .element(preferences.getByRole("list", { name: "Patterns for every project" }))
        .toBeVisible()
      const field = preferences.getByRole("textbox", { name: "Pattern to hide" })
      await expect.element(field).toHaveFocus()

      await field.fill("package.json")
      await preferences.getByRole("button", { name: "Add" }).click()
      await userEvent.keyboard("{Escape}")
      await expect.element(preferences).not.toBeInTheDocument()
      await expect.element(manifest).not.toBeInTheDocument()
    })
  })

  context("when the person makes, renames and deletes files", () => {
    it("makes a file from a row's menu, focused, and deletes it with the keys once asked, Cancel first, giving the next row the focus", async () => {
      await openWorkspace(agents)
      await sidebarPanel("Files").click()
      const files = page.getByRole("region", { name: "Files" })

      await page.getByRole("treeitem", { name: /^README\.md/ }).click({ button: "right" })
      await page.getByRole("menuitem", { name: "New File…" }).click()
      const name = files.getByRole("textbox", { name: "Name of the new file" })
      await expect.element(name).toHaveFocus()
      await name.fill("index.html")
      await expect
        .element(files.getByText("There's already a file named index.html here."))
        .toBeVisible()
      await name.fill("NOTES.md")
      await userEvent.keyboard("{Enter}")
      const notes = page.getByRole("treeitem", { name: /^NOTES\.md/ })
      await expect.element(notes).toHaveFocus()

      await userEvent.keyboard("{Delete}")
      const asked = page.getByRole("alertdialog", { name: "Delete NOTES.md?" })
      await expect.element(asked.getByRole("button", { name: "Cancel" })).toHaveFocus()
      await userEvent.keyboard("{Tab}")
      await expect.element(asked.getByRole("button", { name: "Delete" })).toHaveFocus()
      await userEvent.keyboard("{Enter}")

      await expect.element(notes).not.toBeInTheDocument()
      await expect.element(page.getByRole("treeitem", { name: /^package\.json/ })).toHaveFocus()
    })

    it("has the project window follow a file renamed on F2, and say once it is deleted that it is gone", async () => {
      await openWorkspace(agents)
      await sidebarPanel("Files").click()
      const manifest = page.getByRole("treeitem", { name: /^package\.json/ })
      await manifest.dblClick()
      await expect.element(terminal("package.json")).toBeVisible()

      manifest.element().focus()
      await userEvent.keyboard("{F2}")
      const renaming = page.getByRole("textbox", { name: "New name for package.json" })
      await expect.element(renaming).toHaveFocus()
      await renaming.fill("manifest.json")
      await userEvent.keyboard("{Enter}")
      await expect.element(terminal("manifest.json")).toBeVisible()
      await expect.element(terminal("package.json")).not.toBeInTheDocument()

      await page.getByRole("treeitem", { name: /^manifest\.json/ }).click({ button: "right" })
      await page.getByRole("menuitem", { name: /^Delete/ }).click()
      await page
        .getByRole("alertdialog", { name: "Delete manifest.json?" })
        .getByRole("button", { name: "Delete" })
        .click()
      await expect
        .element(terminal("manifest.json").getByText("manifest.json isn't there any more."))
        .toBeVisible()
    })
  })

  context("when the demo has no files", () => {
    it("has no Files toggle", async () => {
      await openWorkspace()

      await expect.element(sidebarPanel("Terminals")).toBeVisible()
      await expect.element(sidebarPanel("Files")).not.toBeInTheDocument()
    })
  })
})
