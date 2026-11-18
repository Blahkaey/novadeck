import { page, userEvent } from "vitest/browser"

import { fileEdits } from "../support/backend"
import { isMac, openWorkspace, sidebarPanel, terminal } from "../support/workspace"
import { describe, expect, it } from "../test"

// A file opened from the agents demo's Files panel is edited in the project window and saved
// in the demo's memory, as the runner saves it to disk. `&fileFault=` puts the first file the
// window opens in one of the debug panel's File editing faults.
const storefront = (fault?: string): string =>
  `/projects/storefront/sessions/initial/grid?demo=agents${fault ? `&fileFault=${fault}` : ""}`

// A row's name is the file's, then who changed it when someone did.
const row = (name: string) =>
  page.getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}(,|$)`) })

// The chord of the key `key` with the editor's Mod, Cmd on a Mac and Ctrl elsewhere.
const mod = (key: string): string =>
  isMac() ? `{Meta>}${key}{/Meta}` : `{Control>}${key}{/Control}`

// The editor the project window shows the file `name` in.
const editor = (name: string) => terminal(name).getByRole("textbox", { name })

const editorText = (name: string): string => editor(name).element().textContent ?? ""

// Opens the storefront's Files panel, as the address asks, and `name` from it in the project
// window, its editor focused at the file's start. The editor opens where the same window last
// left the file, as an earlier spec in this page may have, so the cursor is put at the start.
const openFile = async (name: string, fault?: string): Promise<void> => {
  await openWorkspace(storefront(fault))
  await sidebarPanel("Files").click()
  await row(name).dblClick()
  await expect.element(editor(name)).toBeVisible()
  editor(name).element().focus()
  await userEvent.keyboard(mod("{Home}"))
}

// As `openFile`, then types `text` there.
const typeInto = async (name: string, text: string, fault?: string): Promise<void> => {
  await openFile(name, fault)
  await userEvent.keyboard(text)
  await expect.poll(() => editorText(name)).toContain(text)
}

describe("A file opened from Files", () => {
  it("keeps what the person typed and saved with Ctrl+S (Cmd+S on a Mac) when they come back to it", async () => {
    await typeInto("package.json", "Draft ")
    await userEvent.keyboard(mod("s"))
    // Saved before another file opens, which would save it first.
    await expect.poll(() => fileEdits.text("storefront", "package.json")).toContain("Draft {")

    await row("index.html").dblClick()
    await expect.element(editor("index.html")).toBeVisible()
    await row("package.json").dblClick()

    await expect.element(editor("package.json")).toBeVisible()
    await expect.poll(() => editorText("package.json")).toContain("Draft {")
  })

  it("collapses a selection on Escape, and closes nothing", async () => {
    await openFile("package.json")
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}")
    const content = editor("package.json").element()
    await expect.poll(() => document.getSelection()?.isCollapsed).toBe(false)

    await userEvent.keyboard("{Escape}")

    await expect.poll(() => document.getSelection()?.isCollapsed).toBe(true)
    expect(content.contains(document.activeElement)).toBe(true)
    await expect.element(terminal("package.json")).toBeVisible()
    await expect.element(page.getByRole("tree", { name: "Project files" })).toBeVisible()
  })

  it("merges an agent's rewrite into edits not saved yet, marking the agent's lines", async () => {
    await typeInto("package.json", "Draft ", "failing")
    const window = terminal("package.json")
    await expect.element(window.getByText("Not saved yet. Trying again.")).toBeVisible()

    fileEdits.rewrite("storefront", "package.json")

    await expect
      .element(window.getByText("The marked lines changed while you edited."))
      .toBeVisible()
    expect(editorText("package.json")).toContain("Draft {")
    const marked = [...window.element().querySelectorAll(".cm-editor-marked")]
    expect(marked.map((line) => line.textContent)).toEqual([
      "// An agent's change 1: it rewrote this part,",
      "// leaving the lines around it as they were.",
    ])
  })

  it("says why a save was refused, keeping the edits, with Copy my edits and Try saving again", async () => {
    await typeInto("package.json", "Draft ", "refuse-folder")
    const window = terminal("package.json")
    const refused = window.getByText(
      "Novadeck can't write to this file or its folder, so your edits can't be saved. Your edits are kept here until you close this file.",
    )
    await expect.element(refused).toBeVisible()
    await expect.element(window.getByRole("button", { name: "Copy my edits" })).toBeVisible()

    // The refusal was the next save's only: trying again saves.
    await window.getByRole("button", { name: "Try saving again" }).click()

    await expect.element(refused).not.toBeInTheDocument()
    expect(editorText("package.json")).toContain("Draft {")
  })

  it("asks before another file replaces edits it can't save, and Cancel keeps the editor", async () => {
    await typeInto("package.json", "Draft ", "refuse-folder")
    // Refused, the edits can't be saved: the question comes at once.
    await expect
      .element(terminal("package.json").getByRole("button", { name: "Try saving again" }))
      .toBeVisible()

    await row("index.html").dblClick()

    const dialog = page.getByRole("alertdialog")
    await expect
      .element(dialog.getByText(/^Your edits to package\.json couldn't be saved/))
      .toBeVisible()
    await expect
      .element(dialog.getByRole("button", { name: "Copy my edits and switch" }))
      .toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()

    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(editor("package.json")).toBeVisible()
    expect(editorText("package.json")).toContain("Draft {")
    await expect.element(terminal("index.html")).not.toBeInTheDocument()
  })

  it("shows it waits on saves that keep failing before another file opens, and Cancel keeps the editor", async () => {
    await typeInto("package.json", "Draft ", "failing")

    await row("index.html").dblClick()

    // Its saves are tried again; after 2 s the question shows it waits on them.
    const dialog = page.getByRole("alertdialog")
    await expect.element(dialog.getByText("Saving your edits to package.json…")).toBeVisible()
    const answers = [...dialog.element().querySelectorAll("button")]
    expect(answers.map((each) => each.textContent)).toEqual(["Cancel"])
    await dialog.getByRole("button", { name: "Cancel" }).click()

    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(editor("package.json")).toBeVisible()
    expect(editorText("package.json")).toContain("Draft {")
    await expect.element(terminal("index.html")).not.toBeInTheDocument()
  })
})
