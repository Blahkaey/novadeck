import type { FilesProject } from "@novadeck/core/files"
import type { ContextMenuAction, ContextMenuItem } from "@novadeck/toolkit/ContextMenu"
import type { ReactElement } from "react"

import type { Platform } from "../interaction/shortcuts"
import { context, describe, expect, it } from "../test"
import { folderListings } from "../test/files"
import { filesMenu } from "./files-menu"
import { buildTree, isRow, visibleLines, type FilesRow } from "./files-tree"

// The storefront's files, with one an agent added that the folder doesn't list yet.
const listings = folderListings(["src/cart/useCart.ts", "package.json"])
const work: FilesProject = {
  changes: { "src/cart/new.ts": { kind: "added", touched: { moth: 1 } } },
  writing: {},
}
const rows = visibleLines(buildTree(listings, work), new Set(["src", "src/cart"])).filter(isRow)
const rowAt = (path: string): FilesRow => rows.find((row) => row.node.path === path)!

const ignore = (): void => {}
const labels = (items: readonly ContextMenuItem[]): string[] => items.map((item) => item.label)
const action = (items: readonly ContextMenuItem[], value: string): ContextMenuAction => {
  const found = items.find((item) => item.value === value)
  if (!found || "items" in found) throw new Error(`No action ${value}`)
  return found
}
// What each copy item puts on the clipboard, by its value.
const copied = (
  row: FilesRow | undefined,
  directory: string,
): Record<string, string | undefined> => {
  const texts: string[] = []
  const items = filesMenu({
    row,
    directory,
    platform: "other",
    onCopy: (text) => void texts.push(text),
    onRefresh: ignore,
  })
  return Object.fromEntries(
    items
      .filter((item) => item.value.startsWith("copy-"))
      .map((item) => {
        action(items, item.value).onSelect()
        return [item.value, texts.at(-1)]
      }),
  )
}
// The menu on a row, or on the empty space, with nothing to do.
const menuOn = (row: FilesRow | undefined, platform: Platform = "other"): ContextMenuItem[] =>
  filesMenu({ row, directory: "~/p", platform, onCopy: ignore, onRefresh: ignore })
const keysOf = (item: ContextMenuAction): unknown =>
  (item.detail as ReactElement<{ keys: readonly string[] }>).props.keys

