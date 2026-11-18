import {
  emptyCompanions,
  PlanUnwritableError,
  type Companions,
  type ItemContent,
  type PlanSaved,
  type PlanUnwritableReason,
} from "@novadeck/core/items"
import { itemFixture, workspaceFixture } from "@novadeck/core/testing"
import type { CompanionWindowMeta, Workspace } from "@novadeck/core/types"
import { createItemStore } from "@novadeck/items/store"
import { afterEach, vi } from "vitest"

import { context, describe, expect, it } from "../../test"
import { openCommands } from "../../test/commands"
import { quietMs } from "./file-edits"

const stops: (() => void)[] = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  vi.useRealTimers()
})

const at = (session: string, projectId = "project") => ({
  projectId,
  workspaceSessionId: session,
})
const cart = "~/project/src/cart.ts"
// The project window of the session `session`.
const windowIn = (session: string): CompanionWindowMeta => ({
  id: `window-${session}`,
  home: "project",
  itemId: itemFixture(`shown-${session}`, "01").id,
  name: "cart.ts",
  titleSource: { kind: "default" },
})
// The file the project window of the session `session` shows, pointed at `path` (absolute).
const shownAt = (session: string, path: string, version = 1) =>
  itemFixture(`shown-${session}`, "01", {
    kind: "file",
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    holder: { windowId: windowIn(session).id },
    version,
  })
const window = windowIn("initial")

// Two projects: `project`, of the sessions `initial` and `other`, and `second`, of `elsewhere`.
const twoProjects = (): Workspace => {
  const base = workspaceFixture({ sessions: ["initial", "other"] })
  const project = base.projects[0]!
  return {
    ...base,
    projects: [
      project,
      {
        ...project,
        id: "second",
        name: "Second",
        directory: "~/second",
        activeSessionId: "elsewhere",
        history: [{ ...project.history[0]!, id: "elsewhere", name: "elsewhere" }],
      },
    ],
  }
}

// A backend that opens each file asked in the project window of the session that asks,
// reports the file each shows whole, and answers saves when the test says so; the project's
// folder is `~/project`.
const backend = () => {
  const opened: string[] = []
  const saves: {
    readonly session: string
    readonly text: string
    readonly path: string | undefined
    readonly answer: (result: PlanSaved) => void
    readonly refuse: (reason: PlanUnwritableReason) => void
    readonly fail: () => void
  }[] = []
  const reports = new Map<string, (content: ItemContent) => void>()
  let version = 0
  const companions: Companions = {
    ...emptyCompanions(),
    follow: (target, _id, _options, on) => {
      reports.set(target.workspaceSessionId, on)
      return () => {}
    },
    save: (target, _id, text, _basedOn, path) =>
      new Promise((resolve, reject) =>
        saves.push({
          session: target.workspaceSessionId,
          text,
          path,
          answer: resolve,
          refuse: (reason) => reject(new PlanUnwritableError(reason)),
          fail: () => reject(new Error("The runner went away")),
        }),
      ),
    openInProject: (target, path) => {
      opened.push(path)
      version += 1
      return Promise.resolve({
        item: shownAt(target.workspaceSessionId, path, version),
        window: windowIn(target.workspaceSessionId),
      })
    },
  }
  const report = (content: ItemContent, session = "initial") => reports.get(session)?.(content)
  return { companions, opened, saves, report }
}

const read = (path: string, text = "a\n"): ItemContent => ({
  state: "ready",
  stamp: "1",
  content: { kind: "text", path, text, writable: true },
})

