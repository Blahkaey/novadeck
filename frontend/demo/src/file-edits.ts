import {
  PlanUnwritableError,
  type ItemContent,
  type PlanSaved,
  type PlanUnwritableReason,
  type PlanVersion,
} from "@novadeck/core/items"

import { atOrBelow, movedTo } from "./project-paths"
import type { FileAt, WindowFile } from "./workspace"

// The files the person edits in a session's project window, as the demo keeps them in memory,
// standing in for the runner's (backend/runner/src/companions/editing.ts). A file's text is
// kept by its project and its path from the project's root, from what the demo shows of it (a
// stand-in, showcase/attached.ts) the first time the window reads it whole, with a stamp that
// moves at each change. As the runner: only the window's file is read whole and saved; only one
// of its project's own files is written, so an agent's copy, which the project lacks, reads
// read-only; a save names the path its edit was made on, else it is refused as `moved`; and one
// made on an earlier stamp answers the text as it stands, to merge into. The person's changes
// in the Files panel carry the text: a file made is empty, a rename or move takes it along, a
// copy copies it and a delete drops it. What can go wrong, for the debug panel and specs
// (`&fileFault=`), is a fault a file is in until it is lifted. Only ./files.ts loads this, with
// the first file the window reads whole or the person makes, out of the visitor build's demo load.

// What can go wrong with a file the person edits, as the runner would find it, which its reads
// and saves answer until it is lifted: it is too large to edit whole, isn't UTF-8 text, or is
// binary; Novadeck may read it but not write it, as an agent's copy (`outside`), in a folder it
// can't write (`folder`), or as no file it edits (`not-a-plan`); something other than the Files
// panel deleted it (`gone`), or it can't be read for now (`unreadable`); its saves fail without
// saying why (`failing`); or only its next save is refused, saying why (`refuse-…`).
export type FileFault =
  | "too-large"
  | "not-text"
  | "binary"
  | "outside"
  | "folder"
  | "not-a-plan"
  | "gone"
  | "unreadable"
  | "failing"
  | "refuse-folder"
  | "refuse-too-large"
  | "refuse-not-text"
  | "refuse-moved"

// How a fault answers a save: refused for good, saying why, or failed as one that may pass.
const saved: { readonly [Fault in FileFault]: PlanUnwritableReason | "fails" } = {
  "too-large": "too-large",
  "not-text": "not-text",
  binary: "not-text",
  outside: "outside",
  folder: "folder",
  "not-a-plan": "not-a-plan",
  gone: "gone",
  unreadable: "fails",
  failing: "fails",
  "refuse-folder": "folder",
  "refuse-too-large": "too-large",
  "refuse-not-text": "not-text",
  "refuse-moved": "moved",
}

const fileFaults = Object.keys(saved) as readonly FileFault[]

// What an agent writes into a file: two lines after its middle line, away from its start and
// its end, where the person is likeliest to type, so a merge with their edits is plain to see.
// `count` tells one rewrite from the next.
export const rewritten = (text: string, count: number): string => {
  const lines = text.split("\n")
  const at = Math.ceil((text.endsWith("\n") ? lines.length - 1 : lines.length) / 2)
  const indent = /^\s*/.exec(lines[at] ?? "")![0]
  return [
    ...lines.slice(0, at),
    `${indent}// An agent's change ${count}: it rewrote this part,`,
    `${indent}// leaving the lines around it as they were.`,
    ...lines.slice(at),
  ].join("\n")
}

// A file's lines as its listing has them: none after a final line break.
const linesOf = (text: string): string[] => {
  const lines = text.split("\n")
  return text.endsWith("\n") ? lines.slice(0, -1) : lines
}

// A file's text as the demo keeps it, and the stamp of this version of it.
type Held = { readonly text: string; readonly stamp: string }

// How the person's window follows what the demo shows of a file otherwise: its stand-in, or
// why it can't show. Returns the stop.
type Stand = (on: (content: ItemContent) => void) => () => void

