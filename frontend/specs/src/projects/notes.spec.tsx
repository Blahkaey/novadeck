import { page, userEvent } from "vitest/browser"

import { openWorkspace, sidebarPanel, tooltipOf } from "../support/workspace"
import { context, describe, expect, it } from "../test"

// The agents demo keeps the person's notes: the storefront starts with four todos, one of them
// with details and one Codex added as @pike, a plain note between them, and two todos checked
// off.
const agents = "/?demo=agents"

const notes = () => page.getByRole("list", { name: "Notes" })
const done = () => page.getByRole("list", { name: "Done" })
const adding = () => page.getByRole("textbox", { name: "Add a todo…" })
const doneToggle = () => page.getByRole("button", { name: /^Done \d+$/ })
const row = (text: string) => notes().getByRole("listitem").filter({ hasText: text })
// The open notes' lines, top to bottom: each is the button that edits it.
const lines = () =>
  notes()
    .getByRole("button", { name: /^Edit / })
    .elements()
    .map((line) => line.textContent)
const openNotes = async () => {
  await openWorkspace(agents)
  await sidebarPanel("Notes").click()
  await expect.element(notes()).toBeVisible()
}

describe("The Notes panel", () => {
  context("where the backend keeps the person's notes", () => {
    it("lists the project's open notes in order, with how many todos are left", async () => {
      await openNotes()
      await expect.element(page.getByRole("heading", { name: /^Notes 4$/ })).toBeVisible()
      expect(lines()).toEqual([
        "Ask @wren to cover expired coupon codes",
        "Check the cart total on a slow connection",
        "Reply to the design review about the empty cart",
        "Staging deploys from the release branch",
        "Move the price formatter into the shared package",
      ])
      // A plain note has no checkbox to tick.
      await expect.element(notes().getByRole("checkbox")).toHaveLength(4)
      await expect
        .element(notes().getByRole("checkbox", { name: "Staging deploys from the release branch" }))
        .not.toBeInTheDocument()
    })

    it("keeps each project's notes apart", async () => {
      await openNotes()
      await page.getByRole("button", { name: "Switch workspace", exact: true }).click()
      await page
        .getByRole("dialog", { name: "Switch workspace" })
        .getByRole("button", { name: /^docs-site / })
        .click()
      await expect
        .element(page.getByText("Todos and notes you write here stay with this project."))
        .toBeVisible()
      await expect.element(page.getByRole("heading", { name: /^Notes$/ })).toBeVisible()
    })
  })

  context("where an agent added a note", () => {
    it("marks it with the agent's icon, which names the agent and its terminal's handle", async () => {
      await openNotes()
      const mark = row("Move the price formatter into the shared package").getByRole("img", {
        name: "Added by Codex · @pike",
      })
      await expect.element(mark).toBeVisible()
      expect(await tooltipOf(mark)).toBe("Added by Codex · @pike")
      // A note the person wrote has none.
      await expect
        .element(
          row("Ask @wren to cover expired coupon codes").getByRole("img", { name: /^Added by / }),
        )
        .not.toBeInTheDocument()
    })
  })

  context("when a todo is added", () => {
    it("goes first in the list on Enter, and leaves the field ready for the next", async () => {
      await openNotes()
      await adding().fill("Write the release notes")
      await userEvent.keyboard("{Enter}")
      await expect
        .element(notes().getByRole("checkbox", { name: "Write the release notes" }))
        .toBeVisible()
      expect(lines()[0]).toBe("Write the release notes")
      await expect.element(page.getByRole("heading", { name: /^Notes 5$/ })).toBeVisible()
      await expect.element(adding()).toHaveValue("")
      await expect.element(adding()).toHaveFocus()
    })

    it("is a plain note, with no checkbox, once the field adds notes", async () => {
      await openNotes()
      await page.getByRole("button", { name: "Add as todos" }).click()
      await page.getByRole("textbox", { name: "Add a note…" }).fill("The demo store resets nightly")
      await userEvent.keyboard("{Enter}")
      await expect
        .element(notes().getByRole("button", { name: "Edit The demo store resets nightly" }))
        .toBeVisible()
      await expect
        .element(notes().getByRole("checkbox", { name: "The demo store resets nightly" }))
        .not.toBeInTheDocument()
      // It is nothing to do, so the count stays.
      await expect.element(page.getByRole("heading", { name: /^Notes 4$/ })).toBeVisible()
    })
  })

  context("when a todo is checked off", () => {
    it("moves under Done, which stays folded until asked for", async () => {
      await openNotes()
      await expect.element(doneToggle()).toHaveTextContent("Done2")
      await notes()
        .getByRole("checkbox", { name: "Ask @wren to cover expired coupon codes" })
        .click()
      await expect.element(page.getByRole("heading", { name: /^Notes 3$/ })).toBeVisible()
      await expect.element(doneToggle()).toHaveTextContent("Done3")
      await expect.element(done()).not.toBeInTheDocument()

      await doneToggle().click()
      const checked = done().getByRole("checkbox", {
        name: "Ask @wren to cover expired coupon codes",
      })
      await expect.element(checked).toBeChecked()
      // Unchecked there, it is open again.
      await checked.click()
      await expect
        .element(notes().getByRole("checkbox", { name: "Ask @wren to cover expired coupon codes" }))
        .toBeVisible()
    })

    it("hands the keyboard to the next todo, so several are ticked in a row", async () => {
      await openNotes()
      await adding().click()
      await userEvent.tab()
      await expect
        .element(notes().getByRole("checkbox", { name: "Ask @wren to cover expired coupon codes" }))
        .toHaveFocus()
      await userEvent.keyboard(" ")
      await expect
        .element(
          notes().getByRole("checkbox", { name: "Check the cart total on a slow connection" }),
        )
        .toHaveFocus()
      await expect.element(page.getByRole("heading", { name: /^Notes 3$/ })).toBeVisible()
    })

    it("is deleted with the other done todos once Clear done is confirmed", async () => {
      await openNotes()
      await page.getByRole("button", { name: "Clear done todos" }).click()
      const question = page.getByRole("alertdialog", { name: "Clear done todos?" })
      await expect
        .poll(() => question.element().textContent)
        .toMatch(/2 done todos are deleted for good\. You can’t bring them back\./)
      await question.getByRole("button", { name: "Clear done", exact: true }).click()
      await expect.element(doneToggle()).not.toBeInTheDocument()
      // The open ones stay.
      expect(lines()).toHaveLength(5)
    })
  })

  context("when a note is changed", () => {
    it("takes a new line where it stands, saved with Enter", async () => {
      await openNotes()
      await notes()
        .getByRole("button", { name: "Edit Reply to the design review about the empty cart" })
        .click()
      const line = page.getByRole("textbox", { name: "Note text" })
      await expect.element(line).toHaveFocus()
      await line.fill("Reply to the design review")
      await userEvent.keyboard("{Enter}")
      await expect
        .element(
          notes().getByRole("button", { name: "Edit Reply to the design review", exact: true }),
        )
        .toHaveFocus()
    })

    it("shows what is under its line as Markdown once opened", async () => {
      await openNotes()
      const details = notes().getByRole("button", {
        name: "Details of Check the cart total on a slow connection",
      })
      await expect.element(details).toHaveAttribute("aria-expanded", "false")
      await details.click()
      await expect.element(details).toHaveAttribute("aria-expanded", "true")
      await expect
        .element(page.getByText("It flickered between two totals on the train."))
        .toBeVisible()
      await expect.element(notes().getByRole("strong")).toHaveTextContent("Slow 4G")
    })

    it("moves one place among the open notes with Alt and an arrow, keeping the keyboard", async () => {
      await openNotes()
      const first = notes().getByRole("button", {
        name: "Edit Ask @wren to cover expired coupon codes",
      })
      ;(first.element() as HTMLElement).focus()
      await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}")
      await expect
        .poll(() => lines().slice(0, 2))
        .toEqual([
          "Check the cart total on a slow connection",
          "Ask @wren to cover expired coupon codes",
        ])
      await expect.element(first).toHaveFocus()
    })
  })
})
