import { randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { lstat, open, opendir, realpath } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { fileImportLimits, type FileImportEntry } from "@novadeck/protocol"
import type { FilesClipboardSelection } from "@novadeck/protocol/bridge"
import {
  clipboard,
  ClipboardItem,
  type BrowserWindow,
  type IpcMain,
  type IpcMainInvokeEvent,
} from "electron"

import { filesClipboardChannel, type FilesClipboardReply } from "../../bridge.js"

const markerFormat = "web application/x-novadeck-files-clipboard"
const markerPattern = /^[a-f0-9-]{36}$/
const fileFormat = "text/uri-list"
const idleMs = 60_000

type Source = { readonly path: string; readonly stat: BigIntStats }
type Selection = { id: string; items: readonly Source[]; readAt: number }

const localPaths = async (items: readonly ClipboardItem[]): Promise<string[]> => {
  const paths = new Set<string>()
  for (const item of items) {
    if (!item.types.includes(fileFormat)) continue
    // eslint-disable-next-line no-await-in-loop -- Each clipboard item's file list is read once.
    const list = await (await item.getType(fileFormat)).text()
    for (const line of list.split(/\r?\n/)) {
      if (!line.startsWith("file://")) continue
      const url = new URL(line)
      if (url.hostname === "" || url.hostname === "localhost") paths.add(fileURLToPath(url))
      if (paths.size > fileImportLimits.entries) throw new Error("Too many items to paste.")
    }
  }
  return [...paths]
}

const snapshot = async (paths: readonly string[]) => {
  const sources: Source[] = []
  const entries: FileImportEntry[] = []
  const roots = new Set<string>()
  let bytes = 0
  const visit = async (path: string, shown: string): Promise<void> => {
    const name = basename(path)
    if (
      name.toLowerCase() === ".git" ||
      name.includes("\\") ||
      shown.length > fileImportLimits.pathCharacters
    )
      throw new Error(`The name “${shown}” can't be pasted into a project.`)
    if ((await realpath(dirname(path))) !== dirname(path))
      throw new Error(`“${shown}” moved while it was being read.`)
    const stat = await lstat(path, { bigint: true })
    const folder = stat.isDirectory()
    if (!folder && !stat.isFile())
      throw new Error(`“${shown}” can't be pasted. Select regular files or folders.`)
    const size = folder ? null : Number(stat.size)
    bytes += size ?? 0
    if (entries.length >= fileImportLimits.entries || bytes > fileImportLimits.bytes)
      throw new Error("Paste supports up to 10,000 files and folders and 512 MiB at a time.")
    entries.push({ path: shown, size })
    sources.push({ path, stat })
    if (folder) {
      const directory = await opendir(path)
      for await (const child of directory) {
        // eslint-disable-next-line no-await-in-loop -- Walk one entry at a time, with bounded storage.
        await visit(join(path, child.name), `${shown}/${child.name}`)
      }
    }
  }
  for (const path of paths) {
    const name = basename(path)
    if (!name) throw new Error("Select a file or folder inside the disk.")
    if (roots.has(name)) throw new Error(`The selection contains two items named “${name}”.`)
    roots.add(name)
    // eslint-disable-next-line no-await-in-loop -- Keep each selected root together in the upload.
    await visit(join(await realpath(dirname(path)), name), name)
  }
  return { sources, entries }
}

const sameFile = (before: BigIntStats, after: BigIntStats): boolean =>
  after.isFile() &&
  before.dev === after.dev &&
  before.ino === after.ino &&
  before.size === after.size &&
  before.mtimeNs === after.mtimeNs

const chunk = async ({ path, stat }: Source, offset: number): Promise<Uint8Array> => {
  if ((await realpath(dirname(path))) !== dirname(path))
    throw new Error("A selected file moved while it was being pasted.")
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!sameFile(stat, await file.stat({ bigint: true })))
      throw new Error("A selected file changed while it was being pasted.")
    const buffer = new Uint8Array(Math.min(fileImportLimits.partBytes, Number(stat.size) - offset))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
    if (bytesRead === 0) throw new Error("A selected file ended before its copy was complete.")
    if (!sameFile(stat, await file.stat({ bigint: true })))
      throw new Error("A selected file changed while it was being pasted.")
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

/** Only a focused app window can read the pasteboard. Bytes are scoped to that window's selection. */
export const registerFilesClipboard = (
  ipc: Pick<IpcMain, "handle">,
  ownWindow: (event: IpcMainInvokeEvent) => BrowserWindow | undefined,
): void => {
  const selections = new WeakMap<BrowserWindow, Selection>()
  const opening = new WeakSet<BrowserWindow>()
  const handle = async (event: IpcMainInvokeEvent, value: unknown) => {
    const window = ownWindow(event)
    if (!window || typeof value !== "object" || value === null || !("kind" in value))
      throw new Error("File paste is unavailable.")
    if (value.kind === "mark" || value.kind === "read") {
      if (!window.isFocused()) throw new Error("Focus Files before using its clipboard.")
      const marker =
        "marker" in value && typeof value.marker === "string" && markerPattern.test(value.marker)
          ? value.marker
          : undefined
      if (value.kind === "mark") {
        if (!marker) throw new Error("The clipboard marker is invalid.")
        await clipboard.write([new ClipboardItem({ [markerFormat]: marker })])
        return
      }
      if (opening.has(window)) throw new Error("A Finder selection is already being read.")
      opening.add(window)
      selections.delete(window)
      try {
        const items = await clipboard.read()
        const marked = items.find((item) => item.types.includes(markerFormat))
        if (marker && marked && (await (await marked.getType(markerFormat)).text()) === marker)
          return "ours" satisfies FilesClipboardSelection
        const paths = await localPaths(items)
        if (paths.length === 0) return "empty" satisfies FilesClipboardSelection
        const { sources, entries } = await snapshot(paths)
        const id = randomUUID()
        selections.set(window, { id, items: sources, readAt: Date.now() })
        return { id, entries } satisfies FilesClipboardSelection
      } finally {
        opening.delete(window)
      }
    }
    const selection = selections.get(window)
    const id = "id" in value ? value.id : undefined
    if (value.kind === "release") {
      if (selection?.id === id) selections.delete(window)
      return
    }
    if (!selection || selection.id !== id || Date.now() - selection.readAt > idleMs)
      throw new Error("The Finder selection expired. Paste it again.")
    if (value.kind !== "chunk" || !("index" in value) || !("offset" in value))
      throw new Error("The file request is invalid.")
    const { index, offset } = value
    const source =
      typeof index === "number" && Number.isSafeInteger(index) ? selection.items[index] : undefined
    if (
      !source?.stat.isFile() ||
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= Number(source.stat.size)
    )
      throw new Error("The file request is invalid.")
    selection.readAt = Date.now()
    return await chunk(source, offset)
  }
  ipc.handle(
    filesClipboardChannel,
    async (event, value: unknown): Promise<FilesClipboardReply<unknown>> => {
      try {
        return { ok: true, value: await handle(event, value) }
      } catch (error) {
        const message =
          error instanceof Error && "code" in error
            ? `Couldn't read the Finder selection (${String(error.code)}).`
            : error instanceof Error
              ? error.message
              : "Couldn't read the Finder selection."
        return { ok: false, message }
      }
    },
  )
}
