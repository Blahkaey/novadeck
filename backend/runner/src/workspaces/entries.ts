import type { BigIntStats } from "node:fs"
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises"
import { dirname, join } from "node:path"

import { fileImportLimits, type EntryChanged } from "@novadeck/protocol"

import { DomainError } from "../errors.js"
import { copyInto, copyName, copyTop, type Copied } from "./copy.js"
import { inGit, invalid, segments, within } from "./project-paths.js"

// The person's changes to a project's files from the Files panel: an empty file or folder
// made, an entry renamed, moved or copied, an entry deleted. Each works on a path from the
// project's root and is confined to the project's directory: the folder an entry is in, resolved
// through any links, must lie inside the project's, while the entry itself is never followed, so
// a link is renamed, copied or deleted as a link. Nothing found there is overwritten. The root and
// Git's own `.git` are never changed, by any name that resolves into it. What is checked can
// change before the change is made, as a folder on the way swapped for a link, or a file made at a
// move's destination, which the rename then replaces: the confinement keeps a slip inside the
// project, not a process that runs as the person, which can change any file anyway.

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
 * The names of a path in the project, none for the root: nothing of Git's own `.git`, whatever
 * its letters' case, as a case-blind filesystem would take `.GIT` for it.
 */
const pathNames = (path: string): string[] => {
  const names = segments(path)
  if (names.some((name) => name.toLowerCase() === ".git")) throw gitsOwn()
  return names
}

/** The names of an entry's path, as `pathNames`, and never the root. */
const entryNames = (path: string): string[] => {
  const names = pathNames(path)
  if (names.length === 0) throw invalid("Novadeck doesn't change the project's folder itself.")
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
    case "ENAMETOOLONG":
      return refused("The name is too long for the system.")
    case "ELOOP":
      return refused("Too many links lead to it.")
    default:
      return refused(`The system refused it (${code}).`)
  }
}

/** What a failure says, as the person reads it. */
const said = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * What the system's refusal to delete `path` means, as `failure` says, but for something added
 * inside a folder as it went, which the system answers as a folder that isn't empty.
 */
const removal = (error: unknown, path: string): unknown =>
  errnoOf(error) === "ENOTEMPTY"
    ? refused("Something was added inside it while it was being deleted; what is left stays.")
    : failure(error, path)

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
  if (inGit(real, path)) throw gitsOwn()
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
 * Makes `target` a copy of the entry at `source`, `entry` its `lstat`, with everything in it, as
 * `copyTop` and `copyInto` do, and answers what it copied, each folder after what it holds, the
 * entry itself last; undefined, having made nothing, where something is at `target` already. A
 * copy that fails part way is removed again and fails as `failure` says for `shown`, the source's
 * path from the project's root; where it can't be removed, it is said to stay at `made`, the
 * copy's path from the root.
 */
const copyAs = async (
  source: string,
  entry: BigIntStats,
  target: string,
  shown: string,
  made: string,
): Promise<readonly Copied[] | undefined> => {
  const top = await copyTop(source, entry, target, shown).then(
    () => true,
    (error: unknown) => {
      if (errnoOf(error) === "EEXIST") return false
      throw failure(error, shown)
    },
  )
  const itself = { path: source, entry }
  if (!top) return undefined
  if (!entry.isDirectory()) return [itself]
  try {
    return [...(await copyInto(source, target, Number(entry.mode), shown)), itself]
  } catch (error) {
    // Something the folder held went while it was copied, as a build or an agent deleted it.
    const reason =
      errnoOf(error) === "ENOENT"
        ? invalid(`Something in ${shown} went while it was being copied.`)
        : failure(error, shown)
    await rm(target, { recursive: true, force: true, maxRetries: 2 }).catch(() => {
      throw refused(`${said(reason)} What was copied of it stays at ${made}.`)
    })
    throw reason
  }
}

/**
 * Whether the folder at the real path `path`, inside the project's real directory `real`, is the
 * folder `folder` or lies inside it: by the system's identity of each folder from it up to the
 * project's, so no name, link or letters' case that leads to it can hide it.
 */
const holds = async (
  folder: BigIntStats,
  path: string,
  real: string,
  shown: string,
): Promise<boolean> => {
  const here = await act(stat(path, { bigint: true }), shown)
  if (here.dev === folder.dev && here.ino === folder.ino) return true
  const up = dirname(path)
  return path !== real && up !== path && holds(folder, up, real, shown)
}

// How many names a copy tries before it gives up, the first included.
const copyTries = 1000

export const importNames = newNames

export const importTarget = async (root: string, into: string): Promise<string> =>
  folderIn(await projectFolder(root), pathNames(into))

/** Publishes an entry from the runner's private staging directory, taking each name exclusively. */
export const publishImportedEntry = async (
  root: string,
  into: string,
  source: string,
  name: string,
): Promise<{ path: string; folder: boolean }> => {
  const target = await importTarget(root, into)
  const entry = await act(lstat(source, { bigint: true }), name)
  const folder = entry.isDirectory()
  let candidate = name
  for (let left = copyTries; left > 0; left--) {
    const path = into === "" ? candidate : `${into}/${candidate}`
    if (path.length > fileImportLimits.pathCharacters)
      throw invalid("The pasted entry's path in the project is too long.")
    // eslint-disable-next-line no-await-in-loop -- The next name is tried only after a collision.
    if (await copyAs(source, entry, join(target, candidate), name, path)) return { path, folder }
    candidate = copyName(candidate, folder)
  }
  throw takenIn(pathNames(into), name)
}

