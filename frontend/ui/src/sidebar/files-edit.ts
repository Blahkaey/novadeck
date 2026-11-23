import type {
  FilePasteProgress,
  FilePasteResult,
  FolderEntry,
  ProjectFilesClipboard,
} from "@novadeck/core/files"

import type { FilesNode, FilesRow, FolderRead, Listings } from "./files-tree"

// The Files panel's changes to the project's files, apart from how it draws them: what the person
// is naming and whether the name will do, where a new entry or a paste goes, what was cut or copied
// to paste, which rows they may change, and what the panel knows of the folders once a change is
// made, until they are read again.

// What the person is naming: a new file or folder in the folder `parent` ("" for the root), asked
// for on the row `from` (none off a row), or a new name for the entry at `path`.
export type Naming =
  | {
      readonly kind: "new"
      readonly parent: string
      readonly folder: boolean
      readonly from: string | undefined
    }
  | { readonly kind: "rename"; readonly path: string; readonly folder: boolean }

// How the backend makes, moves, copies and deletes the project's files and folders, by their paths
// from the root, each where it can (see `ProjectFiles`): `create`, `move` and `copy` answer the
// path they made; `copy` takes the folder it copies into, "" for the root.
export type EntryChanges = {
  readonly create?: ((path: string, folder: boolean) => Promise<string>) | undefined
  readonly move?: ((from: string, to: string) => Promise<string>) | undefined
  readonly copy?: ((from: string, into: string) => Promise<string>) | undefined
  readonly remove?: ((path: string) => Promise<void>) | undefined
  readonly clipboard?: {
    readonly available?: ProjectFilesClipboard["available"]
    readonly mark: ProjectFilesClipboard["mark"]
    readonly paste: (
      into: string,
      marker: string | undefined,
      progress: FilePasteProgress,
    ) => Promise<FilePasteResult>
  }
}

// What the person cut or copied in the panel, to paste: the entry at `path`, a folder or not, to be
// moved (`cut`) or copied where they paste. The panel's own, never the system's clipboard.
export type Clip = {
  readonly mode: "cut" | "copy"
  readonly path: string
  readonly folder: boolean
}

export const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")))

export const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1)

export const childOf = (parent: string, name: string): string =>
  parent === "" ? name : `${parent}/${name}`

// The folders on the way to `path`, outermost first, the root left out: `a` and `a/b` for
// `a/b/c.ts`.
export const foldersOnTheWay = (path: string): string[] => {
  const names = path.split("/")
  return names.slice(0, -1).map((_, at) => names.slice(0, at + 1).join("/"))
}

// Where a new entry, or a paste, asked for on a row goes: inside a folder, beside a file, and in
// the root off a row.
export const newEntryIn = (row: FilesRow | undefined): string =>
  row === undefined ? "" : row.node.folder ? row.node.path : parentOf(row.node.path)

// What pasting what was cut or copied on a row does (none: off a row): nothing but let a cut go,
// for one pasted back into its own folder; move a cut to `to`; or copy into the folder `into`,
// under the name the backend chooses. A paste goes where a new entry would (`newEntryIn`).
export type Paste =
  | { readonly kind: "let go" }
  | { readonly kind: "move"; readonly from: string; readonly into: string; readonly to: string }
  | { readonly kind: "copy"; readonly from: string; readonly into: string }

export const pasteOf = (clip: Clip, row: FilesRow | undefined): Paste => {
  const into = newEntryIn(row)
  if (clip.mode === "copy") return { kind: "copy", from: clip.path, into }
  if (parentOf(clip.path) === into) return { kind: "let go" }
  return { kind: "move", from: clip.path, into, to: childOf(into, nameOf(clip.path)) }
}

// Whether what was cut or copied can be pasted now: something is, and not a cut whose paste is
// under way (`runs`, the pastes under way), whose entry may be gone by the time it ends.
export const pasteReady = (clip: Clip | null, runs: readonly Clip[]): boolean =>
  clip !== null && !runs.some((run) => run.mode === "cut" && run.path === clip.path)

