import { isAbsolute, relative, sep } from "node:path"

import { DomainError } from "../errors.js"

export const invalid = (message: string): DomainError =>
  new DomainError("INVALID_DIRECTORY", message)

/**
 * The names of a path in a project, which is relative to the project's root, `/` between names
 * and "" for the root itself. Refuses anything else, so a path can't lead out of the root.
 */
export const segments = (path: string): string[] => {
  if (path === "") return []
  if (path.includes("\\") || path.includes("\0"))
    throw invalid("That isn't a path inside the project.")
  const names = path.split("/")
  if (names.some((name) => name === "" || name === "." || name === ".."))
    throw invalid("That isn't a path inside the project.")
  return names
}

/** Whether `path` is `root` or lies inside it; both resolved alike. */
export const within = (root: string, path: string): boolean => {
  const route = relative(root, path)
  return route === "" || (!isAbsolute(route) && route.split(sep)[0] !== "..")
}
