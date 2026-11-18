// Paths from a project's root, `/` between names, and the trees that hold them, as the demo's
// files keep them.

// Whether `each` is `path` or lies below it.
export const atOrBelow = (each: string, path: string): boolean =>
  each === path || each.startsWith(`${path}/`)

// A path at or below `from` as it is once `from` moved to `to`; any other as it is.
export const movedTo = (each: string, from: string, to: string): string =>
  atOrBelow(each, from) ? `${to}${each.slice(from.length)}` : each

export const trimmed = (path: string): string => (path.endsWith("/") ? path.slice(0, -1) : path)

// The folder `path` is in, "" for the project's root.
export const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")))

// A project's tree, as the fixtures hold it: an entry ending in `/` is a folder with nothing in
// it, and `ignored` names what the project's VCS ignores.
export type Tree = { readonly entries: readonly string[]; readonly ignored: readonly string[] }

// What a tree holds at `path`: a file, a folder (empty, or holding paths below), or nothing.
export const holds = (tree: Tree, path: string): "file" | "folder" | undefined => {
  for (const entry of tree.entries) {
    const each = trimmed(entry)
    if (each === path) return entry.endsWith("/") ? "folder" : "file"
    if (each.startsWith(`${path}/`)) return "folder"
  }
  return undefined
}