// What was cut or copied once the entry at `from` moved to `to`, which it follows where it is
// that entry or lies in it.
export const clipMoved = (clip: Clip | null, from: string, to: string): Clip | null => {
  if (clip === null) return null
  const path = moved(clip.path, from, to)
  return path === clip.path ? clip : { ...clip, path }
}

// What was cut or copied once the entry at `path` is deleted: nothing, where it is that entry or
// lies in it.
export const clipRemoved = (clip: Clip | null, path: string): Clip | null =>
  clip && atOrBelow(clip.path, path) ? null : clip

// Whether the person may rename, delete or make entries in a row's entry: one its folder lists
// and no agent deleted. A row only an agent's work has isn't in the project's folder.
export const changeable = (node: FilesNode): boolean => node.listed && node.kind !== "deleted"

// What a typed name comes to: the path to make or rename to, nothing to do, or what is wrong.
export type NameCheck =
  | { readonly outcome: "commit"; readonly path: string }
  | { readonly outcome: "cancel" }
  | { readonly outcome: "invalid"; readonly problem: string }

// The listed entry at `names` from `folder`, through the folders read: what is there already at
// the first name taken, as far as the listings know.
const takenAt = (
  listings: Listings,
  folder: string,
  names: readonly string[],
): { readonly entry: FolderEntry; readonly at: number } | undefined => {
  let inside = folder
  for (const [at, name] of names.entries()) {
    const listing = listings.get(inside)
    const entry =
      typeof listing === "object" ? listing.entries.find((each) => each.name === name) : undefined
    if (!entry) return undefined
    if (at === names.length - 1 || !entry.folder) return { entry, at }
    inside = childOf(inside, name)
  }
  return undefined
}

const invalid = (problem: string): NameCheck => ({ outcome: "invalid", problem })

// Whether a typed name will do. A new entry's name may hold `/` to make the folders on the way,
// as `a/b/c.ts`; a rename's names one entry only. Nothing typed for a new entry, or the same
// name for a rename, does nothing. A name the folders read so far list is taken, by its exact
// letters: the backend answers for a filesystem blind to letters' case.
export const checkName = (naming: Naming, typed: string, listings: Listings): NameCheck => {
  const renaming = naming.kind === "rename"
  if (renaming ? typed === nameOf(naming.path) : typed === "") return { outcome: "cancel" }
  if (typed === "") return invalid("A name is needed.")
  if (typed.includes("\\")) return invalid("A name can't hold a backslash.")
  if (renaming && typed.includes("/")) return invalid("A name can't hold a slash.")
  const names = typed.split("/")
  if (names.includes("")) return invalid("A slash needs a name on each side.")
  if (names.some((name) => name === "." || name === "..")) return invalid("A name can't be . or ..")
  const folder = renaming ? parentOf(naming.path) : naming.parent
  const taken = takenAt(listings, folder, names)
  if (taken) {
    const what = taken.entry.folder ? "folder" : "file"
    const where = taken.at === 0 ? "here" : `in ${names.slice(0, taken.at).join("/")}`
    return invalid(`There's already a ${what} named ${taken.entry.name} ${where}.`)
  }
  return { outcome: "commit", path: childOf(folder, typed) }
}

// What a rename starts with selected: a file's name without its extension, as VS Code does, or
// the whole name of a folder or of a file with none but a leading dot.
export const nameSelection = (name: string, folder: boolean): readonly [number, number] => {
  const dot = name.lastIndexOf(".")
  return !folder && dot > 0 ? [0, dot] : [0, name.length]
}

// A path at or below `from` as it is once `from` moved to `to`; any other as it is.
export const moved = (path: string, from: string, to: string): string =>
  path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path

// Whether a path is `path` or lies below it.
export const atOrBelow = (each: string, path: string): boolean =>
  each === path || each.startsWith(`${path}/`)

