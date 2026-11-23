import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { fileImportLimits, type FileImportWrite } from "@novadeck/protocol"

import { DomainError } from "../errors.js"
import { importNames, importTarget, publishImportedEntry } from "./entries.js"
import { invalid } from "./project-paths.js"

const idleMs = 60_000

type Import = {
  readonly transfer: string
  readonly projectId: string
  readonly into: string
  readonly roots: Set<string>
  stage?: string
  pending?: Promise<unknown>
  disposal?: Promise<void>
  idle?: ReturnType<typeof setTimeout>
  file?: { path: string; size: number; received: number }
  entries: number
  bytes: number
}

const conflict = (message: string): DomainError => new DomainError("CONFLICT", message)

const complete = ({ file }: Import): void => {
  if (file && file.received !== file.size) throw conflict("The last file was only partly received.")
}

/** A connection can stage one import. Staging is private and released with the connection. */
export class FileImports {
  private readonly active = new Map<string, Import>()

  constructor(private readonly projectRoot: (projectId: string) => string) {}

  begin(connection: string, transfer: string, projectId: string, into: string): Promise<void> {
    if (this.active.has(connection)) throw conflict("A paste is already in progress.")
    const paste: Import = { transfer, projectId, into, roots: new Set(), entries: 0, bytes: 0 }
    this.active.set(connection, paste)
    return this.run(connection, paste, async () => {
      await importTarget(this.projectRoot(projectId), into)
      paste.stage = await mkdtemp(join(tmpdir(), "novadeck-file-import-"))
    })
  }

  write(connection: string, transfer: string, change: FileImportWrite): Promise<void> {
    if (change.kind === "cancel") {
      const paste = this.active.get(connection)
      return paste?.transfer === transfer ? this.discard(connection, paste) : Promise.resolve()
    }
    const { paste, stage } = this.ready(connection, transfer)
    return this.run(connection, paste, async () => {
      if (change.kind === "part") {
        const file = paste.file
        const bytes = Buffer.from(change.data, "base64")
        if (!file || change.offset !== file.received || bytes.length > file.size - file.received)
          throw conflict("A file part arrived out of order or exceeded its declared size.")
        await appendFile(file.path, bytes)
        file.received += bytes.length
        return
      }
      complete(paste)
      const { path, size } = change.entry
      const names = importNames(path)
      if (
        path.length + (paste.into === "" ? 0 : paste.into.length + 1) >
        fileImportLimits.pathCharacters
      )
        throw invalid("The pasted entry's path in the project is too long.")
      paste.entries++
      paste.bytes += size ?? 0
      if (paste.entries > fileImportLimits.entries || paste.bytes > fileImportLimits.bytes)
        throw new DomainError("UPLOAD_TOO_LARGE", "The selection exceeds the file paste limits.")
      const target = join(stage, ...names)
      if (size === null) {
        await mkdir(target)
        delete paste.file
      } else {
        await writeFile(target, "", { flag: "wx" })
        paste.file = { path: target, size, received: 0 }
      }
      if (names.length === 1) paste.roots.add(path)
    })
  }

  async finish(connection: string, transfer: string): Promise<{ path: string; folder: boolean }[]> {
    const { paste, stage } = this.ready(connection, transfer)
    return this.run(
      connection,
      paste,
      async () => {
        complete(paste)
        const root = this.projectRoot(paste.projectId)
        const copied: { path: string; folder: boolean }[] = []
        try {
          for (const name of paste.roots) {
            // eslint-disable-next-line no-await-in-loop -- Each name is taken before the next root.
            copied.push(await publishImportedEntry(root, paste.into, join(stage, name), name))
          }
        } catch (error) {
          if (copied.length === 0) throw error
          const detail = error instanceof Error ? error.message : String(error)
          throw new DomainError("WRITE_REFUSED", `${copied.length} items were pasted. ${detail}`)
        }
        return copied
      },
      true,
    )
  }

  release(connection: string): Promise<void> {
    const paste = this.active.get(connection)
    return paste ? this.discard(connection, paste) : Promise.resolve()
  }

  private discard(connection: string, paste: Import): Promise<void> {
    clearTimeout(paste.idle)
    paste.disposal ??= (async () => {
      try {
        await paste.pending?.catch(() => {})
        if (paste.stage) await rm(paste.stage, { recursive: true, force: true })
      } finally {
        if (this.active.get(connection) === paste) this.active.delete(connection)
      }
    })()
    return paste.disposal
  }

  private ready(connection: string, transfer: string): { paste: Import; stage: string } {
    const paste = this.active.get(connection)
    if (!paste?.stage || paste.transfer !== transfer || paste.disposal)
      throw conflict("There is no file paste in progress.")
    return { paste, stage: paste.stage }
  }

  private async run<T>(
    connection: string,
    paste: Import,
    action: () => Promise<T>,
    finished = false,
  ): Promise<T> {
    if (paste.pending) throw conflict("Another part of this paste is in progress.")
    clearTimeout(paste.idle)
    const pending = action()
    paste.pending = pending
    try {
      const result = await pending
      if (finished) await this.discard(connection, paste)
      return result
    } catch (error) {
      await this.discard(connection, paste).catch(() => {})
      if (error instanceof DomainError) throw error
      const code = error instanceof Error && "code" in error ? String(error.code) : undefined
      throw new DomainError(
        "WRITE_REFUSED",
        `The runner couldn't save the pasted files${code ? ` (${code})` : ""}.`,
      )
    } finally {
      delete paste.pending
      if (!paste.disposal && this.active.get(connection) === paste) {
        paste.idle = setTimeout(() => void this.release(connection).catch(() => {}), idleMs)
        paste.idle.unref()
      }
    }
  }
}