// The project window showing `~/project/src/cart.ts`, edited and not saved yet, in the app
// started on `workspace`.
const editing = async (workspace?: Workspace) => {
  const { companions, opened, saves, report } = backend()
  const app = openCommands({
    ...(workspace && { workspace }),
    companions,
    itemStore: (store) => createItemStore({ companions, workspace: store }),
  })
  const itemStore = app.context.itemStore!
  stops.push(itemStore.connect())
  await app.commands.openProjectFile("src/cart.ts")
  itemStore.watch(at("initial"), window.itemId, { edit: true })
  report(read(cart))
  itemStore.file(at("initial"), window.itemId, cart).edit("a\nb\n")
  opened.length = 0
  const asked = () => app.ui.getSnapshot().leaving
  // The project window of the session `session` of the project `projectId` showing
  // `~/project/src/cart.ts` too, with edits not saved yet.
  const editingIn = (session: string, projectId = "project") => {
    const target = at(session, projectId)
    const item = shownAt(session, cart)
    app.workspace.transact([
      { type: "item/upsert", target, item },
      { type: "window/upsert", target, window: windowIn(session) },
    ])
    itemStore.watch(target, item.id, { edit: true })
    report(read(cart), session)
    itemStore.file(target, item.id, cart).edit(`a\n${session}\n`)
  }
  // The windows of the session `session`, while there is one.
  const windowsIn = (session: string) =>
    app.workspace
      .getSnapshot()
      .projects.flatMap((project) => project.history)
      .find((each) => each.id === session)
      ?.state.roster.windows.map((each) => each.id)
  const projects = () => app.workspace.getSnapshot().projects.map((each) => each.id)
  return { app, itemStore, opened, saves, report, asked, editingIn, windowsIn, projects }
}

