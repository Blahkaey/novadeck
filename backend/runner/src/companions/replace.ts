import { constants, type Stats } from "node:fs"
import { lstat, open, rename, unlink } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import type { PlanUnwritable } from "@novadeck/protocol"

import { DomainError } from "../errors.js"
import { errnoOf, isMissing, stampOf } from "./stamps.js"

/** Why an edit can't be written, as `PLAN_UNWRITABLE` carries it. */
export const unwritable = (reason: PlanUnwritable["reason"], message: string) =>
  new DomainError("PLAN_UNWRITABLE", message, { reason })

const renameTries = 3
const renameWait = 100

/**
 * Renames over a file. Another program holding it open (a scanner, an indexer, an editor)
 * makes this fail for a moment on Windows with EPERM, EACCES or EBUSY, so it is tried a few
 * times before giving up.
 */
const renameSettled = async (from: string, to: string): Promise<void> => {
  for (let tried = 1; ; tried++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- One try after another.
      await rename(from, to)
      return
    } catch (error) {
      const code = errnoOf(error)
      if (tried >= renameTries || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY"))
        throw error
      // eslint-disable-next-line no-await-in-loop -- Waits between tries.
      await new Promise((done) => setTimeout(done, renameWait))
    }
  }
}

/** What a replace's refusals and failures say of the file, as "The plan's file is gone." */
export type ReplaceWords = {
  readonly gone: string
  readonly folder: string
  /** The failure to read the file again, which is raised without its code. */
  readonly unread: string
}

/**
 * Replaces the regular file at the real path `path`, which `read` found at `stamp`, with
 * `data`, unless it changed since. The data goes to a temporary file beside it
 * (`.name.pid.ms.tmp`), which replaces it at once, so a reader sees the old file or the new,
 * never a part. The new file is a new file: it keeps the old one's permission bits (`0o777`),
 * but is owned by the runner's account and group (a group-writable file someone else owns
 * becomes the runner's), drops setuid, setgid and the sticky bit, and has none of the old
 * one's ACLs or extended attributes; another name hard-linked to the old file keeps the old
 * text. The temporary file goes whatever happens, unless the runner stops partway, which
 * leaves it there. Once the data is on disk, the file is read again with `read`: one at
 * another stamp now is left as it is, and what `read` found of it comes back as `now`. What
 * `read` refuses as PLAN_UNWRITABLE is raised as it is. Refused as PLAN_UNWRITABLE, as
 * `words` say it: a file gone or no longer a plain file (`gone`), a folder or file the runner
 * may not write (`folder`): EROFS, or EACCES or EPERM, as the folder refuses the temporary
 * file or the file still refuses the rename after its tries (an ACL on Windows, whose
 * `access` reads only the read-only attribute, or a program holding the file that long).
 * Any other failure, such as a full disk, or a rename still EBUSY, is not classified: it may
 * pass, so it is raised as it is.
 */
export const replaceFile = async <Read extends { readonly stamp: string }>(
  path: string,
  data: string,
  stamp: string,
  read: (path: string) => Promise<Read | undefined>,
  words: ReplaceWords,
): Promise<
  { readonly saved: true; readonly stamp: string } | { readonly saved: false; readonly now: Read }
> => {
  const stats = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined
    throw error
  })
  if (!stats?.isFile()) throw unwritable("gone", words.gone)
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  const mode = stats.mode & 0o777
  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      mode,
    )
    let written: Stats
    try {
      // The umask clipped the mode it was created with.
      // A file system without modes (FAT, some network shares) refuses; the save goes on.
      await handle.chmod(mode).catch(() => {})
      await handle.writeFile(data)
      await handle.sync()
      written = await handle.stat()
    } finally {
      await handle.close()
    }
    // Something else may have rewritten the file since it was read: its version stands.
    // A failed read is not the folder refusing: it is raised without its code.
    const now = await read(path).catch((error: unknown) => {
      if (error instanceof DomainError) throw error
      throw new Error(words.unread, { cause: error })
    })
    if (!now) throw unwritable("gone", words.gone)
    if (now.stamp !== stamp) {
      await unlink(temporary).catch(() => {})
      return { saved: false, now }
    }
    await renameSettled(temporary, path)
    // Its size, change time and file survive the rename.
    return { saved: true, stamp: stampOf(written) }
  } catch (error) {
    await unlink(temporary).catch(() => {})
    if (error instanceof DomainError) throw error
    const code = errnoOf(error)
    // The folder, or the file, refuses the runner: saving again won't help.
    if (code === "EROFS" || code === "EACCES" || code === "EPERM")
      throw unwritable("folder", words.folder)
    if (code === "ENOENT") throw unwritable("gone", words.gone)
    throw error
  }
}