describe("the Files panel's menu", () => {
  context("on a file", () => {
    it("copies its path on the backend's machine, and its path from the project's root", () => {
      const row = rowAt("src/cart/useCart.ts")
      expect(labels(menuOn(row))).toEqual(["Copy Path", "Copy Relative Path"])
      expect(copied(row, "/home/me/shop")).toEqual({
        "copy-path": "/home/me/shop/src/cart/useCart.ts",
        "copy-relative-path": "src/cart/useCart.ts",
      })
    })

    it("shows Copy Path's shortcut in the keys of the platform", () => {
      const row = rowAt("package.json")
      expect(keysOf(action(menuOn(row), "copy-path"))).toEqual(["Shift", "Alt", "C"])
      expect(keysOf(action(menuOn(row, "mac"), "copy-path"))).toEqual(["Shift", "⌥", "C"])
      expect(action(menuOn(row), "copy-relative-path").detail).toBeUndefined()
    })
  })

  context("on a folder", () => {
    it("copies the folder's paths as a file's", () => {
      expect(copied(rowAt("src/cart"), "/home/me/shop")).toEqual({
        "copy-path": "/home/me/shop/src/cart",
        "copy-relative-path": "src/cart",
      })
    })
  })

  context("on a file only an agent's work has", () => {
    it("still copies its paths, though its folder doesn't list it", () => {
      const row = rowAt("src/cart/new.ts")
      expect(row.node.kind).toBe("added")
      expect(copied(row, "/home/me/shop")).toEqual({
        "copy-path": "/home/me/shop/src/cart/new.ts",
        "copy-relative-path": "src/cart/new.ts",
      })
    })
  })

  context("on the tree's empty space", () => {
    it("copies the project's folder itself and refreshes, with no relative path to copy", () => {
      let refreshed = 0
      const items = filesMenu({
        row: undefined,
        directory: "/home/me/shop",
        platform: "other",
        onCopy: ignore,
        onRefresh: () => void (refreshed += 1),
      })
      expect(labels(items)).toEqual(["Copy Path", "Refresh"])
      expect(action(items, "copy-path").detail).toBeUndefined()
      expect(copied(undefined, "/home/me/shop")).toEqual({ "copy-path": "/home/me/shop" })
      action(items, "refresh").onSelect()
      expect(refreshed).toBe(1)
    })
  })

  context("where the backend keeps the project's own patterns for hiding files", () => {
    const hiding = (row: FilesRow | undefined, hidden: FilesRow[]): ContextMenuItem[] =>
      filesMenu({
        row,
        directory: "~/p",
        platform: "other",
        onCopy: ignore,
        onRefresh: ignore,
        onHide: (each) => void hidden.push(each),
      })

    it("offers to hide a row in the project, apart from the copies", () => {
      const hidden: FilesRow[] = []
      const row = rowAt("src/cart")
      const items = hiding(row, hidden)

      expect(labels(items)).toEqual(["Copy Path", "Copy Relative Path", "Hide in This Project"])
      expect(action(items, "hide").separated).toBe(true)
      action(items, "hide").onSelect()
      expect(hidden).toEqual([row])
    })

    it("offers nothing to hide on the tree's empty space, the project's folder", () => {
      expect(labels(hiding(undefined, []))).toEqual(["Copy Path", "Refresh"])
    })
  })

  context("where the backend keeps no patterns of the project's", () => {
    it("offers nothing to hide", () => {
      expect(labels(menuOn(rowAt("package.json")))).not.toContain("Hide in This Project")
    })
  })

  context("where the backend makes, renames and deletes files", () => {
    type Asked = { readonly what: string; readonly row: string | undefined }
    // The menu with every change offered, noting each one asked for.
    const changing = (
      row: FilesRow | undefined,
      asked: Asked[] = [],
      platform: Platform = "other",
    ): ContextMenuItem[] =>
      filesMenu({
        row,
        directory: "~/p",
        platform,
        onCopy: ignore,
        onRefresh: ignore,
        onHide: ignore,
        onNew: (at, folder) =>
          void asked.push({ what: folder ? "new folder" : "new file", row: at?.node.path }),
        onRename: (at) => void asked.push({ what: "rename", row: at.node.path }),
        onDelete: (at) => void asked.push({ what: "delete", row: at.node.path }),
      })
    // The labels, each that follows a hairline after a `|`.
    const grouped = (items: readonly ContextMenuItem[]): string[] =>
      items.flatMap((item) =>
        "separated" in item && item.separated ? ["|", item.label] : [item.label],
      )

    it("offers a new file or folder, the copies, a rename and a delete on a row, apart", () => {
      expect(grouped(changing(rowAt("src/cart/useCart.ts")))).toEqual([
        "New File…",
        "New Folder…",
        "|",
        "Copy Path",
        "Copy Relative Path",
        "|",
        "Rename…",
        "Delete",
        "|",
        "Hide in This Project",
      ])
    })

    it("asks for each on the row it was asked on", () => {
      const asked: Asked[] = []
      const items = changing(rowAt("src/cart"), asked)
      for (const value of ["new-file", "new-folder", "rename", "delete"])
        action(items, value).onSelect()
      expect(asked).toEqual([
        { what: "new file", row: "src/cart" },
        { what: "new folder", row: "src/cart" },
        { what: "rename", row: "src/cart" },
        { what: "delete", row: "src/cart" },
      ])
    })

    it("shows Rename's and Delete's keys, Delete's as each platform presses it", () => {
      const row = rowAt("package.json")
      expect(keysOf(action(changing(row), "rename"))).toEqual(["F2"])
      expect(keysOf(action(changing(row), "delete"))).toEqual(["Delete"])
      expect(keysOf(action(changing(row, [], "mac"), "delete"))).toEqual(["⌘", "⌫"])
      expect(action(changing(row), "new-file").detail).toBeUndefined()
    })

    it("offers a new file or folder in the root on the tree's empty space, before its copy and Refresh", () => {
      const asked: Asked[] = []
      const items = changing(undefined, asked)
      expect(grouped(items)).toEqual(["New File…", "New Folder…", "|", "Copy Path", "Refresh"])
      action(items, "new-folder").onSelect()
      expect(asked).toEqual([{ what: "new folder", row: undefined }])
    })

    it("offers only the copies and the hide on a row only an agent's work has", () => {
      expect(labels(changing(rowAt("src/cart/new.ts")))).toEqual([
        "Copy Path",
        "Copy Relative Path",
        "Hide in This Project",
      ])
    })

    it("offers only what the backend does", () => {
      const removing = filesMenu({
        row: rowAt("package.json"),
        directory: "~/p",
        platform: "other",
        onCopy: ignore,
        onRefresh: ignore,
        onDelete: ignore,
      })
      expect(labels(removing)).toEqual(["Copy Path", "Copy Relative Path", "Delete"])
    })
  })

  context("where the backend moves and copies files", () => {
    type Asked = { readonly what: string; readonly row: string | undefined }
    // The menu with Cut, Copy and Paste offered, and New too, Paste `ready` or not, noting each
    // one asked for.
    const clipping = (
      row: FilesRow | undefined,
      {
        asked = [],
        ready = true,
        platform = "other",
      }: {
        asked?: Asked[]
        ready?: boolean
        platform?: Platform
      } = {},
    ): ContextMenuItem[] =>
      filesMenu({
        row,
        directory: "~/p",
        platform,
        onCopy: ignore,
        onRefresh: ignore,
        onNew: ignore,
        clipboard: {
          onCut: (at) => void asked.push({ what: "cut", row: at.node.path }),
          onCopy: (at) => void asked.push({ what: "copy", row: at.node.path }),
          ready,
          onPaste: (at) => void asked.push({ what: "paste", row: at?.node.path }),
        },
      })
    const grouped = (items: readonly ContextMenuItem[]): string[] =>
      items.flatMap((item) =>
        "separated" in item && item.separated ? ["|", item.label] : [item.label],
      )

    it("offers Cut, Copy and Paste on a row, between its new entries and its paths, with their keys", () => {
      const row = rowAt("package.json")
      expect(grouped(clipping(row))).toEqual([
        "New File…",
        "New Folder…",
        "|",
        "Cut",
        "Copy",
        "Paste",
        "|",
        "Copy Path",
        "Copy Relative Path",
      ])
      expect(["cut", "copy", "paste"].map((value) => keysOf(action(clipping(row), value)))).toEqual(
        [
          ["Ctrl", "X"],
          ["Ctrl", "C"],
          ["Ctrl", "V"],
        ],
      )
      expect(keysOf(action(clipping(row, { platform: "mac" }), "paste"))).toEqual(["⌘", "V"])
    })

    it("asks for each on the row it was asked on", () => {
      const asked: Asked[] = []
      const items = clipping(rowAt("src/cart"), { asked })
      for (const value of ["cut", "copy", "paste"]) action(items, value).onSelect()
      expect(asked).toEqual([
        { what: "cut", row: "src/cart" },
        { what: "copy", row: "src/cart" },
        { what: "paste", row: "src/cart" },
      ])
    })

    it("shows Paste but doesn't offer it while there is nothing to paste", () => {
      const row = rowAt("package.json")
      expect(action(clipping(row, { ready: false }), "paste").disabled).toBe(true)
      expect(action(clipping(row), "paste").disabled).toBe(false)
    })

    it("offers Paste into the root on the tree's empty space, with no keys there", () => {
      const asked: Asked[] = []
      const items = clipping(undefined, { asked })
      expect(grouped(items)).toEqual([
        "New File…",
        "New Folder…",
        "|",
        "Paste",
        "|",
        "Copy Path",
        "Refresh",
      ])
      expect(action(items, "paste").detail).toBeUndefined()
      action(items, "paste").onSelect()
      expect(asked).toEqual([{ what: "paste", row: undefined }])
    })

    it("offers none of them on a row only an agent's work has", () => {
      expect(labels(clipping(rowAt("src/cart/new.ts")))).toEqual([
        "Copy Path",
        "Copy Relative Path",
      ])
    })
  })

  context("on a file an agent deleted", () => {
    it("offers only the copies, as the file is the agent's change to make", () => {
      const deleted = visibleLines(
        buildTree(listings, {
          changes: { "package.json": { kind: "deleted", touched: { crow: 1 } } },
          writing: {},
        }),
        new Set(),
      ).filter(isRow)
      const row = deleted.find((each) => each.node.path === "package.json")!
      expect(
        labels(
          filesMenu({
            row,
            directory: "~/p",
            platform: "other",
            onCopy: ignore,
            onRefresh: ignore,
            onNew: ignore,
            clipboard: { onCut: ignore, onCopy: ignore, ready: true, onPaste: ignore },
            onRename: ignore,
            onDelete: ignore,
          }),
        ),
      ).toEqual(["Copy Path", "Copy Relative Path"])
    })
  })

  context("in a Windows project", () => {
    it("copies both paths with backslashes", () => {
      expect(copied(rowAt("src/cart/useCart.ts"), "C:\\Users\\me\\shop")).toEqual({
        "copy-path": "C:\\Users\\me\\shop\\src\\cart\\useCart.ts",
        "copy-relative-path": "src\\cart\\useCart.ts",
      })
    })
  })
})
