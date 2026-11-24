// A standalone runner's transcript key, kept in a file of its own. The desktop app keeps its
// key in the system's keychain and hands it over; a standalone runner has no app, so the
// person names a file, which this loads, or makes on the first start. The key sits on the same
// disk as the database, so it keeps a transcript only from a copy of the database that leaves
// without the file, as a backup of the data folder alone.
import { randomBytes, randomUUID } from "node:crypto"
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { keyIn } from "../transcript-key-file.js"

const keyBytes = 32

/** Why a key file can't be used; the message names the file, never what it holds. */
export class KeyFileError extends Error {
  override readonly name = "KeyFileError"
}

/**
 * The 32-byte key in `path`, made there on the first start: 32 random bytes written to a
 * temporary file beside it, readable by its owner alone, and linked into place, so a crash
 * or another runner starting at once never leaves half a key or replaces one. A file that
 * is there but can't be read, isn't a file, isn't 32 bytes, or that other accounts can read
 * or change (off Windows, where its mode says so) is refused and never overwritten: all that
 * was saved under its key would be out of reach.
 */
export const loadKeyFile = async (
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<Uint8Array> => {
  const existing = await read(path, platform)
  if (existing) return existing
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, randomBytes(keyBytes), { mode: 0o600, flag: "wx", flush: true })
    await link(temporary, path)
  } catch (error) {
    // Another start made it first: theirs is the key.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new KeyFileError(
        `The transcript key file ${path} could not be made: ${(error as Error).message}`,
      )
    }
  } finally {
    await rm(temporary, { force: true })
  }
  const made = await read(path, platform)
  if (!made) throw new KeyFileError(`The transcript key file ${path} could not be made.`)
  return made
}

/** The key in `path`, or undefined when there is no file there; any other failure throws. */
const read = async (path: string, platform: NodeJS.Platform): Promise<Uint8Array | undefined> => {
  const refuse = (why: string): never => {
    throw new KeyFileError(`The transcript key file ${path} ${why}`)
  }
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    return refuse(`can't be read: ${(error as Error).message}`)
  }
  // Checked before it is opened, as opening a pipe would wait for a writer.
  if (!stats.isFile()) refuse("isn't a file.")
  if (platform !== "win32" && (stats.mode & 0o077) !== 0) {
    refuse("can be read or changed by other accounts: make it its owner's alone (chmod 600).")
  }
  const bytes = await readFile(path).catch((error: unknown) =>
    refuse(`can't be read: ${(error as Error).message}`),
  )
  if (bytes.length === keyBytes) return new Uint8Array(bytes)
  const decoded = keyIn(bytes.toString("utf8"))
  if (!decoded) return refuse(`doesn't hold a key: it must be ${keyBytes} bytes.`)
  return decoded
}
