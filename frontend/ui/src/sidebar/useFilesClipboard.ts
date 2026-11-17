import { useEffect, useState } from "react"

import {
  clipMoved,
  clipRemoved,
  foldersOnTheWay,
  listedAway,
  parentOf,
  pasteOf,
  pasteReady,
  type Clip,
} from "./files-edit"
import type { FilesRow, Listings } from "./files-tree"

// How the panel makes a paste and settles it in the tree, by the row it was asked on (`asked`,
// null off a row): a cut moved to `to`, or a copy made in the folder `into`. Each answers the
// path of the entry pasted once the tree shows it, or rejects with why not.
export type PasteChanges = {
  readonly move: (
    from: string,
    to: string,
    folder: boolean,
    asked: string | null,
  ) => Promise<string>
  readonly copy: (
    from: string,
    into: string,
    folder: boolean,
    asked: string | null,
  ) => Promise<string>
}

// A folder of the project as a failure's line names it.
const where = (folder: string): string => (folder === "" ? "the project's folder" : folder)

export type FilesClipboard = {
  // What was cut or copied, to paste.
  readonly clip: Clip | null
  // Whether Paste runs now.
  readonly ready: boolean
  // Whether a paste of the entry at `path` is under way.
  readonly busy: (path: string) => boolean
  // Cuts or copies a row, and pastes on a row or off one; absent where the backend can't.
  readonly actions:
    | {
        readonly take: (row: FilesRow, mode: Clip["mode"]) => void
        readonly paste: (row: FilesRow | undefined) => void
      }
    | undefined
  // Lets go of a cut, as Escape does, answering whether there was one.
  readonly letGo: () => boolean
  // Told the entry at `from` moved to `to`, or the one at `path` was deleted, which what was cut
  // or copied follows.
  readonly moved: (from: string, to: string) => void
  readonly removed: (path: string) => void
}

// The Files panel's clipboard, its own and never the system's: one entry, cut or copied, to
// paste, and the pastes under way. A copy stays to paste again; a cut is let go once pasted, by
// Escape, or pasted back into its own folder. What was cut or copied follows a move the panel
// makes, and goes with a delete; one the folders read since say is gone is let go, and where a
// folder on its way can't be read, as one that went, the folder holding it is read again to tell.
// The panel remounts with the project, which forgets it.
export const useFilesClipboard = ({
  changes,
  listings,
  read,
  opened,
  began,
  failing,
}: {
  // How a paste is made, where the backend moves and copies the project's files.
  changes: PasteChanges | undefined
  listings: Listings
  read: (folder: string) => void
  // Opens a folder pasted into, where it isn't.
  opened: (folder: string) => void
  // Told a paste starts, which clears what the panel said last.
  began: () => void
  // Says above the tree what the panel couldn't do, `action`, reading the folders `involved`.
  failing: (action: string, involved: readonly string[]) => (error: unknown) => void
}): FilesClipboard => {
  const [clip, setClip] = useState<Clip | null>(null)
  if (clip !== null && listedAway(listings, clip.path)) setClip(null)
  // Each paste under way by what it copies or moves, whose row shows busy meanwhile.
  const [runs, setRuns] = useState<readonly Clip[]>([])
  const ready = pasteReady(clip, runs)
  const unread =
    clip === null
      ? undefined
      : foldersOnTheWay(clip.path).find((folder) => listings.get(folder) === "failed")
  useEffect(() => {
    if (unread !== undefined) read(parentOf(unread))
  }, [unread, read])

  const paste = (made: PasteChanges, row: FilesRow | undefined): void => {
    if (clip === null || !ready) return
    const what = pasteOf(clip, row)
    if (what.kind === "let go") {
      setClip(null)
      return
    }
    began()
    opened(what.into)
    const asked = row?.node.path ?? null
    const run = { ...clip }
    setRuns((current) => [...current, run])
    const change =
      what.kind === "move"
        ? made.move(what.from, what.to, clip.folder, asked)
        : made.copy(what.from, what.into, clip.folder, asked)
    change
      .then(
        // A cut is done once it moved, unless something else was cut or copied meanwhile.
        (path) => {
          if (run.mode === "cut")
            setClip((current) =>
              current?.mode === "cut" && current.path === path ? null : current,
            )
        },
        failing(`${what.kind} ${what.from} into ${where(what.into)}`, [
          what.into,
          parentOf(what.from),
        ]),
      )
      .finally(() => setRuns((current) => current.filter((each) => each !== run)))
  }
  return {
    clip,
    ready,
    busy: (path) => runs.some((run) => run.path === path),
    actions: changes && {
      take: (row, mode) => setClip({ mode, path: row.node.path, folder: row.node.folder }),
      paste: (row) => paste(changes, row),
    },
    letGo: () => {
      if (clip?.mode !== "cut") return false
      setClip(null)
      return true
    },
    moved: (from, to) => setClip((current) => clipMoved(current, from, to)),
    removed: (path) => setClip((current) => clipRemoved(current, path)),
  }
}
