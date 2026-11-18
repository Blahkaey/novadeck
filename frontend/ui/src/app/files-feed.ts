import { absolutePath, type FilesState } from "@novadeck/core/files"
import { createStore } from "@novadeck/core/store"
import type { WorkspaceSession } from "@novadeck/core/types"
import type { Work, WorksState } from "@novadeck/core/works"

import { parentOf, type EntryChanges } from "../sidebar/files-edit"
import { projectPath, type Owner } from "../sidebar/files-works"

// What the Files panel and the file preview share of the backend's files and works.

// Every terminal in the sessions that has a handle, by id: its handle, and the file its
// running agent's turn wrote last.
export const ownersOf = (sessions: readonly WorkspaceSession[]): ReadonlyMap<string, Owner> =>
  new Map(
    sessions.flatMap((session) =>
      session.state.roster.terminals.flatMap((terminal) =>
        terminal.handle
          ? [
              [
                terminal.id,
                {
                  handle: terminal.handle,
                  wrote: terminal.state === "running" ? terminal.agent?.wrote : undefined,
                },
              ] as const,
            ]
          : [],
      ),
    ),
  )

export const sameOwners = (a: ReadonlyMap<string, Owner>, b: ReadonlyMap<string, Owner>): boolean =>
  a.size === b.size &&
  [...a].every(([id, owner]) => {
    const other = b.get(id)
    return other?.handle === owner.handle && other.wrote === owner.wrote
  })

// What a backend that reads no files has in its place; its panel isn't drawn.
export const noFiles = createStore<FilesState>({ projects: {} })

// What a backend without works reads in its place; its panel isn't drawn.
export const noWorks = createStore<WorksState>({ works: [], synced: true, reported: true })

export const sameWorks = (a: readonly Work[], b: readonly Work[]): boolean =>
  a.length === b.length && a.every((work, index) => Object.is(work, b[index]))

const at = (work: Work, file: string): string | undefined => projectPath(work.folder!, file)

// The files of the project's works that a preview of `path` (from the project's folder) is made
// of: those at the path itself, those renamed to it or away from it, and, where a work renamed
// another file to it, the changes of other works to that old file.
export const previewFiles = (
  works: readonly Work[],
  projectId: string,
  path: string,
): readonly { readonly work: Work; readonly file: Work["files"][number] }[] => {
  const mine = works.filter((work) => work.projectId === projectId && work.folder !== undefined)
  const names = new Set([path])
  for (const work of mine)
    for (const file of work.files)
      if (file.status === "renamed" && file.from !== undefined && at(work, file.path) === path) {
        const old = at(work, file.from)
        if (old !== undefined) names.add(old)
      }
  return mine.flatMap((work) =>
    work.files.flatMap((file) => {
      const named = at(work, file.path)
      const from =
        file.status === "renamed" && file.from !== undefined ? at(work, file.from) : undefined
      return (named !== undefined && names.has(named)) || from === path ? [{ work, file }] : []
    }),
  )
}

// Where to open a file of the project main lacks (an agent added it or renamed another to it):
// its copy in the worktree of the work that wrote it last, as an absolute path.
export const copyOf = (
  works: readonly Work[],
  projectId: string,
  path: string,
): string | undefined => {
  const copies = works.flatMap((work) =>
    work.projectId === projectId && work.folder !== undefined
      ? work.files.flatMap((file) =>
          file.status !== "deleted" && projectPath(work.folder!, file.path) === path
            ? [{ at: file.changedAt, path: absolutePath(work.root, file.path) }]
            : [],
        )
      : [],
  )
  return copies.toSorted((a, b) => b.at - a.at)[0]?.path
}

// Why a move or a delete wasn't made: the person kept the project window's edits that can't be
// saved, which it would lose. The Files panel says it after "Couldn't rename …:".
export const keptEdits = "You kept the edits in the project window, which couldn't be saved."

// The Files panel's moves and deletes, each made once the edits to the files project windows
// show there are saved, or the person chose to go on without them (`saveBefore`, the
// `saveBeforeChange` command): a move within its folder is a rename. One the person stayed for
// isn't made, and rejects saying why.
export const savingFirst = (
  { move, remove }: Pick<EntryChanges, "move" | "remove">,
  saveBefore: (path: string, action: "rename" | "move" | "delete") => Promise<boolean>,
): Pick<EntryChanges, "move" | "remove"> => ({
  ...(move && {
    move: async (from: string, to: string) => {
      const action = parentOf(from) === parentOf(to) ? "rename" : "move"
      if (!(await saveBefore(from, action))) throw new Error(keptEdits)
      return move(from, to)
    },
  }),
  ...(remove && {
    remove: async (path: string) => {
      if (!(await saveBefore(path, "delete"))) throw new Error(keptEdits)
      return remove(path)
    },
  }),
})