/**
 * Copies the file, folder or link at `from` into the folder `into` (`""` for the project's own),
 * both from the project's root `root`, and answers the copy's path. It takes its own name where
 * `into` isn't its folder and nothing is there by that name, else the first of `name copy`, `name
 * copy 2`, … that nothing holds (`copyName`): each name is taken by making it, so nothing is
 * overwritten, whatever else writes there meanwhile. A folder copies with everything in it, links
 * as links. INVALID_DIRECTORY for a folder copied into itself or below it; CONFLICT once
 * `copyTries` names are taken.
 */
export const copyEntry = async (
  root: string,
  from: string,
  into: string,
): Promise<EntryChanged> => {
  const source = entryNames(from)
  const folder = pathNames(into)
  const real = await projectFolder(root)
  const sourceFolder = await folderIn(real, source.slice(0, -1))
  const name = source.at(-1)!
  const sourcePath = join(sourceFolder, name)
  const entry = await entryAt(real, sourcePath, from)
  const targetFolder = await folderIn(real, folder)
  if (entry.isDirectory() && (await holds(entry, targetFolder, real, into)))
    throw invalid("A folder can't be copied into itself.")
  const pathOf = (each: string): string => [...folder, each].join("/")
  const attempt = async (each: string, left: number): Promise<string> => {
    if (left === 0)
      throw taken(
        `There are too many copies of ${name} in ${folder.length === 0 ? "the project's folder" : into} already.`,
      )
    const copied = await copyAs(sourcePath, entry, join(targetFolder, each), from, pathOf(each))
    return copied ? pathOf(each) : attempt(copyName(each, entry.isDirectory()), left - 1)
  }
  const first = targetFolder === sourceFolder ? copyName(name, entry.isDirectory()) : name
  return { path: await attempt(first, copyTries) }
}

/** Whether `now`, found where `entry` was, is that entry as it was: the same file, size and time. */
const unchanged = (entry: BigIntStats, now: BigIntStats): boolean =>
  now.dev === entry.dev &&
  now.ino === entry.ino &&
  now.size === entry.size &&
  now.mtimeNs === entry.mtimeNs

/**
 * Deletes the entry at `path` that a copy copied, `entry` as it was then: a file or link only
 * where it is as it was, and a folder only once it is empty. Answers whether it stays, as one a
 * build or an agent changed, or added to, while the copy went; one gone already is gone. Rejects
 * with the system's refusal, as `failure` says for `shown`.
 */
const removeCopy = async (path: string, entry: BigIntStats, shown: string): Promise<boolean> => {
  const gone = (error: unknown): boolean => {
    if (errnoOf(error) === "ENOENT") return false
    throw failure(error, shown)
  }
  const now = await lstat(path, { bigint: true }).catch((error: unknown) => {
    gone(error)
    return undefined
  })
  if (now === undefined) return false
  if (entry.isDirectory())
    return rmdir(path).then(
      () => false,
      (error: unknown) => ["ENOTEMPTY", "EEXIST"].includes(errnoOf(error) ?? "") || gone(error),
    )
  if (!unchanged(entry, now)) return true
  return unlink(path).then(() => false, gone)
}

/**
 * Deletes what a copy copied, `copied` as `copyAs` answers it, each folder after what it holds,
 * as `removeCopy` does, and answers whether anything stays. Rejects with the system's refusal, as
 * `failure` says for `shown`, the entry's path from the project's root, leaving the rest.
 */
const removeCopied = async (copied: readonly Copied[], shown: string): Promise<boolean> => {
  let stays = false
  for (const { path, entry } of copied)
    // eslint-disable-next-line no-await-in-loop -- Each folder goes after what it holds.
    stays = (await removeCopy(path, entry, shown)) || stays
  return stays
}

/**
 * Renames or moves the entry at `from` to `to`, both from the project's root `root`, into a
 * folder that is there already. CONFLICT for a name taken at `to`, unless it is `from` spelled in
 * other letters' case, in its own folder, on a filesystem that doesn't tell them apart;
 * INVALID_DIRECTORY for a folder moved into itself, by any way that leads there. Where `to` is on
 * another filesystem, which a rename can't reach, the entry is copied there exactly, never
 * overwriting, then what was copied is deleted where it was: what was added or changed there
 * meanwhile stays, as does what the system won't delete, WRITE_REFUSED saying so.
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
  if (
    entry.isDirectory() &&
    (within(sourcePath, targetFolder) || (await holds(entry, targetFolder, real, to)))
  )
    throw intoItself
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
  const across = await rename(sourcePath, targetPath).then(
    () => false,
    (error: unknown) => {
      if (errnoOf(error) === "EXDEV") return true
      // Where a case-blind filesystem keeps a folder's real path in other letters' case than the
      // way to it, the check above misses a folder moved into itself, which the system refuses.
      throw entry.isDirectory() && errnoOf(error) === "EINVAL" ? intoItself : failure(error, to)
    },
  )
  if (!across) return { path: to }
  const copied = await copyAs(sourcePath, entry, targetPath, from, to)
  if (!copied) throw takenIn(destination.slice(0, -1), name)
  const stays = await removeCopied(copied, from).catch((error: unknown) => {
    throw refused(`It was copied to ${to}, but what is left of it stays at ${from}. ${said(error)}`)
  })
  if (stays)
    throw refused(
      `It was copied to ${to}, but what was added to or changed in ${from} while it was being copied stays there.`,
    )
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
    throw removal(error, path)
  })
}
