import type { BigIntStats } from "node:fs"
import { lstat, mkdir, open, readdir, realpath, rename, rm, rmdir, stat } from "node:fs/promises"
import { join, relative, sep } from "node:path"

import type { EntryChanged } from "@novadeck/protocol"

import { DomainError } from "../errors.js"
import { invalid, segments, within } from "./project-paths.js"

// The person's changes to a project's files from the Files panel: an empty file or folder
// made, an entry renamed or moved, an entry deleted. Each works on a path from the project's
// root and is confined to the project's directory: the folder an entry is in, resolved through
// any links, must lie inside the project's, while the entry itself is never followed, so a link
// is renamed or deleted as a link. Nothing found there is overwritten. The root and Git's own
// `.git` are never changed, by any name that resolves into it. What is checked can change before
// the change is made, as a folder on the way swapped for a link, or a file made at a move's
// destination, which the rename then replaces: the confinement keeps a slip inside the project,
// not a process that runs as the person, which can change any file anyway.

const taken = (message: string): DomainError => new DomainError("CONFLICT", message)
const refused = (message: string): DomainError => new DomainError("WRITE_REFUSED", message)
const gitsOwn = (): DomainError => invalid("Novadeck doesn't change Git's own .git.")

// Names Windows keeps for devices, with or without an extension: a file "made" as `con.txt`
// is the console.
const windowsDevices = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i

/**
 * Why Windows can't keep `name` as the name of a file or folder, or undefined where it can: a
 * device's name, a character it refuses (`:` would make a stream of another file), or a space
 * or dot at its end, which it drops.
 */
