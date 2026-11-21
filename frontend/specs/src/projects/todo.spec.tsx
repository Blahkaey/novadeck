import { onTestFinished } from "vitest"
import { page, userEvent, type Locator } from "vitest/browser"

import { notesFault } from "../support/backend"
import { pressShortcut } from "../support/keyboard"
import { pinPointer } from "../support/pointer"
import { openWorkspace, sidebar, sidebarPanel, tooltipOf } from "../support/workspace"
import { context, describe, expect, it } from "../test"

// The agents demo keeps the person's notes: the storefront's Todo board starts with three
// cards in To do (one Codex added as @pike), one with details In progress and two in Done.
const agents = "/?demo=agents"

const tab = (name: string) => page.getByRole("tab", { name: new RegExp(`^${name}\\s*\\d+$`) })
const column = (name: string) => page.getByRole("list", { name })
const adding = () => page.getByRole("textbox", { name: "Add a todo…" })
const heading = (count: number | "") =>
  page.getByRole("heading", { name: new RegExp(`^Todo${count === "" ? "" : ` ${count}`}$`) })
// The lines of the column on show, top to bottom: each is the button that edits its card.
const lines = (name: string) =>
  column(name)
    .getByRole("button", { name: /^Edit / })
    .elements()
    .map((line) => line.textContent)
const card = (name: string, text: string) =>
  column(name).getByRole("listitem").filter({ hasText: text })
const said = () => page.getByRole("status")
const announced = () => page.getByRole("status", { name: "Board moves" }).element().textContent
const openBoard = async () => {
  await openWorkspace(agents)
  await sidebarPanel("Todo").click()
  await expect.element(column("To do")).toBeVisible()
}
// Drags the card whose line says `text` by its line onto `onto`.
const drag = async (text: string, onto: Locator) => {
  const line = page.getByRole("button", { name: `Edit ${text}` })
  const box = line.element().getBoundingClientRect()
  const target = onto.element().getBoundingClientRect()
  await userEvent.dragAndDrop(line, onto, {
    sourcePosition: { x: Math.min(20, box.width / 2), y: box.height / 2 },
    targetPosition: { x: target.width / 2, y: target.height / 2 },
    steps: 12,
  })
}
// The line a card shows where a dragged card would land just above it, as drawn: how wide and
// tall, how opaque, and whether the box it scrolls in shows it whole; undefined where it draws
// none.
const landingLine = (on: Element) => {
  const style = getComputedStyle(on, "::after")
  if (style.content === "none") return undefined
  const top = on.getBoundingClientRect().top + Number.parseFloat(style.top)
  let box = on.parentElement
  while (box && getComputedStyle(box).overflowY === "visible") box = box.parentElement
  return {
    width: Number.parseFloat(style.width),
    height: Number.parseFloat(style.height),
    opacity: Number(style.opacity),
    inView: box ? top >= box.getBoundingClientRect().top : true,
  }
}
// Chooses `item` from a card's Move menu.
const moveBy = async (text: string, item: string) => {
  await page.getByRole("button", { name: `Move ${text}` }).click()
  await page.getByRole("menuitem", { name: item, exact: true }).click()
}

