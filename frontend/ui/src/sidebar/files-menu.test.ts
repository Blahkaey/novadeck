import type { FilesProject } from "@novadeck/core/files"
import type { ContextMenuAction, ContextMenuItem } from "@novadeck/toolkit/ContextMenu"
import type { ReactElement } from "react"

import type { Platform } from "../interaction/shortcuts"
import { context, describe, expect, it } from "../test"
import { folderListings } from "../test/files"
import { filesMenu } from "./files-menu"
import { buildTree, isNote, visibleLines, type FilesRow } from "./files-tree"

// The storefront's files, with one an agent added that the folder doesn't list yet.
const listings = folderListings(["src/cart/useCart.ts", "package.json"])
const work: FilesProject = {
  changes: { "src/cart/new.ts": { kind: "added", touched: { moth: 1 } } },
  writing: {},
}
const rows = visibleLines(buildTree(listings, work), new Set(["src", "src/cart"])).filter(
  (line): line is FilesRow => !isNote(line),
)
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

  context("in a Windows project", () => {
    it("copies both paths with backslashes", () => {
      expect(copied(rowAt("src/cart/useCart.ts"), "C:\\Users\\me\\shop")).toEqual({
        "copy-path": "C:\\Users\\me\\shop\\src\\cart\\useCart.ts",
        "copy-relative-path": "src\\cart\\useCart.ts",
      })
    })
  })
})
