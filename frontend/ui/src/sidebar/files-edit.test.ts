import type { FilesProject } from "@novadeck/core/files"

import { context, describe, expect, it } from "../test"
import { folderListings } from "../test/files"
import {
  changeable,
  checkName,
  listingsMade,
  listingsMoved,
  listingsRemoved,
  moved,
  nameSelection,
  newEntryIn,
  rowAfterLeaving,
  type Naming,
} from "./files-edit"
import { buildTree, isRow, visibleLines, type FilesRow, type Listings } from "./files-tree"

// The storefront's folders as read: src, its cart, and docs, which is empty.
const listings = folderListings([
  "src/cart/useCart.ts",
  "src/cart/Cart.tsx",
  "src/App.tsx",
  "docs/",
  "README.md",
])
const newFile = (parent: string): Naming => ({
  kind: "new",
  parent,
  folder: false,
  from: undefined,
})
const renaming = (path: string, folder = false): Naming => ({ kind: "rename", path, folder })

// Each folder's entries by name, as the panel knows them.
const names = (known: Listings): Record<string, string[]> =>
  Object.fromEntries(
    [...known].map(([folder, read]) => [
      folder,
      typeof read === "object" ? read.entries.map((entry) => entry.name).toSorted() : [read],
    ]),
  )

describe("Naming a file or folder in the Files panel", () => {
  context("for a new entry", () => {
    it("makes it in its folder by the name typed", () => {
      expect(checkName(newFile("src"), "index.ts", listings)).toEqual({
        outcome: "commit",
        path: "src/index.ts",
      })
      expect(checkName(newFile(""), "LICENSE", listings)).toEqual({
        outcome: "commit",
        path: "LICENSE",
      })
    })

    it("makes the folders a slash names on the way, as VS Code does", () => {
      expect(checkName(newFile("src"), "api/v2/orders.ts", listings)).toEqual({
        outcome: "commit",
        path: "src/api/v2/orders.ts",
      })
      // Through a folder that is there already.
      expect(checkName(newFile(""), "src/cart/total.ts", listings)).toMatchObject({
        outcome: "commit",
      })
    })

    it("does nothing with nothing typed, and says nothing of it", () => {
      expect(checkName(newFile("src"), "", listings)).toEqual({ outcome: "cancel" })
    })

    it("refuses a backslash, an empty name between slashes, and . or ..", () => {
      expect(checkName(newFile(""), "src\\a.ts", listings)).toEqual({
        outcome: "invalid",
        problem: "A name can't hold a backslash.",
      })
      for (const typed of ["/a.ts", "a.ts/", "a//b.ts"])
        expect(checkName(newFile(""), typed, listings)).toEqual({
          outcome: "invalid",
          problem: "A slash needs a name on each side.",
        })
      for (const typed of [".", "..", "../a.ts", "a/./b.ts"])
        expect(checkName(newFile(""), typed, listings)).toEqual({
          outcome: "invalid",
          problem: "A name can't be . or ..",
        })
    })

    it("refuses a name its folder lists, by its exact letters", () => {
      expect(checkName(newFile("src"), "App.tsx", listings)).toEqual({
        outcome: "invalid",
        problem: "There's already a file named App.tsx here.",
      })
      expect(checkName(newFile(""), "docs", listings)).toEqual({
        outcome: "invalid",
        problem: "There's already a folder named docs here.",
      })
      // The backend says whether its filesystem takes app.tsx for App.tsx.
      expect(checkName(newFile("src"), "app.tsx", listings)).toMatchObject({ outcome: "commit" })
    })

    it("refuses a way through a file, and a name taken in a folder on the way that is read", () => {
      expect(checkName(newFile(""), "README.md/notes.md", listings)).toEqual({
        outcome: "invalid",
        problem: "There's already a file named README.md here.",
      })
      expect(checkName(newFile(""), "src/cart/Cart.tsx", listings)).toEqual({
        outcome: "invalid",
        problem: "There's already a file named Cart.tsx in src/cart.",
      })
    })

    it("leaves to the backend a name in a folder not read yet", () => {
      const unread = new Map([...listings].filter(([folder]) => folder !== "src/cart"))
      expect(checkName(newFile(""), "src/cart/Cart.tsx", unread)).toMatchObject({
        outcome: "commit",
      })
    })
  })

  context("for a rename", () => {
    it("renames it in its folder", () => {
      expect(checkName(renaming("src/App.tsx"), "Main.tsx", listings)).toEqual({
        outcome: "commit",
        path: "src/Main.tsx",
      })
    })

    it("does nothing for the name it has", () => {
      expect(checkName(renaming("src/App.tsx"), "App.tsx", listings)).toEqual({
        outcome: "cancel",
      })
    })

    it("renames to the same name in other letters' case, which the folder doesn't list", () => {
      expect(checkName(renaming("README.md"), "readme.md", listings)).toEqual({
        outcome: "commit",
        path: "readme.md",
      })
    })

    it("needs a name, of one entry, that no other entry beside it has", () => {
      expect(checkName(renaming("src/App.tsx"), "", listings)).toEqual({
        outcome: "invalid",
        problem: "A name is needed.",
      })
      expect(checkName(renaming("src/App.tsx"), "app/App.tsx", listings)).toEqual({
        outcome: "invalid",
        problem: "A name can't hold a slash.",
      })
      expect(checkName(renaming("src/cart", true), "..", listings)).toEqual({
        outcome: "invalid",
        problem: "A name can't be . or ..",
      })
      expect(checkName(renaming("src/App.tsx"), "cart", listings)).toEqual({
        outcome: "invalid",
        problem: "There's already a folder named cart here.",
      })
    })
  })

  context("when a rename starts", () => {
    it("selects a file's name without its extension, and the whole of any other", () => {
      expect(nameSelection("useCart.ts", false)).toEqual([0, 7])
      expect(nameSelection("Cart.test.tsx", false)).toEqual([0, 9])
      expect(nameSelection(".gitignore", false)).toEqual([0, 10])
      expect(nameSelection("Makefile", false)).toEqual([0, 8])
      expect(nameSelection("v1.2", true)).toEqual([0, 4])
    })
  })
})