export const windowsRefusal = (name: string): string | undefined => {
  if (windowsDevices.test(name.trimEnd())) return `Windows keeps the name ${name} for a device.`
  const character = [...name].find((each) => /[<>:"|?*]/.test(each) || each < " ")
  if (character !== undefined)
    return character < " "
      ? "Windows doesn't allow a control character in a name."
      : `Windows doesn't allow ${character} in a name.`
  if (/[ .]$/.test(name)) return "Windows doesn't allow a name to end with a space or a dot."
  return undefined
}

/**
 * The names of an entry's path: never the root, nor anything of Git's own `.git`, whatever
 * its letters' case, as a case-blind filesystem would take `.GIT` for it.
 */
const entryNames = (path: string): string[] => {
  const names = segments(path)
  if (names.length === 0) throw invalid("Novadeck doesn't change the project's folder itself.")
  if (names.some((name) => name.toLowerCase() === ".git")) throw gitsOwn()
  return names
}

/** The names of a path an entry is to have, which also must be names the system can keep. */
const newNames = (path: string): string[] => {
  const names = entryNames(path)
  if (process.platform !== "win32") return names
  const refusal = names.map(windowsRefusal).find((reason) => reason !== undefined)
  if (refusal !== undefined) throw refused(refusal)
  return names
}

/** A name taken in the folder `folder`, by its names from the root. */
const takenIn = (folder: readonly string[], name: string): DomainError =>
  taken(
    `There's already something named ${name} in ${folder.length === 0 ? "the project's folder" : folder.join("/")}.`,
  )

/** The system's code for a failure, as `ENOENT`; undefined for any other failure. */
const errnoOf = (error: unknown): string | undefined =>
  error instanceof Error && "errno" in error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined

/**
 * What the system's refusal to make, move or delete `path` means, in the person's words: a
 * name taken (CONFLICT), a path gone or no folder on the way (INVALID_DIRECTORY), or the system
 * refusing (WRITE_REFUSED). Anything that isn't the system's failure stays as it was.
 */
const failure = (error: unknown, path: string): unknown => {
  const code = errnoOf(error)
  if (code === undefined) return error
  switch (code) {
    case "EEXIST":
    case "ENOTEMPTY":
      return taken(`There's already something at ${path}.`)
    case "ENOENT":
      return invalid(`${path} isn't there any more.`)
    case "ENOTDIR":
      return invalid(`A folder on the way to ${path} is a file.`)
    // A name a filesystem won't keep, as one with `:` on a FAT disk.
    case "EINVAL":
      return refused("The system doesn't allow that name there.")
    case "EACCES":
    case "EPERM":
      return refused("The system doesn't allow it: permission denied.")
    case "EROFS":
      return refused("It's on a disk that can only be read.")
    case "EBUSY":
      return refused("It's in use by another program.")
    case "ENOSPC":
    case "EDQUOT":
      return refused("The disk is full.")
    case "EXDEV":
      return refused("It would move to another disk, which Novadeck can't do.")
    case "ENAMETOOLONG":
      return refused("The name is too long for the system.")
    case "ELOOP":
      return refused("Too many links lead to it.")
    default:
      return refused(`The system refused it (${code}).`)
  }
}

/** Runs one change of the filesystem, failing as `failure` says. */
const act = <T>(change: Promise<T>, path: string): Promise<T> =>
  change.catch((error: unknown) => {
    throw failure(error, path)
  })

/** The real path of the project's directory; INVALID_DIRECTORY once it is gone. */
const projectFolder = async (root: string): Promise<string> => {
  const real = await realpath(root).catch(() => undefined)
  if (real === undefined) throw invalid("The project's folder is gone.")
  return real
}

/**
 * Refuses `path`, a real path inside the project's real directory `real`, where it is Git's own
 * `.git` or lies in it, however the way to it was named: through a link, or by a Windows short
 * name such as `GIT~1`.
 */
const outsideGit = (real: string, path: string): void => {
  if (
    relative(real, path)
      .split(sep)
      .some((name) => name.toLowerCase() === ".git")
  )
    throw gitsOwn()
}

/**
 * The real path of the project's folder `names`, which must be there, be a folder, and lie
 * inside the project's real directory `real` however links lead, outside Git's own `.git`.
 */
const folderIn = async (real: string, names: readonly string[]): Promise<string> => {
  const shown = names.join("/")
  const folder = await act(realpath(join(real, ...names)), shown)
  if (!within(real, folder)) throw invalid(`${shown} leads outside the project.`)
  outsideGit(real, folder)
  const stats = await act(stat(folder), shown)
  if (!stats.isDirectory()) throw invalid(`${shown} isn't a folder.`)
  return folder
}

/**
 * The real path of the project's folder `way`, in the folder `parent` (its real path), made there
 * where it is missing, which `made` then notes.
 */
const folderOnTheWay = async (
  real: string,
  parent: string,
  way: readonly string[],
  made: string[],
): Promise<string> => {
  const next = join(parent, way.at(-1)!)
  // A link that leads nowhere is missing here, and taken once it is made.
  const missing = await realpath(next).then(
    () => false,
    (error: unknown) => {
      if (errnoOf(error) === "ENOENT") return true
      throw failure(error, way.join("/"))
    },
  )
  if (missing) {
    await act(mkdir(next), way.join("/"))
    made.push(next)
  }
  return folderIn(real, way)
}

/**
 * Makes an empty file, or with `folder` an empty folder, at `path` from the project's root
 * `root`, and the folders on the way that are missing, each inside the project. CONFLICT for a
 * name that is taken, as at the end of the way; the folders this made go again if it fails.
 */
export const createEntry = async (
  root: string,
  path: string,
  folder: boolean,
): Promise<EntryChanged> => {
  const names = newNames(path)
  const real = await projectFolder(root)
  const made: string[] = []
  try {
    let parent = real
    for (const index of names.slice(0, -1).keys())
      // eslint-disable-next-line no-await-in-loop -- Each folder is in the one before it.
      parent = await folderOnTheWay(real, parent, names.slice(0, index + 1), made)
    const name = names.at(-1)!
    const target = join(parent, name)
    // `wx`, and a folder made alone, each fail on any entry there, a link that leads nowhere too.
    const making = folder ? mkdir(target) : open(target, "wx").then((file) => file.close())
    await making.catch((error: unknown) => {
      throw errnoOf(error) === "EEXIST" ? takenIn(names.slice(0, -1), name) : failure(error, path)
    })
    return { path }
  } catch (error) {
    // Deepest first, as each holds the next; one that holds something by now stays.
    for (const each of made.toReversed())
      // eslint-disable-next-line no-await-in-loop -- A folder goes only once the one in it has.
      await rmdir(each).catch(() => {})
    throw error
  }
}

/**
 * Whether `there`, found at the name `name` in `folder`, is the entry `entry` itself: what a
 * filesystem blind to letters' case finds for the same name spelled in other case. A hard link
 * is the same file too, but under a name of its own, which `folder` lists as it is spelled.
 */
const sameEntry = async (
  entry: BigIntStats,
  there: BigIntStats,
  folder: string,
  name: string,
): Promise<boolean> =>
  entry.dev === there.dev &&
  entry.ino === there.ino &&
  !(await act(readdir(folder), name)).includes(name)

/**
 * The entry at `path`, in the project's real directory `real`, as `lstat` finds it, never
 * followed. One that isn't a link must not be Git's own `.git` by another name.
 */
const entryAt = async (real: string, path: string, shown: string): Promise<BigIntStats> => {
  const entry = await act(lstat(path, { bigint: true }), shown)
  if (!entry.isSymbolicLink()) outsideGit(real, await act(realpath(path), shown))
  return entry
}

/**
 * Renames or moves the entry at `from` to `to`, both from the project's root `root`, into a
 * folder that is there already. CONFLICT for a name taken at `to`, unless it is `from` spelled in
 * other letters' case, in its own folder, on a filesystem that doesn't tell them apart;
 * INVALID_DIRECTORY for a folder moved into itself.
 */
export const moveEntry = async (root: string, from: string, to: string): Promise<EntryChanged> => {
  const source = entryNames(from)
  const destination = newNames(to)
  const real = await projectFolder(root)
  const sourceFolder = await folderIn(real, source.slice(0, -1))
  const sourcePath = join(sourceFolder, source.at(-1)!)
  const entry = await entryAt(real, sourcePath, from)
  const targetFolder = await folderIn(real, destination.slice(0, -1))
  const intoItself = invalid("A folder can't move into itself.")
  if (entry.isDirectory() && within(sourcePath, targetFolder)) throw intoItself
  const name = destination.at(-1)!
  const targetPath = join(targetFolder, name)
  const there = await lstat(targetPath, { bigint: true }).catch((error: unknown) => {
    if (errnoOf(error) === "ENOENT") return undefined
    throw failure(error, to)
  })
  // Only a rename in its own folder can find the entry itself under its new name.
  const itself =
    there !== undefined &&
    targetFolder === sourceFolder &&
    (await sameEntry(entry, there, targetFolder, name))
  if (there && !itself) throw takenIn(destination.slice(0, -1), name)
  await rename(sourcePath, targetPath).catch((error: unknown) => {
    // Where a case-blind filesystem keeps a folder's real path in other letters' case than the
    // way to it, the check above misses a folder moved into itself, which the system refuses.
    throw entry.isDirectory() && errnoOf(error) === "EINVAL" ? intoItself : failure(error, to)
  })
  return { path: to }
}

/**
 * Deletes the entry at `path` from the project's root `root` for good, a folder with everything
 * in it. A link goes, never what it leads to, inside the folder too. Something added inside the
 * folder as it goes, as by a build or a file manager, may keep it there, with what was added:
 * the system refusing, tried twice more before.
 */
export const removeEntry = async (root: string, path: string): Promise<void> => {
  const names = entryNames(path)
  const real = await projectFolder(root)
  const folder = await folderIn(real, names.slice(0, -1))
  const target = join(folder, names.at(-1)!)
  await entryAt(real, target, path)
  await rm(target, { recursive: true, maxRetries: 2 }).catch((error: unknown) => {
    throw errnoOf(error) === "ENOTEMPTY"
      ? refused("Something was added inside it while it was being deleted; what is left stays.")
      : failure(error, path)
  })
}