// The listings with `entry` in the folder `folder`, or with none of that name for no entry,
// where that folder is read; unread or unreadable, it is left for its read.
const withEntry = (
  listings: Map<string, FolderRead>,
  folder: string,
  name: string,
  entry: FolderEntry | undefined,
): void => {
  const listing = listings.get(folder)
  if (typeof listing !== "object") return
  const others = listing.entries.filter((each) => each.name !== name)
  listings.set(folder, { ...listing, entries: entry ? [...others, entry] : others })
}

// What the panel knows of the folders once `path` is made, until they are read again: each name
// on the way in its folder, where that folder is read, and a folder made by it read and empty.
export const listingsMade = (listings: Listings, path: string, folder: boolean): Listings => {
  const next = new Map(listings)
  const names = path.split("/")
  for (const [at, name] of names.entries()) {
    const parent = names.slice(0, at).join("/")
    const isFolder = at < names.length - 1 || folder
    const listing = next.get(parent)
    if (typeof listing !== "object") break
    if (listing.entries.some((each) => each.name === name)) continue
    withEntry(next, parent, name, { name, folder: isFolder, ignored: false })
    if (isFolder) next.set(childOf(parent, name), { entries: [], truncated: false })
  }
  return next
}

// What the panel knows of the folders once `from` moved to `to`: the entry in its new folder, and
// the folders read inside one moved under their new paths, so an open folder keeps what it lists.
export const listingsMoved = (listings: Listings, from: string, to: string): Listings => {
  const listing = listings.get(parentOf(from))
  const entry =
    typeof listing === "object"
      ? listing.entries.find((each) => each.name === nameOf(from))
      : undefined
  const next = new Map([...listings].map(([path, read]) => [moved(path, from, to), read]))
  withEntry(next, parentOf(from), nameOf(from), undefined)
  if (entry) withEntry(next, parentOf(to), nameOf(to), { ...entry, name: nameOf(to) })
  return next
}

// What the panel knows of the folders once a copy is made at `path`, a folder or not, until they
// are read again: the copy in its folder, where that folder is read. What a folder copied holds is
// left for its own read, as it opens.
export const listingsCopied = (listings: Listings, path: string, folder: boolean): Listings => {
  const next = new Map(listings)
  withEntry(next, parentOf(path), nameOf(path), { name: nameOf(path), folder, ignored: false })
  return next
}

// Whether the folders read so far say `path` is gone: a folder on its way, or its own, read in
// full without the next name. What isn't read, or couldn't be, says nothing.
export const listedAway = (listings: Listings, path: string): boolean => {
  const names = path.split("/")
  return names.some((name, at) => {
    const listing = listings.get(names.slice(0, at).join("/"))
    return (
      typeof listing === "object" &&
      !listing.truncated &&
      !listing.entries.some((each) => each.name === name)
    )
  })
}

// Whether the folders read say the entry at `from` is at `to` now: gone from where it was, and
// listed where it went.
export const listedMoved = (listings: Listings, from: string, to: string): boolean => {
  const there = listings.get(parentOf(to))
  return (
    listedAway(listings, from) &&
    typeof there === "object" &&
    there.entries.some((each) => each.name === nameOf(to))
  )
}

// What the panel knows of the folders once `path` is deleted: neither it nor anything below it.
export const listingsRemoved = (listings: Listings, path: string): Listings => {
  const next = new Map([...listings].filter(([each]) => !atOrBelow(each, path)))
  withEntry(next, parentOf(path), nameOf(path), undefined)
  return next
}

// The row to give focus to once `path`, and everything below it, leaves the rows: the one after
// it, else the one before.
export const rowAfterLeaving = (rows: readonly FilesRow[], path: string): FilesRow | undefined => {
  const index = rows.findIndex((each) => each.node.path === path)
  const stays = (each: FilesRow): boolean => !atOrBelow(each.node.path, path)
  return rows.slice(index + 1).find(stays) ?? rows.slice(0, Math.max(0, index)).findLast(stays)
}