describe("The Todo board", () => {
  context("in the sidebar", () => {
    it("shows one column at a time under a tab for each, To do first, counting what is left", async () => {
      await openBoard()
      await expect.element(heading(4)).toBeVisible()
      await expect.element(tab("To do")).toHaveAttribute("aria-selected", "true")
      await expect.element(tab("To do")).toHaveTextContent("To do3")
      await expect.element(tab("In progress")).toHaveTextContent("In progress1")
      await expect.element(tab("Done")).toHaveTextContent("Done2")
      expect(lines("To do")).toEqual([
        "Ask @wren to cover expired coupon codes",
        "Reply to the design review about the empty cart",
        "Move the price formatter into the shared package",
      ])

      await tab("In progress").click()
      expect(lines("In progress")).toEqual(["Check the cart total on a slow connection"])
      await expect.element(column("To do")).not.toBeInTheDocument()
    })

    it("opens by its key, and its rail toggle says how many todos are left", async () => {
      await openWorkspace(agents)
      await pressShortcut("todo")
      await expect.element(sidebar()).toHaveAccessibleName("Todo")
      expect(await tooltipOf(sidebarPanel("Todo"))).toMatch(/^Todo · 4 to do · /)
    })

    it("marks a card an agent added with the agent's icon", async () => {
      await openBoard()
      await expect
        .element(
          card("To do", "Move the price formatter into the shared package").getByRole("img", {
            name: "Added by Codex · @pike",
          }),
        )
        .toBeVisible()
    })
  })

  context("when a card is added", () => {
    it("goes first in To do on Enter, and leaves the field ready for the next", async () => {
      await openBoard()
      await adding().fill("Write the release notes")
      await userEvent.keyboard("{Enter}")
      await expect.poll(() => lines("To do")[0]).toBe("Write the release notes")
      await expect.element(heading(5)).toBeVisible()
      await expect.element(adding()).toHaveValue("")
      await expect.element(adding()).toHaveFocus()
    })
  })

  context("when a card is moved", () => {
    it("goes through every column by its Move menu, the board following it and the keyboard on it", async () => {
      await openBoard()
      const text = "Reply to the design review about the empty cart"
      const move = page.getByRole("button", { name: `Move ${text}` })

      await moveBy(text, "In progress")
      await expect.element(tab("In progress")).toHaveAttribute("aria-selected", "true")
      await expect.poll(() => lines("In progress")[0]).toBe(text)
      await expect.element(move).toHaveFocus()
      await expect.poll(announced).toBe(`${text}: In progress, 1 of 2`)

      await moveBy(text, "Done")
      await expect.element(tab("Done")).toHaveAttribute("aria-selected", "true")
      await expect.poll(() => lines("Done")[0]).toBe(text)
      await expect.element(move).toHaveFocus()

      await moveBy(text, "To do")
      await expect.element(tab("To do")).toHaveAttribute("aria-selected", "true")
      await expect.poll(() => lines("To do")[0]).toBe(text)
      await expect.element(heading(4)).toBeVisible()
    })

    it("goes through every column with Alt and the arrows, keeping the keyboard", async () => {
      await openBoard()
      const text = "Ask @wren to cover expired coupon codes"
      const line = page.getByRole("button", { name: `Edit ${text}` })
      ;(line.element() as HTMLElement).focus()

      await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}")
      await expect.element(tab("In progress")).toHaveAttribute("aria-selected", "true")
      await expect
        .poll(() => lines("In progress"))
        .toEqual([text, "Check the cart total on a slow connection"])
      await expect.element(line).toHaveFocus()

      await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}")
      await expect
        .poll(() => lines("In progress"))
        .toEqual(["Check the cart total on a slow connection", text])
      await expect.poll(announced).toBe(`${text}: In progress, 2 of 2`)
      await expect.element(line).toHaveFocus()

      await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}")
      await expect.element(tab("Done")).toHaveAttribute("aria-selected", "true")
      await expect.poll(() => lines("Done")[0]).toBe(text)
      await expect.element(line).toHaveFocus()

      await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}{Alt>}{ArrowLeft}{/Alt}")
      await expect.element(tab("To do")).toHaveAttribute("aria-selected", "true")
      await expect.poll(() => lines("To do")[0]).toBe(text)
    })

    it("lands where it is dragged: after a card below it, or first in a column whose tab it is dropped on", async () => {
      await openBoard()
      await drag(
        "Ask @wren to cover expired coupon codes",
        card("To do", "Move the price formatter into the shared package"),
      )
      await expect
        .poll(() => lines("To do"))
        .toEqual([
          "Reply to the design review about the empty cart",
          "Move the price formatter into the shared package",
          "Ask @wren to cover expired coupon codes",
        ])

      await drag("Reply to the design review about the empty cart", tab("Done"))
      await expect.element(tab("Done")).toHaveAttribute("aria-selected", "true")
      await expect
        .poll(() => lines("Done")[0])
        .toBe("Reply to the design review about the empty cart")
    })

    it("shows a line where it would land while it is dragged, above the first card too", async () => {
      await openBoard()
      const line = page.getByRole("button", {
        name: "Edit Move the price formatter into the shared package",
      })
      const box = line.element().getBoundingClientRect()
      const at = { x: box.left + Math.min(20, box.width / 2), y: box.top + box.height / 2 }
      const first = card("To do", "Ask @wren to cover expired coupon codes")
      const target = first.element().getBoundingClientRect()
      expect(landingLine(first.element())).toBeUndefined()

      await pinPointer("press", at)
      await pinPointer("move", { x: at.x, y: at.y - 10 })
      await pinPointer("move", { x: at.x, y: target.top + target.height / 2 })

      await expect.poll(() => landingLine(first.element())).toBeDefined()
      const shown = landingLine(first.element())!
      expect(shown.opacity).toBe(1)
      expect(shown.width).toBeGreaterThan(target.width / 2)
      expect(shown.height).toBe(2)
      expect(shown.inView).toBe(true)

      await userEvent.keyboard("{Escape}")
      await pinPointer("release", { x: at.x, y: target.top + target.height / 2 })
      await expect.poll(() => landingLine(first.element())).toBeUndefined()
    })

    it("stays where it was when a drag is called off with Escape", async () => {
      await openBoard()
      const before = lines("To do")
      const line = page.getByRole("button", {
        name: "Edit Ask @wren to cover expired coupon codes",
      })
      const box = line.element().getBoundingClientRect()
      const at = { x: box.left + Math.min(20, box.width / 2), y: box.top + box.height / 2 }
      const target = card("To do", "Move the price formatter into the shared package")
        .element()
        .getBoundingClientRect()
      await pinPointer("press", at)
      await pinPointer("move", { x: at.x, y: at.y + 10 })
      await pinPointer("move", { x: at.x, y: target.top + target.height / 2 })
      await userEvent.keyboard("{Escape}")
      await pinPointer("release", { x: at.x, y: target.top + target.height / 2 })

      await expect.poll(() => lines("To do")).toEqual(before)
    })

    it("keeps a done card's date as it moves within Done", async () => {
      await openBoard()
      await tab("Done").click()
      const first = card("Done", "Rename the checkout route")
      await expect.element(first.getByText(/^Done /)).toBeVisible()
      ;(first.getByRole("button", { name: /^Edit / }).element() as HTMLElement).focus()

      await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}")

      await expect
        .poll(() => lines("Done"))
        .toEqual(["Update the screenshots in the README", "Rename the checkout route"])
      await expect.element(first.getByText(/^Done /)).toBeVisible()
    })
  })

  context("when a card is checked off", () => {
    it("goes first in Done, and counts one less left", async () => {
      await openBoard()
      await column("To do")
        .getByRole("checkbox", { name: "Ask @wren to cover expired coupon codes" })
        .click()
      await expect.element(heading(3)).toBeVisible()
      await expect.element(tab("Done")).toHaveTextContent("Done3")
      await tab("Done").click()
      expect(lines("Done")[0]).toBe("Ask @wren to cover expired coupon codes")
    })

    it("are all deleted once Clear done is confirmed", async () => {
      await openBoard()
      await tab("Done").click()
      await page.getByRole("button", { name: "Clear done todos" }).click()
      const question = page.getByRole("alertdialog", { name: "Clear done todos?" })
      await expect
        .poll(() => question.element().textContent)
        .toMatch(/2 done todos are deleted for good\. You can’t bring them back\./)
      await question.getByRole("button", { name: "Clear done", exact: true }).click()
      await expect.element(tab("Done")).toHaveTextContent("Done0")
      await expect.element(page.getByText("Nothing done yet.")).toBeVisible()
      await expect.element(tab("To do")).toHaveTextContent("To do3")
    })
  })

  context("when a card is made a note", () => {
    it("leaves the board for the Notes panel, and comes back made a todo", async () => {
      await openBoard()
      const text = "Reply to the design review about the empty cart"
      await column("To do")
        .getByRole("button", { name: `Details of ${text}` })
        .click()
      // With no details yet, opening them starts writing some, which Escape lets go.
      await expect.element(page.getByRole("textbox", { name: "Details" })).toHaveFocus()
      await userEvent.keyboard("{Escape}")
      await column("To do").getByRole("button", { name: "Make it a note" }).click()
      await expect.poll(() => lines("To do")).not.toContain(text)

      await sidebarPanel("Notes").click()
      const notes = page.getByRole("list", { name: "Notes" })
      await notes.getByRole("button", { name: `Details of ${text}` }).click()
      await expect.element(page.getByRole("textbox", { name: "Details" })).toHaveFocus()
      await userEvent.keyboard("{Escape}")
      await notes.getByRole("button", { name: "Make it a todo" }).click()

      await sidebarPanel("Todo").click()
      await expect.poll(() => lines("To do")).toContain(text)
    })
  })

  context("on a narrow window, where the sidebar opens over the whole width", () => {
    const narrow = async () => {
      await page.viewport(640, 800)
      onTestFinished(() => page.viewport(1440, 900))
      await openWorkspace(agents)
      await sidebarPanel("Todo").click()
      await expect.element(page.getByRole("dialog", { name: "Todo" })).toBeVisible()
    }
    const columnHeading = (name: string) =>
      page.getByRole("heading", { name: new RegExp(`^${name}\\s*\\d+$`) })

    it("shows the three columns side by side, each under its heading, with no tabs", async () => {
      await narrow()
      const boxes = ["To do", "In progress", "Done"].map((name) =>
        columnHeading(name).element().getBoundingClientRect(),
      )
      expect(new Set(boxes.map(({ top }) => Math.round(top))).size).toBe(1)
      expect(boxes.map(({ left }) => left)).toEqual(
        boxes.map(({ left }) => left).toSorted((a, b) => a - b),
      )
      await expect.element(page.getByRole("tab", { name: /^To do/ })).not.toBeInTheDocument()
      expect(lines("In progress")).toEqual(["Check the cart total on a slow connection"])
      expect(lines("Done")).toEqual([
        "Rename the checkout route",
        "Update the screenshots in the README",
      ])
    })

    it("scrolls a column that runs long on its own, the others staying put", async () => {
      await narrow()
      for (const index of Array.from({ length: 16 }, (_, at) => at + 1)) {
        // eslint-disable-next-line no-await-in-loop -- Each goes first in turn.
        await adding().fill(`Todo ${index}`)
        // eslint-disable-next-line no-await-in-loop -- Each goes first in turn.
        await userEvent.keyboard("{Enter}")
      }
      await expect.poll(() => lines("To do")).toHaveLength(19)
      const scroller = (name: string) => column(name).element().parentElement!
      expect(scroller("To do").scrollHeight).toBeGreaterThan(scroller("To do").clientHeight)
      const done = columnHeading("Done").element().getBoundingClientRect().top
      scroller("To do").scrollTop = scroller("To do").scrollHeight
      await expect
        .poll(() => card("To do", "Ask @wren to cover expired coupon codes").element())
        .toBeVisible()
      expect(columnHeading("Done").element().getBoundingClientRect().top).toBe(done)
      await expect.element(card("Done", "Rename the checkout route")).toBeVisible()
    })

    it("lands a card dropped on another column's cards before the one it is dropped on", async () => {
      await narrow()
      const text = "Ask @wren to cover expired coupon codes"
      await drag(text, card("Done", "Update the screenshots in the README"))
      await expect
        .poll(() => lines("Done"))
        .toEqual(["Rename the checkout route", text, "Update the screenshots in the README"])
      expect(lines("To do")).not.toContain(text)
    })

    it("keeps the keyboard on a card it moves to another column", async () => {
      await narrow()
      const text = "Reply to the design review about the empty cart"
      const line = page.getByRole("button", { name: `Edit ${text}` })
      ;(line.element() as HTMLElement).focus()

      await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}")

      await expect.poll(() => lines("In progress")[0]).toBe(text)
      await expect.element(line).toHaveFocus()
      await expect.poll(announced).toBe(`${text}: In progress, 1 of 2`)
    })
  })

  context("when a change isn't saved", () => {
    it("says so above the columns, and shows the board as the backend has it", async () => {
      await openBoard()
      notesFault.failNext()
      await column("To do")
        .getByRole("checkbox", { name: "Ask @wren to cover expired coupon codes" })
        .click()

      await expect
        .element(said().filter({ hasText: "Your last change wasn’t saved." }))
        .toHaveTextContent("Your last change wasn’t saved. The board is as it was.")
      expect(lines("To do")[0]).toBe("Ask @wren to cover expired coupon codes")
      await expect.element(tab("Done")).toHaveTextContent("Done2")
    })
  })
})
