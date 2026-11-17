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

// Whether the tree leaves a path out: it, or a folder above it, is hidden.
export const hiddenUnder = (hides: Hides, path: string): boolean => {
  const parts = path.split("/")
  return parts.some((_, index) => hides(parts.slice(0, index + 1).join("/")))
}

// The pattern that hides exactly this path: what the matcher reads as more than itself escaped,
// so `[id]`, `{a,b}`, a name that is `*.md` and a `"`, which would start a quoted run, mean
// themselves. A backslash goes in brackets, as `[\\]`: the matcher folds a run of escaped ones.
export const exactPattern = (path: string): string =>
  path.replace(/[\\*?[\]{}()!+@|^$,"]/g, (character) =>
    character === "\\" ? "[\\\\]" : `\\${character}`,
  )
