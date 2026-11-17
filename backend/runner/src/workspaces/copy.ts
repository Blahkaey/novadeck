import { constants, type BigIntStats } from "node:fs"
import { chmod, copyFile, lstat, mkdir, readdir, readlink, symlink } from "node:fs/promises"
import { join } from "node:path"

import { DomainError } from "../errors.js"

// The copies the Files panel pastes, apart from where they may go, which `copyEntry` in
// entries.ts decides: the name a copy takes, and the copy itself. A copy never follows a link: a
// link is copied as a link, with its target as it is written, and what it leads to is never read.
// A file keeps its mode, and a folder its own once everything in it is copied. Each entry is made
// exclusively, so nothing that is there already is written into or replaced.

/**
 * The name to try after `name` for a copy of a file or, with `folder`, a folder, as VS Code names
 * copies: `cart.ts`, `cart copy.ts`, `cart copy 2.ts`, `cart copy 3.ts`. A file's extension, from
 * its last dot unless that dot leads the name, stays at its end; a folder's whole name, and a name
 * whose only dot leads it, as `.env`, take the copy at their end.
 */
export const copyName = (name: string, folder: boolean): string => {
  const dot = folder ? -1 : name.lastIndexOf(".")
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  const counted = /^(.+ copy)(?: (\d+))?$/.exec(stem)
  return counted
    ? `${counted[1]} ${Number(counted[2] ?? 1) + 1}${extension}`
    : `${stem} copy${extension}`
}

// What the system calls an entry that is no file, folder or link, which isn't copied.
const special = (entry: BigIntStats): string =>
  entry.isSocket() ? "a socket" : entry.isFIFO() ? "a named pipe" : "a device"

const codeOf = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined

// Why a link at `shown` couldn't be made, where the system refuses to make one: on Windows, an
// account that is no administrator, without Developer Mode; elsewhere, a disk that holds no
// links, as one formatted FAT.
const linkRefusal = (shown: string): string =>
  process.platform === "win32"
    ? `${shown} is a link, and Windows makes links only for an administrator or with Developer Mode on.`
    : `${shown} is a link, and the disk it would be copied to holds no links.`

/**
 * Makes `target` a copy of the entry at `source` that isn't a folder, `entry` its `lstat`: a link
 * as a link, or a file whole with its mode, as a clone of it where the filesystem makes one, which
 * Node removes again if the copy fails part way. Rejects with the system's EEXIST, having made
 * nothing, where something is at `target`. A link the system won't make, and a socket, pipe or
 * device, which isn't copied, are WRITE_REFUSED, naming it by `shown`, its path from the
 * project's root.
 */
const copyOne = async (
  source: string,
  entry: BigIntStats,
  target: string,
  shown: string,
): Promise<void> => {
  if (entry.isSymbolicLink())
    return symlink(await readlink(source), target).catch((error: unknown) => {
      throw codeOf(error) === "EPERM" ? new DomainError("WRITE_REFUSED", linkRefusal(shown)) : error
    })
  if (entry.isFile())
    return copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
  throw new DomainError("WRITE_REFUSED", `${shown} is ${special(entry)}, which can't be copied.`)
}

/**
 * Makes `target` as a copy of the entry at `source`, `entry` its `lstat`, as `copyOne` does, or
 * for a folder an empty one, which `copyInto` then fills. Rejects with the system's EEXIST, having
 * made nothing, where something is at `target`, a link that leads nowhere too.
 */
export const copyTop = (
  source: string,
  entry: BigIntStats,
  target: string,
  shown: string,
): Promise<void> =>
  entry.isDirectory() ? mkdir(target).then(() => {}) : copyOne(source, entry, target, shown)

/** An entry a copy copied, at `path`, as `lstat` found it just before. */
export type Copied = { readonly path: string; readonly entry: BigIntStats }

/**
 * Gives the folder `folder`, which a copy made, the mode `mode` of the one it copies, where the
 * system made it with another. A filesystem that takes no modes, as a Windows share, refuses with
 * EPERM: the folder keeps the one it was made with, as Node's copy of a file does there.
 */
const keepMode = async (folder: string, mode: number): Promise<void> => {
  if (((await lstat(folder)).mode & 0o7777) === (mode & 0o7777)) return
  await chmod(folder, mode & 0o7777).catch((error: unknown) => {
    if (codeOf(error) !== "EPERM") throw error
  })
}

/**
 * Copies what the folder `source` holds into `target`, the empty folder `copyTop` made for it,
 * one entry at a time, so a big folder holds no more than one file open, and answers what it
 * copied, each folder after what it holds. Once everything is in, each folder made, and `target`
 * too, keeps the mode of the one it copies (`mode` for `target`), deepest first, so a folder that
 * can only be read is filled before it is. Rejects with the system's error, or as `copyOne`
 * refuses, `shown` being `source`'s path from the project's root, leaving what was copied for the
 * caller to remove.
 */
export const copyInto = async (
  source: string,
  target: string,
  mode: number,
  shown: string,
): Promise<readonly Copied[]> => {
  const copied: Copied[] = []
  const modes: (readonly [string, number])[] = []
  const copyEach = async (from: string, to: string, at: string): Promise<void> => {
    const entry = await lstat(from, { bigint: true })
    if (entry.isDirectory()) {
      await mkdir(to)
      await fill(from, to, at)
      modes.push([to, Number(entry.mode)])
    } else await copyOne(from, entry, to, at)
    copied.push({ path: from, entry })
  }
  const fill = async (from: string, to: string, at: string): Promise<void> => {
    for (const name of await readdir(from))
      // eslint-disable-next-line no-await-in-loop -- One entry at a time: a folder holds any number.
      await copyEach(join(from, name), join(to, name), `${at}/${name}`)
  }
  await fill(source, target, shown)
  for (const [folder, its] of [...modes, [target, mode] as const])
    // eslint-disable-next-line no-await-in-loop -- Deepest first: a folder may shut out the way.
    await keepMode(folder, its)
  return copied
}
