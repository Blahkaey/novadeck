import {
  PlanUnwritableError,
  type Companions,
  type ItemContent,
  type PlanSaved,
  type PlanUnwritableReason,
} from "@novadeck/core/items"
import { workspaceReducer } from "@novadeck/core/state"
import { createWorkspaceStore } from "@novadeck/core/store"
import { itemFixture, workspaceFixture } from "@novadeck/core/testing"
import { afterEach, beforeEach, vi } from "vitest"

import { fileKey } from "../kinds/file/file-doc"
import { context, describe, expect, it } from "../test"
import { createItemStore } from "./item-store"

const target = { projectId: "project", workspaceSessionId: "initial" }
// The file the session's project window shows.
const notes = itemFixture("notes", "01", {
  kind: "file",
  name: "notes.ts",
  path: "/p/notes.ts",
  holder: { windowId: "window" },
})
const first = "one\ntwo\nthree\n"

const textOf = (path: string, text: string, stamp: string): ItemContent => ({
  state: "ready",
  stamp,
  content: { kind: "text", path, text, writable: true },
})

// A backend the test drives: it reports what the test emits for the item, answers saves when
// told to, records how the item was followed, and holds what the app waits for as it quits.
const backend = () => {
  let listener: (content: ItemContent) => void = () => {}
  const follows: { readonly edit: boolean | undefined }[] = []
  const quits: (() => Promise<void>)[] = []
  const saves: {
    readonly text: string
    readonly basedOn: string
    readonly path: string | undefined
    readonly answer: (result: PlanSaved) => void
    readonly fail: () => void
    readonly refuse: (reason: PlanUnwritableReason) => void
  }[] = []
  const companions: Companions = {
    follow: (_target, _id, { edit }, on) => {
      follows.push({ edit })
      listener = on
      return () => {}
    },
    trouble: () => {},
    save: (_target, _id, text, basedOn, path) =>
      new Promise((resolve, reject) =>
        saves.push({
          text,
          basedOn,
          path,
          answer: resolve,
          fail: () => reject(new Error("down")),
          refuse: (reason) => reject(new PlanUnwritableError(reason)),
        }),
      ),
    beforeQuit: (save) => {
      quits.push(save)
      return () => void quits.splice(quits.indexOf(save), 1)
    },
  }
  return { companions, follows, saves, quits, emit: (content: ItemContent) => listener(content) }
}

// The project window's file shown, to edit, as the backend first reads it.
const opened = (text = first) => {
  const { companions, follows, saves, quits, emit } = backend()
  const workspace = createWorkspaceStore(
    workspaceReducer(workspaceFixture(), { type: "item/upsert", target, item: notes }),
  )
  const itemStore = createItemStore({ companions, workspace })
  itemStore.connect()
  const release = itemStore.watch(target, notes.id, { edit: true })
  emit(textOf("/p/notes.ts", text, "1"))
  const docAt = (path: string) => itemStore.store.getSnapshot().files[fileKey(notes.id, path)]
  // Points the window at another file, as opening one from Files does.
  const repoint = (path: string) =>
    workspace.dispatch({
      type: "item/upsert",
      target,
      item: { ...notes, path, name: path.slice(path.lastIndexOf("/") + 1), version: 2 },
    })
  return {
    itemStore,
    workspace,
    follows,
    saves,
    quits,
    emit,
    release,
    repoint,
    actions: itemStore.file(target, notes.id, "/p/notes.ts"),
    doc: () => docAt("/p/notes.ts")!,
    docAt,
  }
}

