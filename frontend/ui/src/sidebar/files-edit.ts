import type { FolderEntry } from "@novadeck/core/files"

import type { FilesNode, FilesRow, FolderRead, Listings } from "./files-tree"

// The Files panel's changes to the project's files, apart from how it draws them: what the person
// is naming and whether the name will do, where a new entry goes, which rows they may change, and
// what the panel knows of the folders once a change is made, until they are read again.

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

// How the backend makes, moves and deletes the project's files and folders, by their paths from
// the root, each where it can (see `ProjectFiles`): `create` and `move` answer the path they made.
export type EntryChanges = {
  readonly create?: ((path: string, folder: boolean) => Promise<string>) | undefined
  readonly move?: ((from: string, to: string) => Promise<string>) | undefined
  readonly remove?: ((path: string) => Promise<void>) | undefined
}

export const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")))

export const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1)

const childOf = (parent: string, name: string): string =>
  parent === "" ? name : `${parent}/${name}`

// Where a new entry asked for on a row goes: inside a folder, beside a file, and in the root off
// a row.
export const newEntryIn = (row: FilesRow | undefined): string =>
  row === undefined ? "" : row.node.folder ? row.node.path : parentOf(row.node.path)

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
