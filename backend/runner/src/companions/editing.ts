import { constants } from "node:fs"
import { access, realpath } from "node:fs/promises"
import { dirname } from "node:path"

import {
  companionLimits,
  fitsRunner,
  type ItemContent,
  type PlanSaveResult,
  type PlanUnwritable,
} from "@novadeck/protocol"

import { inGit, within } from "../workspaces/project-paths.js"
import {
  inside,
  loadFile,
  openPlain,
  openShown,
  readUpTo,
  reasonOf,
  sniffBytes,
  unavailable,
} from "./content.js"
import type { ItemRecord } from "./records.js"
import { replaceFile, unwritable, type ReplaceWords } from "./replace.js"
import { isMissing, stampOf } from "./stamps.js"

// The file the person opened in their session's project window, edited whole: its text
// followed with `edit` (`loadText`), and their edit written back (`saveText`).

/** The most of a file edited, in bytes: what one save carries, as of a plan. */
const maxTextBytes = companionLimits.plan
const byteOrderMark = Buffer.from([0xef, 0xbb, 0xbf])

/**
 * A file's bytes as the person edits them: its text, decoded as UTF-8 without its byte-order
 * mark, and whether it has one; or why it can't be edited whole: `binary` for a NUL byte near
 * its start, as its listing judges it, `too-large` past 256 KiB or past what one save
 * carries, `not-text` where it isn't valid UTF-8.
 */
type Whole = { readonly text: string; readonly bom: boolean } | "binary" | "too-large" | "not-text"

const wholeOf = ({ bytes, more }: { readonly bytes: Buffer; readonly more: boolean }): Whole => {
  if (bytes.subarray(0, sniffBytes).includes(0)) return "binary"
  if (more) return "too-large"
  let text: string
  try {
    // A byte-order mark is left out; it goes back on as the file is saved.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return "not-text"
  }
  if (!fitsRunner(text, maxTextBytes)) return "too-large"
  return { text, bom: bytes.subarray(0, byteOrderMark.length).equals(byteOrderMark) }
}

/**
 * Where the person may save the file their session's project window holds: inside its
 * project's folder, `project`, and outside `worktrees`, the folder agents' worktrees live in,
 * unless the project's folder is itself in there.
 */
export type SaveFolders = { readonly project: string; readonly worktrees: string }

/** Why the person can't save a file of their project window that is theirs to edit. */
type Unsaved = Extract<PlanUnwritable["reason"], "outside" | "folder">

const unsavedWords: { readonly [Reason in Unsaved]: string } = {
  outside:
    "Novadeck saves only files in the project's folder, outside Git's own .git and agents' worktrees.",
  folder: "Novadeck may not write this file, or in its folder.",
}

/**
 * Why the person can't save the file at the real path `path`, in their project window, which
 * `folders` place; undefined where they can. Only a file inside the project's folder, compared
 * as the real paths they are, is saved, and none in Git's own `.git` there, however a link or
 * a name leads to it, nor in agents' worktrees where the project's folder holds them, as a
 * project of the person's home folder does: an agent's copy is never the person's to save
 * (`outside`). A project whose own folder is in agents' worktrees, one the person made of a
 * worktree, is theirs to save like any. Only a file the runner may write, in a folder it may
 * write in, is saved (`folder`).
 */
const unsaved = async (path: string, folders: SaveFolders): Promise<Unsaved | undefined> => {
  const project = await realpath(folders.project).catch(() => undefined)
  const worktrees = await realpath(folders.worktrees).catch(() => undefined)
  if (
    project === undefined ||
    !(await inside(path, [project])) ||
    inGit(project, path) ||
    (worktrees !== undefined && !within(worktrees, project) && within(worktrees, path))
  )
    return "outside"
  const writes = await Promise.all([
    access(path, constants.W_OK),
    access(dirname(path), constants.W_OK),
  ]).then(
    () => true,
    () => false,
  )
  return writes ? undefined : "folder"
}

/** A file's listing, saying why it can't be edited whole; anything else as it is. */
const listing = (content: ItemContent, why: "too-large" | "not-text"): ItemContent =>
  content.state === "ready" && content.content.kind === "file"
    ? { ...content, content: { ...content.content, uneditable: why } }
    : content

/**
 * A file item's whole text, for the person to edit, as it is now, symlinks resolved, and
 * whether `saveText` writes it, `folders` being as `saveText` takes them. One that may hold
 * secrets is `secret` unless `reveal`, and one with a NUL byte near its start `binary`, as
 * `loadFile` has them; one that can't be edited whole is its listing, saying why. One whose
 * size is past the limit is listed without reading it whole first.
 */