// Lets pending answers, and the merge code's lazy import, finish.
const settle = async () => {
  await vi.dynamicImportSettled()
  await vi.advanceTimersByTimeAsync(0)
  await vi.dynamicImportSettled()
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe("a file edited in the project window", () => {
  it("is followed whole to edit, as the window asks", () => {
    const { follows } = opened()
    expect(follows).toEqual([{ edit: true }])
  })

  it("is followed again whole when the window shows it after what it showed without editing", () => {
    // An image the window showed, its follow lingering as the window turns to the file.
    const { companions, follows, emit } = backend()
    const workspace = createWorkspaceStore(
      workspaceReducer(workspaceFixture(), { type: "item/upsert", target, item: notes }),
    )
    const itemStore = createItemStore({ companions, workspace })
    itemStore.connect()
    itemStore.watch(target, notes.id)()
    emit({
      state: "ready",
      stamp: "1",
      content: {
        kind: "file",
        path: "/p/notes.ts",
        firstLine: 1,
        lines: ["one"],
        from: 1,
        to: 1,
        total: 1,
        clamped: false,
        truncated: false,
      },
    })
    itemStore.watch(target, notes.id, { edit: true })
    expect(follows).toEqual([{ edit: undefined }, { edit: true }])
    expect(itemStore.store.getSnapshot().content[notes.id]).toBeUndefined()
    emit(textOf("/p/notes.ts", first, "1"))
    expect(itemStore.store.getSnapshot().files[fileKey(notes.id, "/p/notes.ts")]?.text).toBe(first)
  })

  context("when the person types", () => {
    it("is saved once typing pauses, naming the file the edit was made on", async () => {
      const { actions, saves } = opened()
      actions.edit(`${first}f`)
      actions.edit(`${first}four`)
      expect(saves).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(400)
      expect(saves.map(({ text, basedOn, path }) => ({ text, basedOn, path }))).toEqual([
        { text: `${first}four`, basedOn: "1", path: "/p/notes.ts" },
      ])
    })

    it("is saved at once when the person saves, or focus leaves it", () => {
      const { actions, saves } = opened()
      actions.edit(`${first}four\n`)
      actions.flush()
      expect(saves).toHaveLength(1)
    })
  })

  context("when its save is reported back", () => {
    it("takes it as the person's own by the stamp the save answered", async () => {
      const { actions, saves, emit, doc } = opened()
      actions.edit(`${first}four\n`)
      actions.flush()
      saves[0]!.answer({ saved: true, stamp: "2" })
      await settle()
      emit(textOf("/p/notes.ts", `${first}four\n`, "2"))
      await settle()
      expect(doc()).toMatchObject({ text: `${first}four\n`, base: `${first}four\n`, marks: [] })
      expect(saves).toHaveLength(1)
    })
  })

  context("when another writer changes the file", () => {
    it("shows the new text where nothing is unsaved", async () => {
      const { emit, doc, saves } = opened()
      emit(textOf("/p/notes.ts", "one\nTWO\nthree\n", "2"))
      await settle()
      expect(doc()).toMatchObject({ text: "one\nTWO\nthree\n", revision: "2", marks: [] })
      expect(saves).toHaveLength(0)
    })

    it("merges its changes into unsaved edits, marks its lines, and saves the result", async () => {
      const { actions, emit, doc, saves } = opened()
      actions.edit(`${first}four\n`)
      emit(textOf("/p/notes.ts", "one\nTWO\nthree\n", "2"))
      await settle()
      expect(doc()).toMatchObject({
        text: "one\nTWO\nthree\nfour\n",
        marks: [{ from: 2, to: 2 }],
      })
      expect(saves.map(({ text, basedOn }) => ({ text, basedOn }))).toEqual([
        { text: "one\nTWO\nthree\nfour\n", basedOn: "2" },
      ])
    })

    it("merges in the file's own breaks a version that breaks its lines otherwise", async () => {
      const { actions, emit, doc, saves } = opened("a\r\nb\r\nc\r\n")
      actions.edit("a\nB\nc\n")
      emit(textOf("/p/notes.ts", "a\r\nb\r\nc\r\nd\n", "2"))
      await settle()
      expect(doc()).toMatchObject({
        text: "a\r\nB\r\nc\r\nd\n",
        eol: "\n",
        marks: [{ from: 4, to: 4 }],
      })
      expect(saves.map(({ text, basedOn }) => ({ text, basedOn }))).toEqual([
        { text: "a\r\nB\r\nc\r\nd\n", basedOn: "2" },
      ])
    })

    it("takes a file of mixed breaks to CRLF throughout, as the version has it", async () => {
      const { actions, emit, doc, saves } = opened("a\r\nb\nc\r\n")
      actions.edit("a\r\nB\nc\r\n")
      emit(textOf("/p/notes.ts", "a\r\nb\r\nc\r\nd\r\n", "2"))
      await settle()
      expect(doc()).toMatchObject({
        text: "a\nB\nc\nd\n",
        eol: "\r\n",
        marks: [{ from: 4, to: 4 }],
      })
      expect(saves.map(({ text }) => text)).toEqual(["a\r\nB\r\nc\r\nd\r\n"])
    })

    it("keeps the marks where the person's edits moved them", async () => {
      const { actions, emit, doc } = opened()
      actions.edit(`${first}four\n`)
      emit(textOf("/p/notes.ts", "one\nTWO\nthree\n", "2"))
      await settle()
      actions.edit(`zero\none\nTWO\nthree\nfour\n`, [{ from: 3, to: 3 }])
      expect(doc().marks).toEqual([{ from: 3, to: 3 }])
    })

    it("merges its changes into edits on their way, once their save answers", async () => {
      const { actions, emit, doc, saves } = opened()
      actions.edit(`${first}four\n`)
      actions.flush()
      emit(textOf("/p/notes.ts", "one\nTWO\nthree\nfour\n", "3"))
      await settle()
      saves[0]!.answer({ saved: true, stamp: "2" })
      await settle()
      expect(doc()).toMatchObject({ text: "one\nTWO\nthree\nfour\n", revision: "3" })
      expect(saves).toHaveLength(1)
    })
  })

  context("when a save can't go through", () => {
    it.each<PlanUnwritableReason>(["moved", "not-text", "folder", "outside"])(
      "stops saving and says why: %s",
      async (reason) => {
        const { actions, doc, saves } = opened()
        actions.edit(`${first}four\n`)
        actions.flush()
        saves[0]!.refuse(reason)
        await settle()
        expect(doc()).toMatchObject({ blocked: reason, unsaved: true, text: `${first}four\n` })
        actions.edit(`${first}four\nfive\n`)
        await vi.advanceTimersByTimeAsync(120_000)
        expect(saves).toHaveLength(1)
      },
    )

    it("saves again after the person edits a file that was too large", async () => {
      const { actions, doc, saves } = opened()
      actions.edit(`${first}four\n`)
      actions.flush()
      saves[0]!.refuse("too-large")
      await settle()
      actions.edit(`${first}4\n`)
      expect(doc().blocked).toBeNull()
      await vi.advanceTimersByTimeAsync(400)
      expect(saves).toHaveLength(2)
    })

    it("stops after five failures in a row, until the person retries", async () => {
      const { actions, doc, saves } = opened()
      actions.edit(`${first}four\n`)
      actions.flush()
      for (let each = 0; each < 5; each += 1) {
        saves[each]!.fail()
        // eslint-disable-next-line no-await-in-loop -- Each try follows the one before.
        await settle()
        // eslint-disable-next-line no-await-in-loop -- The wait before the next try.
        await vi.advanceTimersByTimeAsync(Math.min(30_000, 1000 * 2 ** (each + 1)))
      }
      expect(doc()).toMatchObject({ stalled: true, unsaved: true })
      expect(saves).toHaveLength(5)
      actions.retry()
      expect(doc().stalled).toBe(false)
      expect(saves).toHaveLength(6)
    })

    it("waits while the file is deleted, and saves once it is back", async () => {
      const { actions, emit, saves, itemStore } = opened()
      actions.edit(`${first}four\n`)
      emit({ state: "unavailable", reason: "missing", size: null })
      await vi.advanceTimersByTimeAsync(5000)
      expect(saves).toHaveLength(0)
      await expect(itemStore.saveFile(target, notes.id, "/p/notes.ts")).resolves.toBe("stuck")
      emit(textOf("/p/notes.ts", first, "1"))
      await settle()
      expect(saves.map(({ text }) => text)).toEqual([`${first}four\n`])
    })

    it("goes on once the window shows the file again, after a save refused as moved", async () => {
      const { actions, doc, saves, emit } = opened()
      actions.edit(`${first}four\n`)
      actions.flush()
      saves[0]!.refuse("moved")
      await settle()
      emit(textOf("/p/notes.ts", first, "1"))
      await settle()
      expect(doc().blocked).toBeNull()
      expect(saves.map(({ path }) => path)).toEqual(["/p/notes.ts", "/p/notes.ts"])
    })
  })

  context("when the window is pointed at another file", () => {
    it("keeps the edits not yet saved to the first apart, and saves them only to it", async () => {
      const { actions, repoint, emit, doc, docAt, saves } = opened()
      actions.edit(`${first}four\n`)
      repoint("/p/other.ts")
      emit(textOf("/p/other.ts", "other\n", "7"))
      await settle()
      expect(doc().text).toBe(`${first}four\n`)
      expect(docAt("/p/other.ts")).toMatchObject({ text: "other\n", revision: "7" })
      await vi.advanceTimersByTimeAsync(400)
      expect(saves.map(({ text, path }) => ({ text, path }))).toEqual([
        { text: `${first}four\n`, path: "/p/notes.ts" },
      ])
    })

    it("lets go of the first file at once where its edits are all saved", () => {
      const { repoint, docAt } = opened()
      repoint("/p/other.ts")
      expect(docAt("/p/notes.ts")).toBeUndefined()
    })

    it("lets go of the first file once its edits are saved", async () => {
      const { actions, repoint, docAt, saves } = opened()
      actions.edit(`${first}four\n`)
      actions.flush()
      repoint("/p/other.ts")
      expect(docAt("/p/notes.ts")).toBeDefined()
      saves[0]!.answer({ saved: true, stamp: "2" })
      await settle()
      expect(docAt("/p/notes.ts")).toBeUndefined()
    })

    it("shows the first file's kept edits when pointed back at it", async () => {
      const { actions, repoint, emit, doc, saves } = opened()
      actions.edit(`${first}four\n`)
      actions.flush()
      repoint("/p/other.ts")
      saves[0]!.refuse("moved")
      await settle()
      emit(textOf("/p/other.ts", "other\n", "7"))
      repoint("/p/notes.ts")
      emit(textOf("/p/notes.ts", first, "1"))
      await settle()
      expect(doc()).toMatchObject({ text: `${first}four\n`, blocked: null })
      expect(saves.map(({ text, path }) => ({ text, path }))).toEqual([
        { text: `${first}four\n`, path: "/p/notes.ts" },
        { text: `${first}four\n`, path: "/p/notes.ts" },
      ])
    })
  })

  context("when nothing shows it any more", () => {
    it("keeps edits not yet saved, and goes once they are", async () => {
      const { actions, release, doc, docAt, saves, itemStore } = opened()
      actions.edit(`${first}four\n`)
      actions.flush()
      release()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(itemStore.store.getSnapshot().content).not.toHaveProperty(notes.id)
      expect(doc().text).toBe(`${first}four\n`)
      saves.at(-1)!.answer({ saved: true, stamp: "2" })
      await settle()
      expect(docAt("/p/notes.ts")).toBeUndefined()
    })

    it("stays while something shows it again by the time its edits are saved", async () => {
      const { actions, release, docAt, saves, itemStore } = opened()
      actions.edit(`${first}four\n`)
      actions.flush()
      release()
      await vi.advanceTimersByTimeAsync(30_000)
      itemStore.watch(target, notes.id, { edit: true })
      saves.at(-1)!.answer({ saved: true, stamp: "2" })
      await settle()
      expect(docAt("/p/notes.ts")).toMatchObject({ base: `${first}four\n`, revision: "2" })
    })
  })

  it("goes with its item", () => {
    const { workspace, docAt } = opened()
    workspace.dispatch({ type: "item/close", target, itemId: notes.id })
    expect(docAt("/p/notes.ts")).toBeUndefined()
  })

  context("when the file breaks its lines with CRLF", () => {
    it("is edited in LF and saved in CRLF", async () => {
      const { actions, doc, saves } = opened("one\r\ntwo\r\n")
      expect(doc()).toMatchObject({ text: "one\ntwo\n", eol: "\r\n" })
      actions.edit("one\ntwo\nthree\n")
      actions.flush()
      expect(saves[0]!.text).toBe("one\r\ntwo\r\nthree\r\n")
    })
  })

  context("when the file holds a lone CR", () => {
    it("keeps it as text, and writes it back as it was", () => {
      const { actions, doc, saves } = opened("one\rstill one\r\ntwo\r\n")
      expect(doc()).toMatchObject({ text: "one\rstill one\ntwo\n", eol: "\r\n" })
      actions.edit("one\rstill one\ntwo\nthree\n")
      actions.flush()
      expect(saves[0]!.text).toBe("one\rstill one\r\ntwo\r\nthree\r\n")
    })

    it("keeps a file of mixed breaks as it is", () => {
      const { actions, doc, saves } = opened("one\r\ntwo\nthree\r")
      expect(doc()).toMatchObject({ text: "one\r\ntwo\nthree\r", eol: "\n" })
      actions.edit("one\r\ntwo\nthree\rfour")
      actions.flush()
      expect(saves[0]!.text).toBe("one\r\ntwo\nthree\rfour")
    })
  })
})

describe("saving a file before leaving it", () => {
  it("has nothing to wait for when every edit is in the file", () => {
    const { itemStore } = opened()
    expect(itemStore.saveFile(target, notes.id, "/p/notes.ts")).toBeUndefined()
  })

  it("saves at once, and answers once the save is through", async () => {
    const { actions, itemStore, saves } = opened()
    actions.edit(`${first}four\n`)
    const left = itemStore.saveFile(target, notes.id, "/p/notes.ts")
    expect(saves).toHaveLength(1)
    saves[0]!.answer({ saved: true, stamp: "2" })
    await settle()
    await expect(left).resolves.toBe("saved")
  })

  it("answers that the edits are stuck once the save is refused", async () => {
    const { actions, itemStore, saves } = opened()
    actions.edit(`${first}four\n`)
    const left = itemStore.saveFile(target, notes.id, "/p/notes.ts")
    saves[0]!.refuse("folder")
    await settle()
    await expect(left).resolves.toBe("stuck")
  })

  it("answers once its save is through, though the file reported it back first", async () => {
    const { actions, itemStore, saves, emit } = opened()
    actions.edit(`${first}four\n`)
    let left: string | undefined
    void itemStore.saveFile(target, notes.id, "/p/notes.ts")!.then((answer) => (left = answer))
    emit(textOf("/p/notes.ts", `${first}four\n`, "2"))
    await settle()
    saves[0]!.answer({ saved: true, stamp: "2" })
    await settle()
    expect(left).toBe("saved")
  })

  it("waits out a save that failed while it's tried again", async () => {
    const { actions, itemStore, saves } = opened()
    actions.edit(`${first}four\n`)
    let left: string | undefined
    void itemStore.saveFile(target, notes.id, "/p/notes.ts")!.then((answer) => (left = answer))
    saves[0]!.fail()
    await settle()
    expect(left).toBeUndefined()
    await vi.advanceTimersByTimeAsync(2000)
    saves[1]!.answer({ saved: true, stamp: "2" })
    await settle()
    expect(left).toBe("saved")
  })

  it("takes edits to a file the window no longer has whole as stuck", async () => {
    const { actions, itemStore, emit } = opened()
    actions.edit(`${first}four\n`)
    emit({
      state: "ready",
      stamp: "2",
      content: {
        kind: "file",
        path: "/p/notes.ts",
        firstLine: 1,
        lines: ["one"],
        from: 1,
        to: 1,
        total: 1,
        clamped: false,
        truncated: true,
        uneditable: "too-large",
      },
    })
    await expect(itemStore.saveFile(target, notes.id, "/p/notes.ts")).resolves.toBe("stuck")
  })

  it("takes a save unanswered in 20 seconds as failing", async () => {
    const { actions, itemStore } = opened()
    actions.edit(`${first}four\n`)
    const left = itemStore.saveFile(target, notes.id, "/p/notes.ts")
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(left).resolves.toBe("stuck")
  })

  it("answers at once for edits saves already gave up on", async () => {
    const { actions, itemStore, saves } = opened()
    actions.edit(`${first}four\n`)
    actions.flush()
    saves[0]!.refuse("not-text")
    await settle()
    await expect(itemStore.saveFile(target, notes.id, "/p/notes.ts")).resolves.toBe("stuck")
    expect(saves).toHaveLength(1)
  })

  it("lets go of the edits once the person copied them, back to the file as last read", async () => {
    const { actions, itemStore, saves, doc } = opened()
    actions.edit(`${first}four\n`)
    actions.flush()
    saves[0]!.refuse("folder")
    await settle()
    itemStore.dropFile(notes.id, "/p/notes.ts")
    expect(doc()).toMatchObject({ text: first, base: first, blocked: null, unsaved: false })
    expect(itemStore.saveFile(target, notes.id, "/p/notes.ts")).toBeUndefined()
  })

  it("lets go of the edits to a file the window no longer shows, leaving nothing of it", async () => {
    const { actions, itemStore, saves, repoint, docAt } = opened()
    actions.edit(`${first}four\n`)
    actions.flush()
    saves[0]!.refuse("folder")
    await settle()
    repoint("/p/other.ts")
    itemStore.dropFile(notes.id, "/p/notes.ts")
    expect(docAt("/p/notes.ts")).toBeUndefined()
  })
})

describe("as the app goes", () => {
  it("sends every edit not in its file at once as it quits, and waits for the answers", async () => {
    const { actions, quits, saves } = opened()
    actions.edit(`${first}four\n`)
    let quit = false
    const quitting = quits[0]!().then(() => (quit = true))
    expect(saves).toHaveLength(1)
    await settle()
    expect(quit).toBe(false)
    saves[0]!.answer({ saved: true, stamp: "2" })
    await quitting
    expect(quit).toBe(true)
  })

  it("quits within a save's own time, whatever doesn't answer", async () => {
    const { actions, quits } = opened()
    actions.edit(`${first}four\n`)
    const quitting = quits[0]!()
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(quitting).resolves.toBeUndefined()
  })

  it("sends every edit not in its file at once as the page goes", () => {
    const { actions, saves } = opened()
    actions.edit(`${first}four\n`)
    window.dispatchEvent(new Event("pagehide"))
    expect(saves.map(({ text }) => text)).toEqual([`${first}four\n`])
  })
})