export type DemoFileEdits = {
  // Follows the file the project window shows whole, as `on` hears it: its text, whether it can
  // be written and why not, or why it can't be edited whole. `stand` follows what the demo
  // shows of it otherwise, which a file it hasn't read whole yet starts from. Returns the stop.
  readonly follow: (
    file: WindowFile,
    stand: Stand,
    on: (content: ItemContent) => void,
  ) => () => void
  // Writes the person's edit to the file the project window shows, made on its version
  // `basedOn` at `path` (see `Companions.save`).
  readonly save: (
    file: WindowFile,
    text: string,
    basedOn: string,
    path: string | undefined,
  ) => Promise<PlanSaved>
  // The person made an empty file at `path` of a project, in Files.
  readonly made: (projectId: string, path: string) => void
  // The person renamed or moved `from`, a file or a folder, to `to`: what it holds goes along.
  readonly moved: (projectId: string, from: string, to: string) => void
  // The person copied `from`, a file or a folder, to `to`: the copy holds the same texts, and
  // none of the faults.
  readonly copied: (projectId: string, from: string, to: string) => void
  // The person deleted `path`, a file or a folder, and what it held.
  readonly removed: (projectId: string, path: string) => void
  // Puts a file the project window has read whole in `fault`; false where it hasn't.
  readonly fault: (file: FileAt, fault: FileFault) => boolean
  // Puts the next file the project window reads whole in the fault `named`, as specs ask by
  // `&fileFault=`; a name no fault has puts it in none.
  readonly faultFirst: (named: string) => void
  // An agent rewrites a file the project window has read whole (see `rewritten`); false where
  // it hasn't.
  readonly rewrite: (file: FileAt) => boolean
  // The file's text as last written, or as the window first read it whole; none before that.
  readonly text: (file: FileAt) => string | undefined
  // Lifts every fault: each file reads and saves as it should.
  readonly normal: () => void
}

// What the demo keeps of one project's files, by their path, out of every project's.
const filesOf = <T>(all: Map<string, Map<string, T>>, projectId: string): Map<string, T> => {
  const files = all.get(projectId) ?? new Map<string, T>()
  all.set(projectId, files)
  return files
}

const keyOf = ({ projectId, path }: FileAt): string => JSON.stringify([projectId, path])

// What a project keeps at `path` and below, as [path, value].
const below = <T>(files: Map<string, T>, path: string): [string, T][] =>
  [...files].filter(([each]) => atOrBelow(each, path))

// What a project keeps at `from` and below, moved to where it is once `from` moved to `to`.
const carry = <T>(files: Map<string, T>, from: string, to: string): void => {
  for (const [path, value] of below(files, from)) {
    files.delete(path)
    files.set(movedTo(path, from, to), value)
  }
}

const drop = <T>(files: Map<string, T>, path: string): void => {
  for (const [each] of below(files, path)) files.delete(each)
}

