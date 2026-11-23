import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { FilesClipboardReply } from "../../bridge.js"
import { registerFilesClipboard } from "./files-clipboard.js"

type Item = { readonly types: string[]; getType(type: string): Promise<Blob> }

const clipboard = vi.hoisted(() => ({
  read: vi.fn<() => Promise<readonly Item[]>>(),
  write: vi.fn<(items: readonly Item[]) => Promise<void>>(),
  Item: class {
    constructor(readonly parts: Record<string, string>) {}
    get types(): string[] {
      return Object.keys(this.parts)
    }
    async getType(type: string): Promise<Blob> {
      return new Blob([this.parts[type] ?? ""])
    }
  },
}))

vi.mock("electron", () => ({ clipboard, ClipboardItem: clipboard.Item }))

const bridge = () => {
  const first = { isFocused: () => true } as BrowserWindow
  const second = { isFocused: () => false } as BrowserWindow
  const event = {} as IpcMainInvokeEvent
  const other = {} as IpcMainInvokeEvent
  let registered: Parameters<IpcMain["handle"]>[1] | undefined
  registerFilesClipboard(
    {
      handle: (_channel, handler) => {
        registered = handler
      },
    },
    (sender) => (sender === event ? first : sender === other ? second : undefined),
  )
  return async (request: unknown, elsewhere = false): Promise<unknown> => {
    const reply: FilesClipboardReply<unknown> = await registered!(
      elsewhere ? other : event,
      request,
    )
    if (!reply.ok) throw new Error(reply.message)
    return reply.value
  }
}

beforeEach(() => clipboard.read.mockReset())

describe("the Mac Files clipboard bridge", () => {
  it("grants a file selection by relative name, then serves bytes only to that window", async () => {
    const root = await mkdtemp(join(tmpdir(), "novadeck-finder-"))
    try {
      const folder = join(root, "My folder")
      const file = join(root, "Notes.txt")
      await mkdir(folder)
      await mkdir(join(folder, "Empty"))
      await writeFile(file, Uint8Array.of(0, 1, 255))
      clipboard.read.mockResolvedValue([
        new clipboard.Item({
          "text/plain": root,
          "text/uri-list": [folder, file].map((path) => pathToFileURL(path).href).join("\r\n"),
        }),
      ])
      const invoke = bridge()
      const selection = await invoke({ kind: "read" })
      expect(selection).toMatchObject({
        entries: [
          { path: "My folder", size: null },
          { path: "My folder/Empty", size: null },
          { path: "Notes.txt", size: 3 },
        ],
      })
      const { id } = selection as { id: string }
      const chunk = { kind: "chunk", id, index: 2, offset: 1 }
      await expect(invoke({ kind: "read" }, true)).rejects.toThrow("Focus Files")
      await expect(invoke(chunk, true)).rejects.toThrow("expired")
      await expect(invoke(chunk)).resolves.toEqual(Uint8Array.of(1, 255))
      await invoke({ kind: "release", id })
      await expect(invoke(chunk)).rejects.toThrow("expired")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("matches a Files marker and leaves ordinary text out of file paste", async () => {
    const invoke = bridge()
    const marker = crypto.randomUUID()
    await invoke({ kind: "mark", marker })
    clipboard.read.mockResolvedValue(clipboard.write.mock.lastCall![0])
    await expect(invoke({ kind: "read", marker })).resolves.toBe("ours")
    clipboard.read.mockResolvedValue([new clipboard.Item({ "text/plain": "file:///etc/hosts" })])
    await expect(invoke({ kind: "read", marker })).resolves.toBe("empty")
  })
})
