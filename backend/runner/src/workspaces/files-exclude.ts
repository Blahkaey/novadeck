import { filesExcludeLimits, type FilesExclude } from "@novadeck/protocol"

import { DomainError } from "../errors.js"
import { logs } from "../log.js"

const log = logs.for("files-exclude")

// A project's own patterns for hiding files from its Files panel, which the client matches and
// the runner only keeps: one settings row a project, as its notes are, written whole.

/** What a project's patterns are kept with. */
export type FilesExcludeRecords = {
  /** A project's patterns as `saveFilesExclude` kept them; undefined where it has none. */
  savedFilesExcludeOf(projectId: string): string | undefined
  /** Keeps a project's patterns, or none for null; NOT_FOUND for a project it doesn't have. */
  saveFilesExclude(projectId: string, patterns: string | null): void
  /** NOT_FOUND for a project it doesn't have. */
  project(projectId: string): unknown
}

// The patterns a kept row holds that this build can: a switch each, under a pattern no longer
// than a project's may be. An entry another build wrote otherwise, as a `when` clause, is left
// out, so the rest stay.
const kept = (saved: unknown): FilesExclude => {
  if (typeof saved !== "object" || saved === null || Array.isArray(saved))
    throw new Error("A project's patterns are kept as a map")
  return Object.fromEntries(
    Object.entries(saved).filter(
      ([pattern, on]) =>
        typeof on === "boolean" &&
        pattern.length > 0 &&
        pattern.length <= filesExcludeLimits.pattern,
    ),
  )
}

/**
 * A project's patterns as they were last saved: none before. A row that can't be read is logged
 * and counts as none, so the panel goes on; the next save replaces it. NOT_FOUND for a project
 * the runner doesn't have.
 */
export const filesExcludeOf = (records: FilesExcludeRecords, projectId: string): FilesExclude => {
  records.project(projectId)
  const saved = records.savedFilesExcludeOf(projectId)
  if (saved === undefined) return {}
  try {
    return kept(JSON.parse(saved))
  } catch (error) {
    log.warn("files-exclude.read-failed", "Novadeck could not read a project's hidden files", {
      data: { projectId },
      err: error,
    })
    return {}
  }
}

/**
 * Replaces a project's patterns whole; none forgets them. More than
 * `filesExcludeLimits.patterns` is a CONFLICT that says so, and keeps what was there. NOT_FOUND
 * for a project the runner doesn't have.
 */
export const saveFilesExclude = (
  records: FilesExcludeRecords,
  projectId: string,
  patterns: FilesExclude,
): void => {
  records.project(projectId)
  const count = Object.keys(patterns).length
  if (count > filesExcludeLimits.patterns)
    throw new DomainError(
      "CONFLICT",
      `A project keeps at most ${filesExcludeLimits.patterns} patterns for hiding files. Remove some to add more.`,
    )
  records.saveFilesExclude(projectId, count === 0 ? null : JSON.stringify(patterns))
}