// `isFile` says whether a project's tree holds a file at a path, which only the project's own
// files do.
export const createFileEdits = (isFile: (file: FileAt) => boolean): DemoFileEdits => {
  // Each project's files by their path: their text as last written, and their faults.
  const texts = new Map<string, Map<string, Held>>()
  const faults = new Map<string, Map<string, FileFault>>()
  // Who follows each file whole, by `keyOf`.
  const followers = new Map<string, Set<() => void>>()
  let writes = 0
  let rewrites = 0
  // The fault the next file read whole is put in.
  let first: FileFault | undefined

  const told = (file: FileAt): void => followers.get(keyOf(file))?.forEach((tell) => tell())
  const stamped = (text: string): Held => ({ text, stamp: String((writes += 1)) })
  const write = (file: FileAt, text: string): Held => {
    const held = stamped(text)
    filesOf(texts, file.projectId).set(file.path, held)
    told(file)
    return held
  }
  // The file's text: as last written, or, read whole for the first time, the stand-in's lines.
  const textOf = (file: FileAt, lines: readonly string[]): Held => {
    const files = filesOf(texts, file.projectId)
    const held = files.get(file.path) ?? stamped(`${lines.join("\n")}\n`)
    files.set(file.path, held)
    return held
  }

  // What the window hears of the file, the demo's stand-in for it being `stand`.
  const read = (file: WindowFile, stand: ItemContent): ItemContent => {
    const fault = filesOf(faults, file.projectId).get(file.path)
    if (fault === "gone") return { state: "unavailable", reason: "missing", size: null }
    if (fault === "unreadable") return { state: "unavailable", reason: "unreadable", size: null }
    // Behind the secrets gate, or no text, as the demo shows it otherwise.
    if (stand.state !== "ready" || stand.content.kind !== "file") return stand
    const { text, stamp } = textOf(file, stand.content.lines)
    if (fault === "binary") return { state: "unavailable", reason: "binary", size: null }
    if (fault === "too-large" || fault === "not-text") {
      const lines = linesOf(text)
      return {
        state: "ready",
        stamp,
        content: {
          ...stand.content,
          firstLine: 1,
          lines,
          from: 1,
          to: lines.length,
          total: lines.length,
          truncated: false,
          clamped: false,
          uneditable: fault,
        },
      }
    }
    const whole = { kind: "text", path: file.at, text } as const
    const reason = !isFile(file)
      ? "outside"
      : fault === "outside" || fault === "folder" || fault === "not-a-plan"
        ? fault
        : undefined
    return {
      state: "ready",
      stamp,
      content:
        reason === undefined ? { ...whole, writable: true } : { ...whole, writable: false, reason },
    }
  }

  const follow: DemoFileEdits["follow"] = (file, stand, on) => {
    if (first) filesOf(faults, file.projectId).set(file.path, first)
    first = undefined
    let shown: ItemContent | undefined
    const tell = (): void => {
      if (shown) on(read(file, shown))
    }
    const key = keyOf(file)
    const following = followers.get(key) ?? new Set()
    followers.set(key, following.add(tell))
    const stop = stand((content) => {
      shown = content
      tell()
    })
    return () => {
      stop()
      following.delete(tell)
    }
  }

  const save: DemoFileEdits["save"] = (file, text, basedOn, path) => {
    if (path !== file.at) return Promise.reject(new PlanUnwritableError("moved"))
    const here = filesOf(faults, file.projectId)
    const fault = here.get(file.path)
    // A refusal of the next save is for that save only.
    if (fault?.startsWith("refuse-")) here.delete(file.path)
    const answer = fault && saved[fault]
    if (answer === "fails") return Promise.reject(new Error("The demo was told to fail this save."))
    if (answer) return Promise.reject(new PlanUnwritableError(answer))
    const held = filesOf(texts, file.projectId).get(file.path)
    if (!held) return Promise.reject(new PlanUnwritableError("gone"))
    if (basedOn !== held.stamp) {
      const current: PlanVersion = {
        stamp: held.stamp,
        plan: { kind: "plan", text: held.text, truncated: false, writable: true, skill: false },
      }
      return Promise.resolve({ saved: false, current })
    }
    return Promise.resolve({ saved: true, stamp: write(file, text).stamp })
  }

  return {
    follow,
    save,
    made: (projectId, path) => {
      write({ projectId, path }, "")
    },
    moved: (projectId, from, to) => {
      carry(filesOf(texts, projectId), from, to)
      carry(filesOf(faults, projectId), from, to)
    },
    copied: (projectId, from, to) => {
      const files = filesOf(texts, projectId)
      for (const [path, { text }] of below(files, from))
        files.set(movedTo(path, from, to), stamped(text))
    },
    removed: (projectId, path) => {
      drop(filesOf(texts, projectId), path)
      drop(filesOf(faults, projectId), path)
    },
    fault: (file, fault) => {
      if (!filesOf(texts, file.projectId).has(file.path)) return false
      filesOf(faults, file.projectId).set(file.path, fault)
      told(file)
      return true
    },
    faultFirst: (named) => {
      first = fileFaults.find((each) => each === named)
    },
    text: (file) => filesOf(texts, file.projectId).get(file.path)?.text,
    rewrite: (file) => {
      const held = filesOf(texts, file.projectId).get(file.path)
      if (!held) return false
      write(file, rewritten(held.text, (rewrites += 1)))
      return true
    },
    normal: () => {
      faults.clear()
      first = undefined
      followers.forEach((following) => following.forEach((tell) => tell()))
    },
  }
}
