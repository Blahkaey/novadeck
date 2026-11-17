import type { Stats } from "node:fs"

/** What says a file changed: its size, when it last changed, and which file it is. */
export const stampOf = (stats: Stats): string => `${stats.size}:${stats.mtimeMs}:${stats.ino}`

/** The error code of a failed file operation, such as `EACCES`. */
export const errnoOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined

/** Whether an error says a path is not there: nothing to read, rather than a failed read. */
export const isMissing = (error: unknown): boolean => {
  const code = errnoOf(error)
  return code === "ENOENT" || code === "ENOTDIR"
}
