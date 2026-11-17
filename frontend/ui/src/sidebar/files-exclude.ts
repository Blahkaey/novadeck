import type { FilesExclude } from "@novadeck/core/files"
import picomatch from "picomatch/posix"

// Which paths the Files panel hides, from the person's patterns for every project and the
// project's own over them, written as VS Code's `files.exclude`: `*` any characters within a
// name, `?` one, `**` any number of folders (none included), `{a,b}` either, `[ab]` one of a
// set. A pattern is matched against the path from the project's root, dot files included, so
// `*.log` hides only the logs at the top and `**/*.log` every one. Patterns are VS Code's and no
// more: a leading `!` and `@(…)`-style groups match themselves.

// Whether a path from the project's root, with `/` between names, matches a pattern that is on.
export type Hides = (path: string) => boolean

const options: picomatch.PicomatchOptions = { dot: true, nonegate: true, noextglob: true }

// The patterns on once the project's are laid over the person's: the project's switch wins for
// a pattern both have, so its `false` lifts one of theirs. Compiled once, for every path asked.
export const hidesOf = (everywhere: FilesExclude, project: FilesExclude): Hides => {
  const merged = { ...everywhere, ...project }
  const matches = picomatch(
    Object.keys(merged).filter((pattern) => merged[pattern]),
    options,
  )
  // One argument only: picomatch's second asks for an object, which an array method would pass.
  return (path) => matches(path)
}

// The path and each folder above it, outermost first.
const pathsTo = (path: string): string[] => {
  const parts = path.split("/")
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"))
}

// Whether the tree leaves a path out: it, or a folder above it, is hidden.
export const hiddenUnder = (hides: Hides, path: string): boolean =>
  pathsTo(path).some((each) => hides(each))

// The pattern that leaves a path out of the tree, matching it or a folder above it, where one
// does: the first that is on once the project's are laid over the person's.
export const hidingPattern = (
  everywhere: FilesExclude,
  project: FilesExclude,
  path: string,
): string | undefined => {
  const merged = { ...everywhere, ...project }
  const paths = pathsTo(path)
  return Object.keys(merged).find((pattern) => {
    if (!merged[pattern]) return false
    const matches = picomatch(pattern, options)
    return paths.some((each) => matches(each))
  })
}

// The pattern that hides exactly this path: what the matcher reads as more than itself escaped,
// so `[id]`, `{a,b}`, a name that is `*.md` and a `"`, which would start a quoted run, mean
// themselves. A backslash goes in brackets, as `[\\]`: the matcher folds a run of escaped ones.
export const exactPattern = (path: string): string =>
  path.replace(/[\\*?[\]{}()!+@|^$,"]/g, (character) =>
    character === "\\" ? "[\\\\]" : `\\${character}`,
  )
