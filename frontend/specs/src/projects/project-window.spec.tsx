import { page, userEvent } from "vitest/browser"

import { worktreeDiff } from "../support/backend"
import { windowMenu } from "../support/companions"
import {
  chooseView,
  openWorkspace,
  sidebarPanel,
  terminal,
  terminalTab,
} from "../support/workspace"
import { context, describe, expect, it } from "../test"

// The agents demo has the storefront's files in a Files panel. A file opened there lands in
// the session's project window: the person's, one at a time, named by the file.
const storefront = (view: "focus" | "grid" | "canvas", experimental: boolean): string =>
  `/projects/storefront/sessions/initial/${view}?demo=agents${experimental ? "&channel=experimental" : ""}`

// A row's name is the file's, then who changed it when someone did.
const row = (name: string) =>
  page.getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}(,|$)`) })

const openFiles = async (
  view: "focus" | "grid" | "canvas" = "grid",
  experimental = false,
): Promise<void> => {
  await openWorkspace(storefront(view, experimental))
  await sidebarPanel("Files").click()
  await expect.element(page.getByRole("tree", { name: "Project files" })).toBeVisible()
}

describe("The project window", () => {
  for (const view of ["focus", "grid", "canvas"] as const) {
    context(`in the ${view} view`, () => {
      it("opens on a click on a file in Files, and the sidebar lists it by the file's name", async () => {
        await openFiles(view)

        await row("package.json").click()

        await expect.element(terminal("package.json")).toBeVisible()
        await sidebarPanel("Terminals").click()
        await expect.element(terminalTab("package.json")).toBeVisible()
      })
    })
  }

  it("still opens on a double-click, as before a click opened it", async () => {
    await openFiles()

    await row("package.json").dblClick()

    await expect.element(terminal("package.json")).toBeVisible()
    await sidebarPanel("Terminals").click()
    await expect.element(terminalTab("package.json")).toBeVisible()
  })

  it("opens on Enter on a file too", async () => {
    await openFiles()

    row("package.json").element().focus()
    await userEvent.keyboard("{Enter}")

    await expect.element(terminal("package.json")).toBeVisible()
  })

  it("leaves keyboard focus in the Files tree after Enter, so the next file opens from the keys", async () => {
    await openFiles()
    const tree = page.getByRole("tree", { name: "Project files" }).element()

    row("package.json").element().focus()
    await userEvent.keyboard("{Enter}")
    await expect.element(terminal("package.json")).toBeVisible()
    expect(tree.contains(document.activeElement)).toBe(true)

    await userEvent.keyboard("{ArrowDown}{Enter}")
    await expect.element(terminal("package.json")).not.toBeInTheDocument()
    expect(tree.contains(document.activeElement)).toBe(true)
  })

  it("is re-pointed by the next file opened: still one window, with the new file in it", async () => {
    await openFiles()
    await row("package.json").click()
    await expect.element(terminal("package.json")).toBeVisible()

    await row("index.html").click()

    await expect.element(terminal("index.html")).toBeVisible()
    await expect.element(terminal("package.json")).not.toBeInTheDocument()
    await sidebarPanel("Terminals").click()
    await expect.element(terminalTab("index.html")).toBeVisible()
    await expect.element(terminalTab("package.json")).not.toBeInTheDocument()
  })

  it("says under its name in the sidebar which folder the file is in, and nothing at the root", async () => {
    // The line under a tab's name, where a terminal's program goes.
    const line = (name: string) =>
      terminalTab(name)
        .element()
        .closest("[data-terminal-tab-id]")!
        .querySelector(".terminal-tab-process")!.textContent
    await openFiles()
    await row("CartItem.tsx").click()
    await expect.element(terminal("CartItem.tsx")).toBeVisible()
    await sidebarPanel("Terminals").click()
    await expect.element(terminalTab("CartItem.tsx")).toBeVisible()
    await expect.poll(() => line("CartItem.tsx")).toBe("src/cart")

    await sidebarPanel("Files").click()
    await row("package.json").click()
    await sidebarPanel("Terminals").click()
    await expect.element(terminalTab("package.json")).toBeVisible()
    await expect.poll(() => line("package.json")).toBe("")
  })

  it("reads a Markdown file as a document labelled by the file's name", async () => {
    await openFiles()

    await row("README.md").click()

    await expect.element(terminal("README.md")).toBeVisible()
    await expect
      .element(terminal("README.md").getByRole("textbox", { name: "README.md" }))
      .toBeVisible()
  })

  it("holds back a file that looks like a secret behind the gate", async () => {
    await openFiles()

    await row(".env.local").click()

    const window = terminal(".env.local")
    await expect.element(window.getByRole("button", { name: "Show it" })).toBeVisible()
    await expect.element(window.getByRole("button", { name: "Copy path" })).toBeVisible()
  })

  it("is made again by the next open once it has been closed", async () => {
    await openFiles()
    await row("package.json").click()
    await expect.element(terminal("package.json")).toBeVisible()
    await sidebarPanel("Terminals").click()
    const menu = await windowMenu("package.json")
    await menu.getByRole("menuitem", { name: "Close" }).click()
    await expect.element(terminal("package.json")).not.toBeInTheDocument()

    await sidebarPanel("Files").click()
    await row("index.html").click()

    await expect.element(terminal("index.html")).toBeVisible()
  })

  it("offers only Close in its menu: no rename, no dock back", async () => {
    await openFiles()
    await row("package.json").click()
    await sidebarPanel("Terminals").click()

    const menu = await windowMenu("package.json")

    await expect.element(menu.getByRole("menuitem", { name: "Close" })).toBeVisible()
    await expect.element(menu.getByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument()
    await expect.element(menu.getByRole("menuitem", { name: /^Dock in/ })).not.toBeInTheDocument()
  })
})

describe("Worktree diff in the project window", () => {
  const checkout = () => terminal("Checkout.tsx")
  const diff = () => checkout().getByRole("button", { name: "Worktree diff" })
  const editor = () => checkout().getByRole("textbox", { name: "Checkout.tsx" })
  const merge = (handle: string) => checkout().getByTitle(`Leave @${handle}'s work out`)
  const openCheckout = async (): Promise<void> => {
    await openFiles("grid", true)
    await row("Checkout.tsx").dblClick()
    await expect.element(merge("moth")).toBeVisible()
  }

  it("keeps an excluded agent out of the diff when the open file is clicked again", async () => {
    await openCheckout()
    await merge("moth").click()
    await row("Checkout.tsx").click()
    await expect.element(checkout().getByTitle("Merge @moth's work")).toBeVisible()
  })

  it("switches views in the same window with the mouse and keyboard, keeping the editor's selection", async () => {
    await openCheckout()
    const window = checkout().element()
    await expect.element(diff()).toHaveAttribute("aria-pressed", "true")
    await diff().click()
    await expect.element(editor()).toBeVisible()
    editor().element().focus()
    await userEvent.keyboard("{Home}{Shift>}{ArrowRight}{ArrowRight}{/Shift}")
    await expect.poll(() => document.getSelection()?.toString()).toBe("im")

    const toggle = diff().element() as HTMLElement
    toggle.focus()
    await userEvent.keyboard("{Enter}")
    await expect.element(diff()).toHaveFocus()
    await expect.element(merge("moth")).toBeVisible()
    await userEvent.keyboard(" ")

    await expect.element(diff()).toHaveAttribute("aria-pressed", "false")
    await expect.element(editor()).toBeVisible()
    editor().element().focus()
    await expect.poll(() => document.getSelection()?.toString()).toBe("im")
    expect(checkout().element()).toBe(window)

    await chooseView("Focus")
    await expect.element(diff()).toHaveAttribute("aria-pressed", "false")
    await expect.element(editor()).toBeVisible()

    await row("package.json").dblClick()
    await expect
      .element(terminal("package.json").getByRole("textbox", { name: "package.json" }))
      .toBeVisible()
    await expect
      .element(page.getByRole("button", { name: "Worktree diff" }))
      .not.toBeInTheDocument()
  })

  it("refreshes open diffs and returns to the file when the worktrees close", async () => {
    await openCheckout()
    worktreeDiff.clash()
    await expect.element(merge("owl")).toBeVisible()

    const toggle = diff().element() as HTMLElement
    toggle.focus()
    worktreeDiff.closeWorks("storefront")

    await expect.element(editor()).toBeVisible()
    await expect.element(diff()).not.toBeInTheDocument()
    expect(checkout().element().contains(document.activeElement)).toBe(true)
  })

  it("keeps the file available when a diff read fails and lets the person retry", async () => {
    await openCheckout()
    await diff().click()
    const failed = worktreeDiff.fault("failed")
    await diff().click()
    await failed

    await expect.element(checkout().getByText("Couldn't read the worktree diff.")).toBeVisible()
    await expect.element(editor()).toBeVisible()
    await expect.element(diff()).toHaveAttribute("aria-pressed", "false")
    await diff().click()
    await expect.element(merge("moth")).toBeVisible()
  })

  it("ignores a late diff after the project window opens another file", async () => {
    await openCheckout()
    await diff().click()
    const read = worktreeDiff.fault("slow")
    await diff().click()
    await expect.element(checkout().getByText("Reading worktree diff…")).toBeVisible()

    await row("package.json").dblClick()
    await read

    await expect
      .element(terminal("package.json").getByRole("textbox", { name: "package.json" }))
      .toBeVisible()
    await expect
      .element(page.getByRole("button", { name: "Worktree diff" }))
      .not.toBeInTheDocument()
  })

  it("opens a read-only file view when the file exists only in a worktree", async () => {
    await openFiles("grid", true)
    await row("OrderSummary.tsx").dblClick()
    const window = terminal("OrderSummary.tsx")
    const switcher = window.getByRole("button", { name: "Worktree diff" })
    await expect.element(switcher).toHaveAttribute("aria-pressed", "true")
    await switcher.click()
    await expect.element(window.getByText("Read-only copy from an agent worktree.")).toBeVisible()
    await expect
      .element(window.getByText("type Props = { items: CartItem[]; total: number }"))
      .toBeVisible()
    await expect.element(window.getByRole("textbox")).not.toBeInTheDocument()
  })
})
