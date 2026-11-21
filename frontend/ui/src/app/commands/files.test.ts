import { emptyCompanions, type Companions } from "@novadeck/core/items"
import { activeSession, createTerminalState, createWorkspaceSession } from "@novadeck/core/state"
import { itemFixture } from "@novadeck/core/testing"
import type { CompanionWindowMeta } from "@novadeck/core/types"

import { context, describe, expect, it } from "../../test"
import { openCommands } from "../../test/commands"

const readme = itemFixture("readme", "01", {
  kind: "file",
  name: "README.md",
  path: "/p/README.md",
  holder: { windowId: "session-1" },
})
const windowOf = (id: string, name: string): CompanionWindowMeta => ({
  id,
  home: "project",
  itemId: readme.id,
  name,
  titleSource: { kind: "default" },
})

// A backend whose project window holds one file, and what it was asked to open.
const open = (openInProject?: Companions["openInProject"], url?: string) => {
  const asked: { path: string; windowId: string }[] = []
  const companions: Companions = {
    ...emptyCompanions(),
    ...(openInProject && {
      openInProject: (target, path, windowId) => (
        asked.push({ path, windowId }),
        openInProject(target, path, windowId)
      ),
    }),
  }
  const app = openCommands({ companions, ...(url ? { url } : {}) })
  return { ...app, asked }
}

const target = { projectId: "project", workspaceSessionId: "initial" }
const reply = () => Promise.resolve({ item: readme, window: windowOf("session-1", "README.md") })

