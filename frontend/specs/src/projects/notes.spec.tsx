import { page, userEvent } from "vitest/browser"

import { openWorkspace, sidebarPanel } from "../support/workspace"
import { context, describe, expect, it } from "../test"

// The agents demo keeps the person's notes: the storefront starts with two plain notes, the
// first with details, and its todos on the Todo board.
const agents = "/?demo=agents"

const notes = () => page.getByRole("list", { name: "Notes" })
const adding = () => page.getByRole("textbox", { name: "Add a note…" })
// The notes' lines, top to bottom: each is the button that edits it.
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
    it("lists the project's plain notes in order, with how many there are, and no todos", async () => {
      await openNotes()
      await expect.element(page.getByRole("heading", { name: /^Notes 2$/ })).toBeVisible()
      expect(lines()).toEqual([
        "Staging deploys from the release branch",
        "Coupon codes reset on the demo store every night",
      ])
      // A plain note has no checkbox to tick, and the todos are the Todo board's.
      await expect.element(notes().getByRole("checkbox")).not.toBeInTheDocument()
    })

    it("keeps each project's notes apart", async () => {
      await openNotes()
      await page.getByRole("button", { name: "Switch workspace", exact: true }).click()
      await page
        .getByRole("dialog", { name: "Switch workspace" })
        .getByRole("button", { name: /^docs-site / })
        .click()
      await expect
        .element(page.getByText("Notes you write here stay with this project."))
        .toBeVisible()
      await expect.element(page.getByRole("heading", { name: /^Notes$/ })).toBeVisible()
    })
  })

  context("when a note is added", () => {
    it("goes first in the list on Enter, with no checkbox, and leaves the field ready for the next", async () => {
      await openNotes()
      await adding().fill("The demo store resets nightly")
      await userEvent.keyboard("{Enter}")
      await expect
        .element(notes().getByRole("button", { name: "Edit The demo store resets nightly" }))
        .toBeVisible()
      expect(lines()[0]).toBe("The demo store resets nightly")
      await expect.element(notes().getByRole("checkbox")).not.toBeInTheDocument()
      await expect.element(page.getByRole("heading", { name: /^Notes 3$/ })).toBeVisible()
      await expect.element(adding()).toHaveValue("")
      await expect.element(adding()).toHaveFocus()
    })
  })

  context("when a note is changed", () => {
    it("takes a new line where it stands, saved with Enter", async () => {
      await openNotes()
      await notes()
        .getByRole("button", { name: "Edit Staging deploys from the release branch" })
        .click()
      const line = page.getByRole("textbox", { name: "Note text" })
      await expect.element(line).toHaveFocus()
      await line.fill("Staging deploys from release")
      await userEvent.keyboard("{Enter}")
      await expect
        .element(notes().getByRole("button", { name: "Edit Staging deploys from release" }))
        .toHaveFocus()
    })

    it("shows what is under its line as Markdown once opened", async () => {
      await openNotes()
      const details = notes().getByRole("button", {
        name: "Details of Staging deploys from the release branch",
      })
      await expect.element(details).toHaveAttribute("aria-expanded", "false")
      await details.click()
      await expect.element(details).toHaveAttribute("aria-expanded", "true")
      await expect.element(notes().getByRole("code").first()).toHaveTextContent("release")
    })

    it("moves one place with Alt and an arrow, keeping the keyboard", async () => {
      await openNotes()
      const first = notes().getByRole("button", {
        name: "Edit Staging deploys from the release branch",
      })
      ;(first.element() as HTMLElement).focus()
      await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}")
      await expect
        .poll(lines)
        .toEqual([
          "Coupon codes reset on the demo store every night",
          "Staging deploys from the release branch",
        ])
      await expect.element(first).toHaveFocus()
    })

    it("becomes a todo on the Todo board once made one", async () => {
      await openNotes()
      await notes()
        .getByRole("button", {
          name: "Details of Coupon codes reset on the demo store every night",
        })
        .click()
      // With no details yet, opening them starts writing some, which Escape lets go.
      await expect.element(page.getByRole("textbox", { name: "Details" })).toHaveFocus()
      await userEvent.keyboard("{Escape}")
      await notes().getByRole("button", { name: "Make it a todo" }).click()
      await expect.poll(lines).toEqual(["Staging deploys from the release branch"])

      await sidebarPanel("Todo").click()
      await expect
        .element(
          page
            .getByRole("list", { name: "To do" })
            .getByRole("checkbox", { name: "Coupon codes reset on the demo store every night" }),
        )
        .toBeVisible()
    })
  })
})