describe("leaving the file the project window shows", () => {
  context("when the person opens another file", () => {
    it("saves the edits, and opens the next file once they're in the file", async () => {
      const { app, opened, saves } = await editing()
      const opening = app.commands.openProjectFile("src/total.ts")
      expect(saves.map(({ text, path }) => ({ text, path }))).toEqual([
        { text: "a\nb\n", path: cart },
      ])
      expect(opened).toEqual([])
      saves[0]!.answer({ saved: true, stamp: "2" })
      await opening
      expect(opened).toEqual(["~/project/src/total.ts"])
    })

    it("opens the same file again without waiting", async () => {
      const { app, opened, saves } = await editing()
      await app.commands.openProjectFile("src/cart.ts")
      expect(saves).toEqual([])
      expect(opened).toEqual([cart])
    })

    it("asks first where the edits can't be saved, and stays when the person cancels", async () => {
      const { app, opened, saves, asked } = await editing()
      const opening = app.commands.openProjectFile("src/total.ts")
      saves[0]!.refuse("folder")
      await vi.waitFor(() =>
        expect(asked()).toMatchObject({ name: "cart.ts", path: cart, action: "switch" }),
      )
      app.commands.answerLeave(asked()!, false)
      await opening
      expect(asked()).toBeNull()
      expect(opened).toEqual([])
    })

    it("lets the edits go and opens it once the person copied them", async () => {
      const { app, itemStore, opened, saves, asked } = await editing()
      const opening = app.commands.openProjectFile("src/total.ts")
      saves[0]!.refuse("folder")
      await vi.waitFor(() => expect(asked()).not.toBeNull())
      expect(itemStore.fileEdits(window.itemId, cart)).toBe("a\nb\n")
      app.commands.answerLeave(asked()!, true)
      await opening
      expect(opened).toEqual(["~/project/src/total.ts"])
      expect(itemStore.store.getSnapshot().files).toEqual({})
      expect(saves).toHaveLength(1)
    })
  })

  context("when its save takes a while", () => {
    // Lets what the timers and saves set off run, the clock where it is.
    const settle = () => vi.advanceTimersByTimeAsync(0)

    it("shows nothing while the save lands within 2 seconds", async () => {
      vi.useFakeTimers()
      const { app, opened, saves, asked } = await editing()
      const opening = app.commands.openProjectFile("src/total.ts")
      await vi.advanceTimersByTimeAsync(quietMs - 1)
      expect(asked()).toBeNull()
      saves[0]!.answer({ saved: true, stamp: "2" })
      await opening
      expect(asked()).toBeNull()
      expect(opened).toEqual(["~/project/src/total.ts"])
    })

    it("shows it waits on the save after 2 seconds, and goes on by itself once it lands", async () => {
      vi.useFakeTimers()
      const { app, opened, saves, asked } = await editing()
      const opening = app.commands.openProjectFile("src/total.ts")
      // It fails once, and the store tries it again 2 s on.
      saves[0]!.fail()
      await vi.advanceTimersByTimeAsync(Math.max(quietMs, 2000))
      expect(asked()).toEqual({
        itemId: window.itemId,
        path: cart,
        name: "cart.ts",
        action: "switch",
        waiting: true,
      })
      expect(opened).toEqual([])
      expect(saves.map(({ text }) => text)).toEqual(["a\nb\n", "a\nb\n"])
      saves[1]!.answer({ saved: true, stamp: "2" })
      await opening
      expect(asked()).toBeNull()
      expect(opened).toEqual(["~/project/src/total.ts"])
    })

    it("turns into the question once the save is refused", async () => {
      vi.useFakeTimers()
      const { app, saves, asked } = await editing()
      void app.commands.openProjectFile("src/total.ts")
      await vi.advanceTimersByTimeAsync(quietMs)
      expect(asked()).toMatchObject({ waiting: true })
      saves[0]!.refuse("folder")
      await settle()
      expect(asked()).toMatchObject({ path: cart, action: "switch", waiting: false })
    })

    it("turns into the question once nothing settled within a save's own time", async () => {
      vi.useFakeTimers()
      const { app, saves, asked } = await editing()
      void app.commands.openProjectFile("src/total.ts")
      await vi.advanceTimersByTimeAsync(19_999)
      expect(asked()).toMatchObject({ waiting: true })
      await vi.advanceTimersByTimeAsync(1)
      expect(asked()).toMatchObject({ action: "switch", waiting: false })
      expect(saves).toHaveLength(1)
    })

    it("stays when the person cancels while it waits, and doesn't go on once the save lands", async () => {
      vi.useFakeTimers()
      const { app, opened, saves, asked } = await editing()
      const opening = app.commands.openProjectFile("src/total.ts")
      await vi.advanceTimersByTimeAsync(quietMs)
      app.commands.answerLeave(asked()!, false)
      await opening
      expect(asked()).toBeNull()
      saves[0]!.answer({ saved: true, stamp: "2" })
      await settle()
      expect(asked()).toBeNull()
      expect(opened).toEqual([])
      expect(app.state().roster.windows.map((each) => each.id)).toEqual([window.id])
    })

    it("asks nothing once the person cancelled while it waited, though the save is then refused", async () => {
      vi.useFakeTimers()
      const { app, saves, asked } = await editing()
      const opening = app.commands.openProjectFile("src/total.ts")
      await vi.advanceTimersByTimeAsync(quietMs)
      app.commands.answerLeave(asked()!, false)
      await opening
      saves[0]!.refuse("folder")
      await settle()
      expect(asked()).toBeNull()
    })
  })

  context("while the question is up", () => {
    it("lets an answer to a question no longer up count for nothing", async () => {
      const { app, saves, asked } = await editing()
      const opening = app.commands.openProjectFile("src/total.ts")
      saves[0]!.refuse("folder")
      await vi.waitFor(() => expect(asked()).not.toBeNull())
      const first = asked()!
      app.commands.answerLeave({ ...first }, true)
      expect(asked()).toBe(first)
      app.commands.answerLeave(first, false)
      await opening
      expect(asked()).toBeNull()
    })

    it("stays where the person was for a question another took the place of", async () => {
      const { app, opened, saves, asked } = await editing()
      const opening = app.commands.openProjectFile("src/total.ts")
      saves[0]!.refuse("folder")
      await vi.waitFor(() => expect(asked()).toMatchObject({ action: "switch" }))
      const deleting = app.commands.saveBeforeChange("project", "src/cart.ts", "delete")
      await vi.waitFor(() => expect(asked()).toMatchObject({ action: "delete" }))
      await opening
      expect(opened).toEqual([])
      app.commands.answerLeave(asked()!, true)
      await expect(deleting).resolves.toBe(true)
    })

    it("copies and lets go of the edits made at the path asked about, the item pointed elsewhere since", async () => {
      const { app, itemStore, report, saves, asked } = await editing()
      void app.commands.saveBeforeChange("project", "src/cart.ts", "delete")
      saves[0]!.refuse("folder")
      await vi.waitFor(() => expect(asked()).toMatchObject({ path: cart }))
      const total = "~/project/src/total.ts"
      app.workspace.transact([
        { type: "item/upsert", target: at("initial"), item: shownAt("initial", total, 9) },
      ])
      report(read(total, "t\n"))
      itemStore.file(at("initial"), window.itemId, total).edit("t\nT\n")
      const ask = asked()!
      expect(itemStore.fileEdits(ask.itemId, ask.path)).toBe("a\nb\n")
      app.commands.answerLeave(ask, true)
      await vi.waitFor(() => expect(asked()).toBeNull())
      expect(itemStore.fileEdits(ask.itemId, ask.path)).toBeUndefined()
      expect(itemStore.fileEdits(window.itemId, total)).toBe("t\nT\n")
    })
  })

  context("when the person closes the window", () => {
    it("saves the edits first, then closes it", async () => {
      const { app, saves } = await editing()
      app.commands.close(window.id)
      expect(app.state().roster.windows.map((each) => each.id)).toEqual([window.id])
      saves[0]!.answer({ saved: true, stamp: "2" })
      await vi.waitFor(() => expect(app.state().roster.windows).toEqual([]))
    })

    it("asks first where the edits can't be saved, and keeps it when the person stays", async () => {
      const { app, saves, asked } = await editing()
      app.commands.close(window.id)
      saves[0]!.refuse("not-text")
      await vi.waitFor(() => expect(asked()).toMatchObject({ action: "close" }))
      app.commands.answerLeave(asked()!, false)
      await vi.waitFor(() => expect(asked()).toBeNull())
      expect(app.state().roster.windows.map((each) => each.id)).toEqual([window.id])
    })

    it("closes it once the person goes on", async () => {
      const { app, saves, asked } = await editing()
      app.commands.close(window.id)
      saves[0]!.refuse("not-text")
      await vi.waitFor(() => expect(asked()).not.toBeNull())
      app.commands.answerLeave(asked()!, true)
      await vi.waitFor(() => expect(app.state().roster.windows).toEqual([]))
    })

    it("closes it in the session it was asked in, the person in another by then", async () => {
      const { app, saves, windowsIn } = await editing(
        workspaceFixture({ sessions: ["initial", "other"] }),
      )
      app.commands.close(window.id)
      app.commands.switchSession("other")
      saves[0]!.answer({ saved: true, stamp: "2" })
      await vi.waitFor(() => expect(windowsIn("initial")).toEqual([]))
      expect(app.workspace.getSnapshot().projects[0]!.activeSessionId).toBe("other")
    })

    it("closes nothing where the window went meanwhile", async () => {
      const { app, saves } = await editing()
      app.commands.close(window.id)
      app.workspace.transact([{ type: "item/close", target: at("initial"), itemId: window.itemId }])
      const after = app.workspace.getSnapshot()
      saves[0]!.answer({ saved: true, stamp: "2" })
      await vi.waitFor(() => expect(app.context.itemStore!.store.getSnapshot().files).toEqual({}))
      expect(app.workspace.getSnapshot()).toBe(after)
    })
  })

  context("when the person renames, moves or deletes the file or a folder holding it", () => {
    it("saves the edits first", async () => {
      const { app, saves } = await editing()
      const renaming = app.commands.saveBeforeChange("project", "src/cart.ts", "rename")
      expect(saves).toHaveLength(1)
      saves[0]!.answer({ saved: true, stamp: "2" })
      await expect(renaming).resolves.toBe(true)
    })

    it("saves the edits to a file inside a folder first", async () => {
      const { app, saves } = await editing()
      const moving = app.commands.saveBeforeChange("project", "src", "move")
      saves[0]!.answer({ saved: true, stamp: "2" })
      await expect(moving).resolves.toBe(true)
    })

    it("goes on at once for another file, one beside the folder's name too", async () => {
      const { app, saves } = await editing()
      await expect(app.commands.saveBeforeChange("project", "src/car", "delete")).resolves.toBe(
        true,
      )
      expect(saves).toEqual([])
    })

    it("asks first where the edits can't be saved, and doesn't go on when the person stays", async () => {
      const { app, saves, asked } = await editing()
      const deleting = app.commands.saveBeforeChange("project", "src/cart.ts", "delete")
      saves[0]!.refuse("folder")
      await vi.waitFor(() => expect(asked()).toMatchObject({ action: "delete" }))
      app.commands.answerLeave(asked()!, false)
      await expect(deleting).resolves.toBe(false)
    })

    it("asks of each session's window in turn, and stops at the first the person stays for", async () => {
      const { app, saves, asked, editingIn } = await editing(
        workspaceFixture({ sessions: ["initial", "other"] }),
      )
      editingIn("other")
      const deleting = app.commands.saveBeforeChange("project", "src/cart.ts", "delete")
      expect(saves.map(({ session }) => session)).toEqual(["initial"])
      saves[0]!.refuse("folder")
      await vi.waitFor(() => expect(asked()).not.toBeNull())
      app.commands.answerLeave(asked()!, false)
      await expect(deleting).resolves.toBe(false)
      expect(saves.map(({ session }) => session)).toEqual(["initial"])
    })

    it("goes on to the next session's window once the person goes on", async () => {
      const { app, saves, asked, editingIn } = await editing(
        workspaceFixture({ sessions: ["initial", "other"] }),
      )
      editingIn("other")
      const deleting = app.commands.saveBeforeChange("project", "src/cart.ts", "delete")
      saves[0]!.refuse("folder")
      await vi.waitFor(() => expect(asked()).not.toBeNull())
      app.commands.answerLeave(asked()!, true)
      await vi.waitFor(() =>
        expect(saves.map(({ session }) => session)).toEqual(["initial", "other"]),
      )
      saves[1]!.answer({ saved: true, stamp: "2" })
      await expect(deleting).resolves.toBe(true)
    })
  })

  context("when the person removes a session", () => {
    it("saves the edits to its window's file first, then removes it", async () => {
      const { app, saves, editingIn, windowsIn } = await editing(
        workspaceFixture({ sessions: ["initial", "other"] }),
      )
      editingIn("other")
      app.commands.removeSession("other")
      expect(saves.map(({ session }) => session)).toEqual(["other"])
      expect(windowsIn("other")).toEqual([windowIn("other").id])
      saves[0]!.answer({ saved: true, stamp: "2" })
      await vi.waitFor(() => expect(windowsIn("other")).toBeUndefined())
    })

    it("keeps it where the edits can't be saved and the person stays", async () => {
      const { app, saves, asked, editingIn, windowsIn } = await editing(
        workspaceFixture({ sessions: ["initial", "other"] }),
      )
      editingIn("other")
      app.commands.removeSession("other")
      saves[0]!.refuse("folder")
      await vi.waitFor(() => expect(asked()).toMatchObject({ action: "close" }))
      app.commands.answerLeave(asked()!, false)
      await vi.waitFor(() => expect(asked()).toBeNull())
      expect(windowsIn("other")).toEqual([windowIn("other").id])
    })

    it("removes it at once where nothing is left to save", async () => {
      const { app, saves, windowsIn } = await editing(
        workspaceFixture({ sessions: ["initial", "other"] }),
      )
      app.commands.removeSession("other")
      expect(saves).toEqual([])
      expect(windowsIn("other")).toBeUndefined()
    })
  })

  context("when the person removes a project", () => {
    it("asks of each of its sessions' windows in turn, and keeps it when the person stays", async () => {
      const { app, saves, asked, editingIn, projects } = await editing(twoProjects())
      editingIn("other")
      app.commands.removeProject("project")
      expect(saves.map(({ session }) => session)).toEqual(["initial"])
      saves[0]!.answer({ saved: true, stamp: "2" })
      await vi.waitFor(() =>
        expect(saves.map(({ session }) => session)).toEqual(["initial", "other"]),
      )
      saves[1]!.refuse("folder")
      await vi.waitFor(() => expect(asked()).not.toBeNull())
      app.commands.answerLeave(asked()!, false)
      await vi.waitFor(() => expect(asked()).toBeNull())
      expect(projects()).toEqual(["project", "second"])
    })

    it("removes it once the edits are in their files", async () => {
      const { app, saves, projects } = await editing(twoProjects())
      app.commands.removeProject("project")
      saves[0]!.answer({ saved: true, stamp: "2" })
      await vi.waitFor(() => expect(projects()).toEqual(["second"]))
    })
  })
})