export const loadText = async (
  item: Pick<ItemRecord, "kind" | "path" | "lines" | "secret">,
  reveal: boolean,
  folders: SaveFolders | undefined,
  env?: NodeJS.ProcessEnv,
): Promise<ItemContent> => {
  if (item.path === null) return unavailable("missing")
  const opened = await openShown(item.path, { secret: item.secret, reveal }, env)
  if ("state" in opened) return opened
  const { path, handle, stats } = opened
  let whole: Whole
  try {
    // A size may say less than a file holds (one in /proc says 0), never more: one past the
    // limit is not read.
    whole = stats.size > maxTextBytes ? "too-large" : wholeOf(await readUpTo(handle, maxTextBytes))
  } catch (error) {
    return unavailable(reasonOf(error))
  } finally {
    await handle.close().catch(() => {})
  }
  if (whole === "binary") return unavailable("binary", stats.size)
  if (typeof whole === "string") return listing(await loadFile(item, reveal, env), whole)
  const reason = folders === undefined ? "not-a-plan" : await unsaved(path, folders)
  const text = { kind: "text", path: item.path, text: whole.text } as const
  return {
    state: "ready",
    stamp: stampOf(stats),
    content:
      reason === undefined ? { ...text, writable: true } : { ...text, writable: false, reason },
  }
}

const moved = () => unwritable("moved", "That edit was made on another file than this one.")

/**
 * Refuses a plan's edit made on another file than the one `item` points at now, as
 * PLAN_UNWRITABLE `moved`. Without `path`, any is taken, as a plan's client may leave it out.
 */
export const refuseMoved = (item: Pick<ItemRecord, "path">, path: string | undefined): void => {
  if (path !== undefined && path !== item.path) throw moved()
}

const fileWords: ReplaceWords = {
  gone: "The file is gone.",
  folder: "The file's folder can't be written to.",
  unread: "The file couldn't be read.",
}

/**
 * The file at the real path `path` as the person edits it, with its stamp; undefined while it
 * is not there, or no plain file. One that can't be edited whole is refused as
 * PLAN_UNWRITABLE: `too-large`, or `not-text` where it is binary or not UTF-8.
 */
const readEditable = async (
  path: string,
): Promise<
  { readonly stamp: string; readonly text: string; readonly bom: boolean } | undefined
> => {
  let opened: Awaited<ReturnType<typeof openPlain>>
  try {
    opened = await openPlain(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  if ("state" in opened) return undefined
  let whole: Whole
  try {
    whole = wholeOf(await readUpTo(opened.handle, maxTextBytes))
  } finally {
    await opened.handle.close().catch(() => {})
  }
  if (whole === "too-large") throw unwritable("too-large", "That file is too large to edit.")
  if (typeof whole === "string")
    throw unwritable("not-text", "That file is no longer text Novadeck can edit.")
  return { stamp: stampOf(opened.stats), ...whole }
}

/** A file's text as `companions.save` answers it, as a plan's would be: never cut short. */
const currentOf = ({ stamp, text }: { readonly stamp: string; readonly text: string }) =>
  ({ saved: false, current: { stamp, text, truncated: false, skill: false } }) as const

/**
 * Writes the person's edit to the file they opened in their session's project window, unless
 * the file is no longer as it was at stamp `basedOn`: then nothing is written and `current` is
 * its text now. `folders` place such an item (see `unsaved`), undefined for any other; `path`
 * is the path the edit was made on, which must be the one the item points at now. The text
 * replaces the file at once (see `replaceFile`), with the byte-order mark the file has then
 * put back before it. Refused as PLAN_UNWRITABLE, saying why: any item but a file of a project
 * window (`not-a-plan`); an edit without `path`, or made on another file than the item points
 * at now (`moved`), as when another window pointed it at the next file meanwhile; a file
 * outside the project's folder, in Git's own `.git` or in agents' worktrees (`outside`); one
 * the runner may not write, or in a folder it may not write in (`folder`); one gone or no
 * plain file (`gone`); a text or file past what one save carries (`too-large`); a file that is
 * binary or not UTF-8 now (`not-text`). Any other failure may pass, and is raised as it is.
 */
export const saveText = async (
  item: Pick<ItemRecord, "kind" | "path">,
  edit: { readonly text: string; readonly basedOn: string; readonly path?: string | undefined },
  folders: SaveFolders | undefined,
): Promise<PlanSaveResult> => {
  if (item.kind !== "file" || item.path === null || folders === undefined)
    throw unwritable("not-a-plan", "Novadeck saves only the file open in the project window.")
  // Without the path it was made on, the edit can't be told to be this file's.
  if (edit.path !== item.path) throw moved()
  // The file a link points at is the one written; the link is left in place.
  const path = await realpath(item.path).catch((error: unknown) => {
    if (isMissing(error)) return undefined
    throw error
  })
  if (path === undefined) throw unwritable("gone", fileWords.gone)
  const why = await unsaved(path, folders)
  if (why !== undefined) throw unwritable(why, unsavedWords[why])
  const before = await readEditable(path)
  if (before === undefined) throw unwritable("gone", fileWords.gone)
  const data = before.bom ? `\uFEFF${edit.text}` : edit.text
  if (Buffer.byteLength(data) > maxTextBytes)
    throw unwritable("too-large", "That text is too long to save.")
  if (before.stamp !== edit.basedOn) return currentOf(before)
  // Something else may have rewritten the file since it was read: its version stands.
  const replaced = await replaceFile(path, data, before.stamp, readEditable, fileWords)
  return replaced.saved ? replaced : currentOf(replaced.now)
}