describe("files commands", () => {
  context("when opening a folder in the pane", () => {
    const attaching = (attach?: Companions["attach"]) => {
      const asked: { terminalId: string; path: string }[] = []
      const companions: Companions = {
        ...emptyCompanions(),
        ...(attach && {
          attach: (to, terminalId, path) => (
            asked.push({ terminalId, path }),
            attach(to, terminalId, path)
          ),
        }),
      }
      return { ...openCommands({ companions }), asked }
    }
    const folder = itemFixture("folder", "01", { kind: "folder", name: "src", path: "/p/src" })

    it("attaches it to the selected terminal by its absolute path", async () => {
      const app = attaching(async () => folder)
      await app.commands.openFolderInPane("src")
      expect(app.asked).toEqual([{ terminalId: "01", path: "~/project/src" }])
    })

    it("does nothing where the backend can't attach", async () => {
      const app = attaching()
      await expect(app.commands.openFolderInPane("src")).resolves.toBeUndefined()
      expect(app.asked).toEqual([])
    })

    it("lets the rejection stand when the backend can't open it", async () => {
      const app = attaching(() => Promise.reject(new Error("no such folder")))
      await expect(app.commands.openFolderInPane("gone")).rejects.toThrow("no such folder")
    })
  })

  context("when opening a file", () => {
    it("opens it in a new project window by its absolute path, selected", async () => {
      const app = open(reply)
      await app.commands.openProjectFile("README.md")
      expect(app.asked).toEqual([{ path: "~/project/README.md", windowId: "session-1" }])
      expect(app.state().selected).toBe("session-1")
      expect(app.state().roster.windows.map((each) => each.name)).toEqual(["README.md"])
    })

    it("has the window preview what the agents' work merges to when asked, and show main's copy otherwise", async () => {
      const app = open(reply)
      await app.commands.openProjectFile("README.md", { preview: true })
      const [first] = Object.values(app.ui.getSnapshot().filePreviews)
      expect(first).toMatchObject({
        itemId: readme.id,
        projectId: "project",
        path: "README.md",
        showDiff: true,
      })
      await app.commands.openProjectFile("README.md", { preview: true })
      // Each open starts the preview over.
      expect(Object.values(app.ui.getSnapshot().filePreviews)[0]!.opened).not.toBe(first!.opened)
      await app.commands.openProjectFile("README.md")
      expect(Object.values(app.ui.getSnapshot().filePreviews)[0]).toMatchObject({
        path: "README.md",
        showDiff: false,
      })
    })

    it("keeps the preview going when asked to keep it and the window already previews the file", async () => {
      const app = open(reply)
      await app.commands.openProjectFile("README.md", { preview: true })
      const [first] = Object.values(app.ui.getSnapshot().filePreviews)

      await app.commands.openProjectFile("README.md", { preview: true, keep: true })

      expect(Object.values(app.ui.getSnapshot().filePreviews)[0]).toBe(first)
    })

    it("opens an agent's copy instead where main lacks the file", async () => {
      let refuse = true
      const app = open((_target, path) => {
        if (refuse && path === "~/project/new.ts") return Promise.reject(new Error("no such file"))
        return reply()
      })
      await app.commands.openProjectFile("new.ts", { preview: true, copy: "/w/new.ts" })
      expect(app.asked.map((each) => each.path)).toEqual(["~/project/new.ts", "/w/new.ts"])
      expect(Object.values(app.ui.getSnapshot().filePreviews)[0]).toMatchObject({
        path: "new.ts",
        backed: true,
      })
      // Without a copy the rejection stands.
      refuse = true
      await expect(app.commands.openProjectFile("new.ts")).rejects.toThrow("no such file")
    })

    it("needs no terminal open", async () => {
      const app = open(reply)
      for (const { id } of app.state().roster.terminals) app.commands.close(id)
      await app.commands.openProjectFile("README.md")
      expect(app.state().roster.windows.map((each) => each.id)).toEqual(["session-1"])
    })

    it("keeps the person in the panel it was opened from", async () => {
      const app = open(reply)
      app.navigation.go({ panel: "files" })
      await app.commands.openProjectFile("README.md")
      expect(app.ui.getSnapshot().location.route.panel).toBe("files")
    })

    it("re-points the window it already has, which stays one", async () => {
      let name = "README.md"
      const app = open(() =>
        Promise.resolve({ item: { ...readme, name }, window: windowOf("session-1", name) }),
      )
      await app.commands.openProjectFile("README.md")
      name = "notes.md"
      await app.commands.openProjectFile("notes.md")
      expect(app.state().roster.windows.map((each) => each.name)).toEqual(["notes.md"])
      expect(app.state().selected).toBe("session-1")
    })

    it("puts the window in the session it was opened for, not the one the person moved to", async () => {
      let answer!: () => void
      const app = open(
        () =>
          new Promise(
            (resolve) =>
              (answer = () =>
                resolve({ item: readme, window: windowOf("session-1", "README.md") })),
          ),
      )
      const opening = app.commands.openProjectFile("README.md")
      app.workspace.dispatch({
        type: "session/add",
        projectId: "project",
        session: createWorkspaceSession(
          { name: "Other", state: createTerminalState([], "grid", "grid") },
          { id: "other", now: 2 },
        ),
      })
      expect(activeSession(app.workspace.getSnapshot())!.id).toBe("other")
      answer()
      await opening
      expect(app.state().roster.windows).toEqual([])
      expect(app.state().items).toEqual([])
      const project = app.workspace.getSnapshot().projects.find((each) => each.id === "project")!
      const first = project.history.find((session) => session.id === "initial")!
      expect(first.state.roster.windows.map((each) => each.id)).toEqual(["session-1"])
      expect(first.state.items).toEqual([readme])
    })

    it("does not bring back the window the person closed while the file was read", async () => {
      let answer!: () => void
      let reading = false
      const app = open(() =>
        reading
          ? new Promise(
              (resolve) =>
                (answer = () =>
                  resolve({ item: readme, window: windowOf("session-1", "README.md") })),
            )
          : reply(),
      )
      await app.commands.openProjectFile("README.md")
      reading = true
      const opening = app.commands.openProjectFile("notes.md")
      app.workspace.dispatch({
        type: "item/close",
        target,
        itemId: readme.id,
      })
      expect(app.state().roster.windows).toEqual([])
      answer()
      await opening
      expect(app.state().roster.windows).toEqual([])
      expect(app.state().items).toEqual([])
      expect(app.state().selected).not.toBe("session-1")
    })

    it("opens and selects a window the backend made anew after another client closed the old one", async () => {
      let answer!: () => void
      let reading = false
      const fresh = { ...readme, id: itemFixture("fresh", "01").id, name: "notes.md" }
      // The backend makes the window under the id the open asked for.
      const app = open((_target, _path, windowId) =>
        reading
          ? new Promise(
              (resolve) =>
                (answer = () =>
                  resolve({
                    item: fresh,
                    window: { ...windowOf(windowId, "notes.md"), itemId: fresh.id },
                  })),
            )
          : reply(),
      )
      await app.commands.openProjectFile("README.md")
      reading = true
      const opening = app.commands.openProjectFile("notes.md")
      app.workspace.dispatch({ type: "item/close", target, itemId: readme.id })
      answer()
      await opening
      expect(app.state().roster.windows.map((each) => each.id)).toEqual(["session-2"])
      expect(app.state().selected).toBe("session-2")
      expect(app.ui.getSnapshot().created).toMatchObject({ id: "session-2" })
    })

    it("places the window once when two opens began before it existed", async () => {
      const answers: (() => void)[] = []
      let version = 0
      const app = open(
        () =>
          new Promise((resolve) =>
            answers.push(() =>
              resolve({
                item: { ...readme, version: (version += 1) },
                window: windowOf("session-1", "README.md"),
              }),
            ),
          ),
      )
      const first = app.commands.openProjectFile("README.md")
      const second = app.commands.openProjectFile("notes.md")
      answers[0]!()
      await first
      const created = app.ui.getSnapshot().created
      expect(created).toMatchObject({ id: "session-1" })
      answers[1]!()
      await second
      expect(app.ui.getSnapshot().created).toBe(created)
      expect(app.state().roster.windows.map((each) => each.id)).toEqual(["session-1"])
      expect(app.state().items.map((each) => each.version)).toEqual([2])
    })

    it("places the window the same when the watch reported it before the answer", async () => {
      const window = windowOf("session-1", "README.md")
      let answer!: () => void
      const watched = open(
        () => new Promise((resolve) => (answer = () => resolve({ item: readme, window }))),
      )
      const opening = watched.commands.openProjectFile("README.md")
      watched.workspace.dispatch({ type: "item/upsert", target, item: readme })
      watched.workspace.dispatch({ type: "window/upsert", target, window })
      answer()
      await opening
      const alone = open(reply)
      await alone.commands.openProjectFile("README.md")
      expect(watched.state()).toEqual(alone.state())
    })

    it("does nothing where the backend can't open files", async () => {
      const app = open()
      await expect(app.commands.openProjectFile("package.json")).resolves.toBeUndefined()
      expect(app.state().roster.windows).toEqual([])
    })

    it("rejects when the backend can't open it, leaving the workspace as it was", async () => {
      const app = open(() => Promise.reject(new Error("gone")))
      await expect(app.commands.openProjectFile("package.json")).rejects.toThrow("gone")
      expect(app.state().roster.windows).toEqual([])
    })
  })

  context("when a file or folder of the project moves", () => {
    // A backend whose project window shows each file it is asked to open, as a runner does, with
    // what it was asked for since `asked` was last emptied; `gone` names the paths it can't open.
    const follows = (gone: readonly string[] = []) => {
      let version = 0
      return open((_target, path) => {
        if (gone.includes(path)) return Promise.reject(new Error("That file doesn't exist."))
        version += 1
        const name = path.slice(path.lastIndexOf("/") + 1)
        return Promise.resolve({
          item: { ...readme, path, name, version },
          window: windowOf("session-1", name),
        })
      })
    }
    const shown = (app: ReturnType<typeof follows>) => ({
      path: app.state().items[0]?.path,
      window: app.state().roster.windows.map((each) => each.name),
    })

    it("opens the file the window shows where it was renamed to, leaving the selection be", async () => {
      const app = follows()
      await app.commands.openProjectFile("src/cart.ts")
      app.workspace.dispatch({ type: "terminal/select", target, terminalId: "01" })
      app.asked.length = 0

      await app.commands.followMovedFile("project", "src/cart.ts", "src/basket.ts")

      expect(app.asked.map((each) => each.path)).toEqual(["~/project/src/basket.ts"])
      expect(shown(app)).toEqual({ path: "~/project/src/basket.ts", window: ["basket.ts"] })
      expect(app.state().selected).toBe("01")
    })

    it("opens it in the project window of every session of the project that shows it", async () => {
      const app = follows()
      await app.commands.openProjectFile("src/cart.ts")
      app.workspace.dispatch({
        type: "session/add",
        projectId: "project",
        session: createWorkspaceSession(
          { name: "Other", state: createTerminalState([], "grid", "grid") },
          { id: "other", now: 2 },
        ),
      })
      await app.commands.openProjectFile("src/cart.ts")

      await app.commands.followMovedFile("project", "src/cart.ts", "src/basket.ts")

      const project = app.workspace.getSnapshot().projects.find((each) => each.id === "project")!
      expect(project.history.map((session) => [session.id, session.state.items[0]?.path])).toEqual([
        ["other", "~/project/src/basket.ts"],
        ["initial", "~/project/src/basket.ts"],
      ])
    })

    it("opens a file inside a renamed folder at its new path", async () => {
      const app = follows()
      await app.commands.openProjectFile("src/cart/total.ts")

      await app.commands.followMovedFile("project", "src/cart", "src/basket")

      expect(shown(app).path).toBe("~/project/src/basket/total.ts")
    })

    it("leaves a window that shows another file alone, one beside the folder's name too", async () => {
      const app = follows()
      await app.commands.openProjectFile("src/cartography.ts")
      app.asked.length = 0

      await app.commands.followMovedFile("project", "src/cart", "src/basket")

      expect(app.asked).toEqual([])
      expect(shown(app).path).toBe("~/project/src/cartography.ts")
    })

    it("stops previewing the agents' work at the old path, showing main's copy", async () => {
      const app = follows()
      await app.commands.openProjectFile("src/cart.ts", { preview: true })
      expect(Object.keys(app.ui.getSnapshot().filePreviews)).toHaveLength(1)

      await app.commands.followMovedFile("project", "src/cart.ts", "src/basket.ts")

      expect(app.ui.getSnapshot().filePreviews).toEqual({})
    })

    it("leaves the window on the old path, gone, where the file can't be opened at the new", async () => {
      const app = follows(["~/project/src/basket.ts"])
      await app.commands.openProjectFile("src/cart.ts")

      await expect(
        app.commands.followMovedFile("project", "src/cart.ts", "src/basket.ts"),
      ).resolves.toBeUndefined()

      expect(shown(app).path).toBe("~/project/src/cart.ts")
    })

    it("does nothing for a project removed meanwhile", async () => {
      const app = follows()
      await app.commands.openProjectFile("src/cart.ts")
      app.asked.length = 0

      await app.commands.followMovedFile("removed", "src/cart.ts", "src/basket.ts")

      expect(app.asked).toEqual([])
      expect(shown(app).path).toBe("~/project/src/cart.ts")
    })

    it("does nothing where the backend can't open files", async () => {
      const app = open()
      await expect(app.commands.followMovedFile("project", "a.ts", "b.ts")).resolves.toBeUndefined()
    })
  })
})