describe("Where a new entry goes", () => {
  const rows = visibleLines(buildTree(listings), new Set(["src", "src/cart"])).filter(isRow)
  const rowAt = (path: string): FilesRow => rows.find((row) => row.node.path === path)!

  it("goes inside a folder, beside a file, and in the root off a row", () => {
    expect(newEntryIn(rowAt("src/cart"))).toBe("src/cart")
    expect(newEntryIn(rowAt("src/App.tsx"))).toBe("src")
    expect(newEntryIn(rowAt("README.md"))).toBe("")
    expect(newEntryIn(undefined)).toBe("")
  })
})

describe("Which rows the person may change", () => {
  const work: FilesProject = {
    changes: {
      "src/App.tsx": { kind: "modified", touched: { moth: 1 } },
      "src/new.ts": { kind: "added", touched: { moth: 1 } },
      "src/api/orders.ts": { kind: "added", touched: { crow: 1 } },
      "README.md": { kind: "deleted", touched: { crow: 1 } },
    },
    writing: {},
  }
  const rows = visibleLines(buildTree(listings, work), new Set(["src", "src/api"])).filter(isRow)
  const nodeAt = (path: string) => rows.find((row) => row.node.path === path)!.node

  it("changes what the project's folder lists, an agent's changes to it too", () => {
    expect(changeable(nodeAt("src"))).toBe(true)
    expect(changeable(nodeAt("src/App.tsx"))).toBe(true)
  })

  it("leaves alone what only an agent's work has, and what an agent deleted", () => {
    expect(changeable(nodeAt("src/new.ts"))).toBe(false)
    expect(changeable(nodeAt("src/api"))).toBe(false)
    expect(changeable(nodeAt("src/api/orders.ts"))).toBe(false)
    expect(changeable(nodeAt("README.md"))).toBe(false)
  })
})

describe("What the panel knows of the folders after a change", () => {
  context("when an entry is made", () => {
    it("lists it in its folder, read", () => {
      expect(names(listingsMade(listings, "src/index.ts", false))["src"]).toEqual([
        "App.tsx",
        "cart",
        "index.ts",
      ])
    })

    it("lists the folders made on the way in theirs, each read and holding the next", () => {
      const made = listingsMade(listings, "docs/guides/setup/install.md", false)
      expect(names(made)).toMatchObject({
        docs: ["guides"],
        "docs/guides": ["setup"],
        "docs/guides/setup": ["install.md"],
      })
      expect(made.get("docs/guides")).toMatchObject({ entries: [{ folder: true }] })
    })

    it("has a new folder read and empty", () => {
      expect(listingsMade(listings, "assets", true).get("assets")).toEqual({
        entries: [],
        truncated: false,
      })
    })

    it("leaves a folder not read for its read", () => {
      const unread = new Map([...listings].filter(([folder]) => folder !== "src"))
      expect(names(listingsMade(unread, "src/index.ts", false))["src"]).toBeUndefined()
    })
  })

  context("when an entry moves", () => {
    it("lists it under its new name", () => {
      expect(names(listingsMoved(listings, "src/App.tsx", "src/Main.tsx"))["src"]).toEqual([
        "Main.tsx",
        "cart",
      ])
    })

    it("keeps what a renamed folder lists, and the folders read inside it, at their new paths", () => {
      const nested = new Map(listings).set("src/cart/parts", { entries: [], truncated: false })
      const renamed = listingsMoved(nested, "src/cart", "src/basket")
      expect(names(renamed)).toMatchObject({
        src: ["App.tsx", "basket"],
        "src/basket": ["Cart.tsx", "useCart.ts"],
        "src/basket/parts": [],
      })
      expect(renamed.has("src/cart")).toBe(false)
    })

    it("moves the paths at or below the entry, and no other", () => {
      expect(moved("src/cart", "src/cart", "src/basket")).toBe("src/basket")
      expect(moved("src/cart/Cart.tsx", "src/cart", "src/basket")).toBe("src/basket/Cart.tsx")
      expect(moved("src/cartography", "src/cart", "src/basket")).toBe("src/cartography")
    })
  })

  context("when an entry is deleted", () => {
    it("lists neither it nor anything that was in it", () => {
      const removed = listingsRemoved(listings, "src/cart")
      expect(names(removed)["src"]).toEqual(["App.tsx"])
      expect(removed.has("src/cart")).toBe(false)
    })
  })
})

describe("The row that takes focus once one leaves", () => {
  const rows = visibleLines(buildTree(listings), new Set(["src", "src/cart"])).filter(isRow)
  const paths = rows.map((row) => row.node.path)

  it("is the one after it, past what was inside it", () => {
    expect(paths).toEqual([
      "docs",
      "src",
      "src/cart",
      "src/cart/Cart.tsx",
      "src/cart/useCart.ts",
      "src/App.tsx",
      "README.md",
    ])
    expect(rowAfterLeaving(rows, "src/cart")?.node.path).toBe("src/App.tsx")
  })

  it("is the one before it, where none follows", () => {
    expect(rowAfterLeaving(rows, "README.md")?.node.path).toBe("src/App.tsx")
  })

  it("is none where nothing stays", () => {
    const alone = visibleLines(buildTree(folderListings(["only.md"])), new Set()).filter(isRow)
    expect(rowAfterLeaving(alone, "only.md")).toBeUndefined()
  })
})
