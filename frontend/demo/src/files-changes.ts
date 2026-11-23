import type { FilesProject } from "@novadeck/core/files"

import { atOrBelow, holds, movedTo, parentOf, trimmed, type Tree } from "./project-paths"

// The person's changes to a project's tree in the Files panel, as the runner makes them: each
// the tree it leaves, or, refused as the runner refuses it, its words; and what the agents' work
// on the project becomes. Only ./files.ts loads this, with the person's first change, out of the
// visitor build's demo load.

// The project's changes and cursors once the person moved `from` to `to`: the agents' work on
// it, and on what is in it, follows it.
export const movedIn = (project: FilesProject, from: string, to: string): FilesProject => ({
  changes: Object.fromEntries(
    Object.entries(project.changes).map(([path, change]) => [movedTo(path, from, to), change]),
  ),
  writing: Object.fromEntries(
    Object.entries(project.writing).map(([handle, path]) => [handle, movedTo(path, from, to)]),
  ),
})

// The project's changes and cursors once the person deleted `path`: none at it or in it.
export const removedIn = (project: FilesProject, path: string): FilesProject => ({
  changes: Object.fromEntries(
    Object.entries(project.changes).filter(([each]) => !atOrBelow(each, path)),
  ),
  writing: Object.fromEntries(
    Object.entries(project.writing).filter(([, each]) => !atOrBelow(each, path)),
  ),
})

// A tree with `path` and what is below it gone, its folder kept, empty, where nothing else is in
// it.
const without = (tree: Tree, path: string): Tree => {
  const left = tree.entries.filter((entry) => !atOrBelow(trimmed(entry), path))
  const folder = parentOf(path)
  const kept =
    folder === "" || holds({ ...tree, entries: left }, folder) ? left : [...left, `${folder}/`]
  return { entries: kept, ignored: tree.ignored.filter((each) => !atOrBelow(trimmed(each), path)) }
}

// Why the runner refuses to change `path`: the project's folder itself, and Git's own `.git`.
const untouchable = (path: string): string | undefined =>
  path === ""
    ? "Novadeck doesn't change the project's folder itself."
    : path.split("/").some((name) => name.toLowerCase() === ".git")
      ? "Novadeck doesn't change Git's own .git."
      : undefined

// Throws as the runner would for `path`.
const refuse = (path: string): void => {
  const why = untouchable(path)
  if (why) throw new Error(why)
}

// The runner's words for a name taken in `folder`.
const takenIn = (folder: string, name: string): string =>
  `There's already something named ${name} in ${folder === "" ? "the project's folder" : folder}.`

const childOf = (folder: string, name: string): string =>
  folder === "" ? name : `${folder}/${name}`

// The name to try after `name` for a copy of a file or, with `folder`, a folder, as the runner
// names copies (`copyName` in backend/runner/src/workspaces/copy.ts), as VS Code does: `cart.ts`,
// `cart copy.ts`, `cart copy 2.ts`; a folder's whole name, and a dotfile's, take it at their end.
export const copyName = (name: string, folder: boolean): string => {
  const dot = folder ? -1 : name.lastIndexOf(".")
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  const counted = /^(.+ copy)(?: (\d+))?$/.exec(stem)
  return counted
    ? `${counted[1]} ${Number(counted[2] ?? 1) + 1}${extension}`
    : `${stem} copy${extension}`
}

// The tree once the person made the file, or with `folder` the folder, at `path`.
export const made = (tree: Tree, path: string, folder: boolean): Tree => {
  refuse(path)
  const names = path.split("/")
  for (const at of names.keys()) {
    const way = names.slice(0, at + 1).join("/")
    const there = holds(tree, way)
    if (at === names.length - 1 && there)
      throw new Error(takenIn(names.slice(0, -1).join("/"), names.at(-1)!))
    if (there === "file") throw new Error(`${way} isn't a folder.`)
  }
  // A folder that held nothing holds it now.
  const kept = tree.entries.filter((entry) => !(entry.endsWith("/") && path.startsWith(entry)))
  return { ...tree, entries: [...kept, folder ? `${path}/` : path] }
}

// The tree once the person moved `from` to `to`: renamed it, or pasted it after a cut.
export const moved = (tree: Tree, from: string, to: string): Tree => {
  refuse(from)
  refuse(to)
  if (!holds(tree, from)) throw new Error(`${from} isn't there any more.`)
  const folder = parentOf(to)
  if (folder !== "" && holds(tree, folder) !== "folder")
    throw new Error(`${folder} isn't there any more.`)
  if (holds(tree, from) === "folder" && atOrBelow(to, from))
    throw new Error("A folder can't move into itself.")
  if (holds(tree, to)) throw new Error(takenIn(folder, to.slice(to.lastIndexOf("/") + 1)))
  const left = without(tree, from)
  return {
    entries: [
      ...left.entries.filter((entry) => !(entry.endsWith("/") && to.startsWith(entry))),
      ...tree.entries
        .filter((entry) => atOrBelow(trimmed(entry), from))
        .map((entry) => movedTo(entry, from, to)),
    ],
    ignored: [
      ...left.ignored,
      ...tree.ignored
        .filter((each) => atOrBelow(trimmed(each), from))
        .map((each) => movedTo(each, from, to)),
    ],
  }
}

// The tree once the person copied `from` into the folder `into`, under the name the runner would
// give the copy, and where the copy is.
export const copied = (
  tree: Tree,
  from: string,
  into: string,
): { readonly tree: Tree; readonly to: string } => {
  refuse(from)
  if (into !== "") refuse(into)
  const kind = holds(tree, from)
  if (!kind) throw new Error(`${from} isn't there any more.`)
  const there = into === "" ? "folder" : holds(tree, into)
  if (there !== "folder")
    throw new Error(there ? `${into} isn't a folder.` : `${into} isn't there any more.`)
  const folder = kind === "folder"
  if (folder && atOrBelow(into, from)) throw new Error("A folder can't be copied into itself.")
  const name = from.slice(from.lastIndexOf("/") + 1)
  let named = parentOf(from) === into ? copyName(name, folder) : name
  while (holds(tree, childOf(into, named))) named = copyName(named, folder)
  const to = childOf(into, named)
  const copies = (each: string): boolean => atOrBelow(trimmed(each), from)
  return {
    tree: {
      entries: [
        ...tree.entries.filter((entry) => !(entry.endsWith("/") && to.startsWith(entry))),
        ...tree.entries.filter(copies).map((entry) => movedTo(entry, from, to)),
      ],
      ignored: [
        ...tree.ignored,
        ...tree.ignored.filter(copies).map((each) => movedTo(each, from, to)),
      ],
    },
    to,
  }
}

// The tree once the person deleted `path`.
export const removed = (tree: Tree, path: string): Tree => {
  refuse(path)
  if (!holds(tree, path)) throw new Error(`${path} isn't there any more.`)
  return without(tree, path)
}
