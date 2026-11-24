import { ChangeUnanswered } from "@novadeck/core/files"
import { PlanUnwritableError, type ItemContent, type ItemId } from "@novadeck/core/items"
import { workspaceFromSeed } from "@novadeck/core/seed"
import { workspaceReducer } from "@novadeck/core/state"
import { createWorkspaceStore } from "@novadeck/core/store"
import { itemFixture } from "@novadeck/core/testing"
import type { TerminalStatus } from "@novadeck/core/types"
import { afterEach, vi } from "vitest"

import { demoTurns } from "./agents/turns"
import {
  createDemoFiles,
  endTurnIn,
  isDemoFiles,
  nextFile,
  demoPaths,
  filesThird,
  storefrontFiles,
  withFiles,
  workingInSeed,
  writeTo,
  type FilesClock,
} from "./files"
import { plainDemo } from "./index"
import { demoSeed } from "./samples"
import { context, describe, expect, it } from "./test"
import { visitorSeed } from "./visitor/seed"

const now = 1_000_000

// A clock whose timers run when a test advances it, and whose rolls are fixed.
const manual = (roll = 0.5) => {
  let time = now
  let hidden = false
  const timers = new Map<number, { at: number; run: () => void }>()
  let next = 0
  const clock: FilesClock = {
    now: () => time,
    random: () => roll,
    after: (ms, run) => {
      const id = next++
      timers.set(id, { at: time + ms, run })
      return () => void timers.delete(id)
    },
    hidden: () => hidden,
  }
  const advance = (ms: number): void => {
    const until = time + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= until)
      const first = due.toSorted((a, b) => a[1].at - b[1].at)[0]
      if (!first) break
      timers.delete(first[0])
      time = first[1].at
      first[1].run()
    }
    time = until
  }
  return {
    clock,
    advance,
    pending: () => timers.size,
    hide: (value: boolean) => void (hidden = value),
  }
}

const project = (files: ReturnType<typeof createDemoFiles>) =>
  files.state.getSnapshot().projects.storefront!

describe("the storefront's files at boot", () => {
  it("has Moth's work behind it and Crow writing its test", () => {
    const { changes, writing } = storefrontFiles(now)
    expect(changes["src/cart/useCart.ts"]).toEqual({
      kind: "modified",
      touched: { moth: now - 7 * 60_000 },
    })
    expect(changes["src/checkout/OrderSummary.tsx"]?.kind).toBe("added")
    expect(changes["src/checkout/LegacyCheckout.tsx"]?.kind).toBe("deleted")
    expect(Object.keys(changes[demoPaths.checkout]!.touched)).toEqual(["moth", "crow"])
    expect(writing).toEqual({ crow: demoPaths.checkoutTest })
  })

  it("has nobody writing where no agent works", () => {
    expect(storefrontFiles(now, []).writing).toEqual({})
  })
})

describe("who works as the demo opens", () => {
  it("is nobody in the agents demo, where Moth waits on its plan and Codex on a permission", () => {
    const { seed, files } = plainDemo("agents")
    expect(workingInSeed(seed)).toEqual([])
    expect(isDemoFiles(files) && files.state.getSnapshot().projects.storefront!.writing).toEqual({})
  })

  it("is Crow in the try demo, and Moth too while Claude Code still reads its plan", () => {
    expect(workingInSeed(visitorSeed(now, false))).toEqual(["crow"])
    expect(workingInSeed(visitorSeed(now, true))).toEqual(["moth", "crow"])
  })

  it("marks every variant as the demo, which shows the Files panel", () => {
    for (const variant of ["plain", "welcome", "agents", "messages", "inbox"] as const)
      expect(plainDemo(variant).demo).toBe(true)
  })

  it("has no files in the demos whose storefront runs no agents", () => {
    expect(isDemoFiles(plainDemo("plain").files)).toBe(false)
    expect(isDemoFiles(plainDemo("welcome").files)).toBe(false)
    for (const variant of ["agents", "messages", "inbox"] as const)
      expect(isDemoFiles(plainDemo(variant).files)).toBe(true)
  })
})

describe("the storefront's folders", () => {
  const names = (listing: { entries: readonly { name: string }[] }): string[] =>
    listing.entries.map((entry) => entry.name)

  it("list the root's files and the folders holding the rest", async () => {
    const listing = await createDemoFiles(now).list("storefront", "")
    expect(listing.truncated).toBe(false)
    expect(names(listing)).toEqual(
      expect.arrayContaining([".github", "node_modules", "src", "package.json", ".env.local"]),
    )
    expect(listing.entries.find((entry) => entry.name === "src")).toEqual({
      name: "src",
      folder: true,
      ignored: false,
    })
  })

  it("list a folder's own entries only, without the files an agent changed", async () => {
    const listing = await createDemoFiles(now).list("storefront", "src/checkout")
    expect(names(listing)).toEqual(
      expect.arrayContaining(["AddressForm.tsx", "Checkout.tsx", "PaymentStep.tsx"]),
    )
    expect(names(listing)).not.toContain("OrderSummary.tsx")
    expect(names(listing)).not.toContain("src")
  })

  it("mark what the project ignores", async () => {
    const root = await createDemoFiles(now).list("storefront", "")
    const ignored = root.entries.filter((entry) => entry.ignored).map((entry) => entry.name)
    expect(ignored.toSorted()).toEqual([".env.local", "node_modules"])
  })

  it("list an empty folder as nothing", async () => {
    expect(await createDemoFiles(now).list("storefront", "node_modules")).toEqual({
      entries: [],
      truncated: false,
    })
  })

  it("give every sample project, and one the visitor adds, a tree of its own", async () => {
    const files = createDemoFiles(now)
    const ids = ["api-service", "docs-site", "mobile-app", "design-system", "infra", "dotfiles"]
    const roots = await Promise.all(ids.map((id) => files.list(id, "")))
    expect(roots.every((root) => root.entries.length > 0)).toBe(true)
    expect(names(await files.list("api-service", "src"))).toContain("server.ts")
    expect(names(await files.list("somewhere-new", ""))).toContain("README.md")
  })

  it("hold nothing, or list only some, at the root when the debug panel says so", async () => {
    const files = createDemoFiles(now)
    files.degrade("", "empty")
    expect(await files.list("infra", "")).toEqual({ entries: [], truncated: false })
    files.degrade("", "truncate")
    expect((await files.list("infra", "")).truncated).toBe(true)
  })

  it("refuse a folder a project doesn't have", async () => {
    const files = createDemoFiles(now)
    await expect(files.list("storefront", "src/gone")).rejects.toThrow()
  })

  it("fail, or list only some, when the debug panel says so, until it says otherwise", async () => {
    const files = createDemoFiles(now)
    files.degrade("src/cart", "fail")
    files.degrade("src/components", "truncate")
    files.degrade("", "fail")
    await expect(files.list("storefront", "src/cart")).rejects.toThrow()
    await expect(files.list("storefront", "")).rejects.toThrow()
    const partial = await files.list("storefront", "src/components")
    expect(partial.truncated).toBe(true)
    expect(partial.entries).toHaveLength(2)
    files.degrade("src/cart", undefined)
    files.degrade("", undefined)
    expect((await files.list("storefront", "src/cart")).entries).not.toHaveLength(0)
    expect((await files.list("storefront", "")).truncated).toBe(false)
  })
})

describe("the person's changes to a project's files", () => {
  const names = async (
    files: ReturnType<typeof createDemoFiles>,
    folder: string,
    id = "storefront",
  ) =>
    (await files.list(id, folder)).entries
      .map((entry) => (entry.folder ? `${entry.name}/` : entry.name))
      .toSorted()

  it("makes a file or folder, and the folders on the way, which the folders then list", async () => {
    const files = createDemoFiles(now)
    await expect(files.create("storefront", "src/api/v2/orders.ts", false)).resolves.toBe(
      "src/api/v2/orders.ts",
    )
    await files.create("storefront", "assets", true)
    await files.create("storefront", "node_modules/.keep", false)

    expect(await names(files, "src/api")).toEqual(["client.ts", "orders.ts", "v2/"])
    expect(await names(files, "src/api/v2")).toEqual(["orders.ts"])
    expect(await files.list("storefront", "assets")).toEqual({ entries: [], truncated: false })
    expect(await names(files, "node_modules")).toEqual([".keep"])
  })

  it("refuses a name taken, a way through a file, the project's folder and Git's .git, in the runner's words", async () => {
    const files = createDemoFiles(now)
    await expect(files.create("storefront", "src/App.tsx", false)).rejects.toThrow(
      "There's already something named App.tsx in src.",
    )
    await expect(files.create("storefront", "src", true)).rejects.toThrow(
      "There's already something named src in the project's folder.",
    )
    await expect(files.create("storefront", "README.md/notes.md", false)).rejects.toThrow(
      "README.md isn't a folder.",
    )
    await expect(files.create("storefront", ".GIT/hooks", true)).rejects.toThrow(
      "Novadeck doesn't change Git's own .git.",
    )
    await expect(files.remove("storefront", "")).rejects.toThrow(
      "Novadeck doesn't change the project's folder itself.",
    )
  })

  it("renames a file, and a folder with everything in it, as it is spelled", async () => {
    const files = createDemoFiles(now)
    await expect(files.move("storefront", "src/cart", "src/basket")).resolves.toBe("src/basket")
    await files.move("storefront", "README.md", "readme.md")

    expect(await names(files, "src")).toContain("basket/")
    expect(await names(files, "src")).not.toContain("cart/")
    expect(await names(files, "src/basket")).toEqual([
      "CartItem.tsx",
      "CartSummary.tsx",
      "useCart.ts",
    ])
    expect(await names(files, "")).toContain("readme.md")
    await expect(files.list("storefront", "src/cart")).rejects.toThrow()
  })

  it("keeps what a project ignores ignored where it moves", async () => {
    const files = createDemoFiles(now)
    await files.move("storefront", "node_modules", "deps")
    const root = await files.list("storefront", "")
    expect(root.entries.find((entry) => entry.name === "deps")).toEqual({
      name: "deps",
      folder: true,
      ignored: true,
    })
  })

  it("refuses a move onto a name taken, into itself, or of what isn't there", async () => {
    const files = createDemoFiles(now)
    await expect(files.move("storefront", "src/main.tsx", "src/App.tsx")).rejects.toThrow(
      "There's already something named App.tsx in src.",
    )
    await expect(files.move("storefront", "src", "src/inner")).rejects.toThrow(
      "A folder can't move into itself.",
    )
    await expect(files.move("storefront", "src/gone.ts", "src/here.ts")).rejects.toThrow(
      "src/gone.ts isn't there any more.",
    )
  })

  it("deletes a file, and a folder with everything in it, keeping the folder it was in, empty", async () => {
    const files = createDemoFiles(now)
    await files.remove("storefront", "src/components")
    await files.remove("storefront", "public/favicon.svg")

    expect(await names(files, "src")).not.toContain("components/")
    expect(await files.list("storefront", "public")).toEqual({ entries: [], truncated: false })
    await expect(files.remove("storefront", "src/components")).rejects.toThrow(
      "src/components isn't there any more.",
    )
  })

  it("keeps each project's changes to itself, and each demo's from the next", async () => {
    const files = createDemoFiles(now)
    await files.remove("api-service", "Dockerfile")
    expect(await names(files, "", "api-service")).not.toContain("Dockerfile")
    expect(await names(createDemoFiles(now), "", "api-service")).toContain("Dockerfile")
    expect(await names(files, "", "storefront")).toContain("package.json")
  })

  it("has the agents' work follow a rename, and go with a delete", async () => {
    const files = createDemoFiles(now)
    await files.move("storefront", "src/checkout", "src/pay")
    expect(project(files).changes["src/pay/Checkout.tsx"]).toBeDefined()
    expect(project(files).changes[demoPaths.checkout]).toBeUndefined()
    expect(project(files).writing.crow).toBe("src/pay/Checkout.test.tsx")

    await files.remove("storefront", "src/pay")
    expect(Object.keys(project(files).changes).some((path) => path.startsWith("src/pay"))).toBe(
      false,
    )
    expect(project(files).writing.crow).toBeUndefined()
  })

  it("counts an agent's write to a file the person made as a change, and to one they deleted as new", async () => {
    const files = createDemoFiles(now)
    await files.create("storefront", "src/notes.ts", false)
    await files.remove("storefront", "src/main.tsx")
    files.write("crow", "src/notes.ts")
    files.write("crow", "src/main.tsx")
    expect(project(files).changes["src/notes.ts"]?.kind).toBe("modified")
    expect(project(files).changes["src/main.tsx"]?.kind).toBe("added")
  })

  it("fails the next change once when the debug panel says so, and not once it lifts that", async () => {
    const files = createDemoFiles(now)
    files.failNextChange()
    await expect(files.create("storefront", "a.ts", false)).rejects.toThrow(
      "The demo was told to fail this change.",
    )
    await expect(files.create("storefront", "a.ts", false)).resolves.toBe("a.ts")
    files.failNextChange()
    files.failNextChange(false)
    await expect(files.remove("storefront", "a.ts")).resolves.toBeUndefined()
  })

  it("copies an entry beside itself as the runner names it: name copy.ext, then copy 2, a folder's and a dotfile's at the end", async () => {
    const files = createDemoFiles(now)
    const made = [
      await files.copy("storefront", "src/App.tsx", "src"),
      await files.copy("storefront", "src/App.tsx", "src"),
      await files.copy("storefront", ".gitignore", ""),
      await files.copy("storefront", "src/cart", "src"),
    ]

    expect(made).toEqual([
      "src/App copy.tsx",
      "src/App copy 2.tsx",
      ".gitignore copy",
      "src/cart copy",
    ])
    expect(await names(files, "src/cart copy")).toEqual([
      "CartItem.tsx",
      "CartSummary.tsx",
      "useCart.ts",
    ])
  })

  it("copies into another folder under its own name where that is free, a folder with all it holds", async () => {
    const files = createDemoFiles(now)
    await expect(files.copy("storefront", "src/cart", "public")).resolves.toBe("public/cart")
    await expect(files.copy("storefront", "README.md", "public")).resolves.toBe("public/README.md")
    await expect(files.copy("storefront", "README.md", "public")).resolves.toBe(
      "public/README copy.md",
    )

    expect(await names(files, "public")).toEqual([
      "README copy.md",
      "README.md",
      "cart/",
      "favicon.svg",
    ])
    expect(await names(files, "src/cart")).toEqual([
      "CartItem.tsx",
      "CartSummary.tsx",
      "useCart.ts",
    ])
  })

  it("keeps what a project ignores ignored in a copy, and leaves the agents' work where it was", async () => {
    const files = createDemoFiles(now)
    await files.copy("storefront", "node_modules", "src")
    await files.copy("storefront", "src/cart", "")

    expect((await files.list("storefront", "src")).entries).toContainEqual({
      name: "node_modules",
      folder: true,
      ignored: true,
    })
    expect(project(files).changes["src/cart/useCart.ts"]).toBeDefined()
    expect(project(files).changes["cart/useCart.ts"]).toBeUndefined()
  })

  it("refuses a folder into itself, what isn't there, a folder that is a file, and Git's .git, in the runner's words", async () => {
    const files = createDemoFiles(now)
    await expect(files.copy("storefront", "src", "src/cart")).rejects.toThrow(
      "A folder can't be copied into itself.",
    )
    await expect(files.copy("storefront", "src/gone.ts", "")).rejects.toThrow(
      "src/gone.ts isn't there any more.",
    )
    await expect(files.copy("storefront", "README.md", "package.json")).rejects.toThrow(
      "package.json isn't a folder.",
    )
    await expect(files.copy("storefront", "README.md", "missing")).rejects.toThrow(
      "missing isn't there any more.",
    )
    await expect(files.copy("storefront", "README.md", ".git")).rejects.toThrow(
      "Novadeck doesn't change Git's own .git.",
    )
    await expect(files.copy("storefront", "", "src")).rejects.toThrow(
      "Novadeck doesn't change the project's folder itself.",
    )
  })

  it("fails the next paste once when the debug panel says so, a copy or a move into another folder, not a rename", async () => {
    const files = createDemoFiles(now)
    files.failNextPaste()
    await expect(files.move("storefront", "README.md", "README.txt")).resolves.toBe("README.txt")
    await expect(files.copy("storefront", "README.txt", "")).rejects.toThrow(
      "The demo was told to fail this paste.",
    )
    await expect(files.copy("storefront", "README.txt", "")).resolves.toBe("README copy.txt")

    files.failNextPaste()
    await expect(files.move("storefront", "README.txt", "public/README.txt")).rejects.toThrow(
      "The demo was told to fail this paste.",
    )
    files.failNextPaste()
    files.failNextPaste(false)
    await expect(files.move("storefront", "README.txt", "public/README.txt")).resolves.toBe(
      "public/README.txt",
    )
  })

  it("keeps the next change's failure from a paste, and the next paste's from a change", async () => {
    const files = createDemoFiles(now)
    files.failNextChange()
    await expect(files.copy("storefront", "README.md", "public")).resolves.toBe("public/README.md")
    await expect(files.create("storefront", "a.ts", false)).rejects.toThrow(
      "The demo was told to fail this change.",
    )
  })

  it("answers the next move, copy or delete made as one whose answer was lost, once, when the debug panel says so", async () => {
    const files = createDemoFiles(now)
    files.loseNextAnswer()
    await expect(files.copy("storefront", "README.md", "public")).rejects.toBeInstanceOf(
      ChangeUnanswered,
    )
    expect(await names(files, "public")).toContain("README.md")
    await expect(files.remove("storefront", "public/README.md")).resolves.toBeUndefined()

    files.loseNextAnswer()
    await expect(files.remove("storefront", "index.html")).rejects.toBeInstanceOf(ChangeUnanswered)
    files.loseNextAnswer()
    files.loseNextAnswer(false)
    await expect(files.move("storefront", "README.md", "README.txt")).resolves.toBe("README.txt")
  })

  it("takes the time the debug panel says for the next paste, once, until it says otherwise", async () => {
    const { clock, advance } = manual()
    const files = createDemoFiles(now, clock)
    files.slowNextPaste(5000)
    let made: string | undefined
    const copying = files.copy("storefront", "README.md", "public").then((path) => (made = path))

    advance(4999)
    await Promise.resolve()
    expect(made).toBeUndefined()
    advance(1)
    await copying
    expect(made).toBe("public/README.md")

    await expect(files.copy("storefront", "README.md", "public")).resolves.toBe(
      "public/README copy.md",
    )
    files.slowNextPaste(5000)
    files.slowNextPaste()
    await expect(files.copy("storefront", "README.md", "")).resolves.toBe("README copy.md")
  })

  it("says a file the person deleted or moved away is gone, until it is there again, telling each time", async () => {
    const files = createDemoFiles(now)
    let told = 0
    const unwatch = files.watchGone(() => void (told += 1))
    await files.remove("storefront", "src/cart")
    await files.move("storefront", "README.md", "README.txt")

    expect(files.gone("storefront", "src/cart/useCart.ts")).toBe(true)
    expect(files.gone("storefront", "README.md")).toBe(true)
    expect(files.gone("storefront", "README.txt")).toBe(false)
    expect(files.gone("api-service", "README.md")).toBe(false)

    await files.create("storefront", "src/cart/useCart.ts", false)
    expect(files.gone("storefront", "src/cart/useCart.ts")).toBe(false)
    expect(files.gone("storefront", "src/cart/CartItem.tsx")).toBe(true)
    unwatch()
    await files.remove("storefront", "index.html")
    expect(told).toBe(3)
  })
})

describe("a write to the project", () => {
  // The storefront's files these writes are to, as its tree holds them.
  const tree = [demoPaths.checkout, demoPaths.checkoutTest]

  it("moves the agent's time on and makes the file the one it writes", () => {
    const after = writeTo(storefrontFiles(now), "crow", demoPaths.checkoutTest, now + 5, tree)
    expect(after.changes[demoPaths.checkoutTest]).toEqual({
      kind: "modified",
      touched: { crow: now + 5 },
    })
    expect(after.writing.crow).toBe(demoPaths.checkoutTest)
  })

  it("keeps what other agents did to the file", () => {
    const after = writeTo(storefrontFiles(now), filesThird, demoPaths.checkout, now + 5, tree)
    expect(Object.keys(after.changes[demoPaths.checkout]!.touched).toSorted()).toEqual([
      "crow",
      "moth",
      "owl",
    ])
  })

  it("adds a file the tree doesn't have", () => {
    const after = writeTo(storefrontFiles(now), "crow", demoPaths.payments, now, tree)
    expect(after.changes[demoPaths.payments]?.kind).toBe("added")
  })

  it("leaves the project it was given as it was", () => {
    const before = storefrontFiles(now)
    writeTo(before, "crow", demoPaths.payments, now, tree)
    expect(before.changes[demoPaths.payments]).toBeUndefined()
  })
})

describe("the end of a turn", () => {
  it("takes the agent's file away and keeps its changes", () => {
    const after = endTurnIn(storefrontFiles(now), "crow")
    expect(after.writing).toEqual({})
    expect(after.changes[demoPaths.checkoutTest]).toBeDefined()
  })
})

describe("the file an agent writes next", () => {
  const before = storefrontFiles(now)

  it("is mostly the one it is on", () => {
    expect(nextFile(before, "crow", 0.9, 0)).toBe(demoPaths.checkoutTest)
  })

  it("is sometimes another of its pool", () => {
    expect(nextFile(before, "crow", 0.2, 0)).toBe(demoPaths.checkout)
  })

  it("is a new file the first time it rolls low, and not after", () => {
    const created = nextFile(before, "crow", 0.05, 0)
    expect(created).toBe("src/checkout/PaymentForm.tsx")
    const later = writeTo(before, "crow", created, now, [])
    expect(nextFile(later, "crow", 0.05, 0)).toBe(demoPaths.payments)
  })

  it("is never a new file for an agent that creates none", () => {
    expect(nextFile(before, "moth", 0.05, 0)).toBe("src/cart/useCart.ts")
  })
})

describe("each demo project's patterns for hiding files", () => {
  it("are none until saved, then kept apart for each project", async () => {
    const files = createDemoFiles(now)
    await expect(files.exclude.read("storefront")).resolves.toEqual({})

    await files.exclude.save("storefront", { "**/*.test.tsx": true, "*.md": false })

    await expect(files.exclude.read("storefront")).resolves.toEqual({
      "**/*.test.tsx": true,
      "*.md": false,
    })
    await expect(files.exclude.read("infra")).resolves.toEqual({})
  })

  it("fail the next save when the debug panel says so, once, keeping what was there", async () => {
    const files = createDemoFiles(now)
    await files.exclude.save("storefront", { dist: true })
    files.failNextExcludeSave()

    await expect(files.exclude.save("storefront", {})).rejects.toThrow("told to fail")
    await expect(files.exclude.read("storefront")).resolves.toEqual({ dist: true })
    await files.exclude.save("storefront", {})
    await expect(files.exclude.read("storefront")).resolves.toEqual({})
  })

  it("save again when the debug panel lifts the failure before it happens", async () => {
    const files = createDemoFiles(now)
    files.failNextExcludeSave()
    files.failNextExcludeSave(false)

    await files.exclude.save("storefront", { dist: true })
    await expect(files.exclude.read("storefront")).resolves.toEqual({ dist: true })
  })

  it("can't be read when the debug panel says so, until it says otherwise", async () => {
    const files = createDemoFiles(now)
    await files.exclude.save("storefront", { dist: true })
    files.failExcludeReads()

    await expect(files.exclude.read("storefront")).rejects.toThrow("told to fail")
    await expect(files.exclude.read("storefront")).rejects.toThrow("told to fail")
    files.failExcludeReads(false)
    await expect(files.exclude.read("storefront")).resolves.toEqual({ dist: true })
  })

  it("refuse more than a project keeps, as the runner does", async () => {
    const files = createDemoFiles(now)
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, at) => [`${at}.log`, true]))

    await expect(files.exclude.save("storefront", many)).rejects.toThrow("at most 200 patterns")
  })
})

describe("the demo files", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("is the demo's, which the debug panel writes to", () => {
    expect(isDemoFiles(createDemoFiles(now))).toBe(true)
    expect(
      isDemoFiles({ state: createDemoFiles(now).state, list: createDemoFiles(now).list }),
    ).toBe(false)
  })

  it("has the storefront and no other project", () => {
    expect(Object.keys(createDemoFiles(now).state.getSnapshot().projects)).toEqual(["storefront"])
  })

  it("writes at the clock's time", () => {
    const { clock, advance } = manual()
    const files = createDemoFiles(now, clock)
    advance(2000)
    files.write("crow", demoPaths.payments)
    expect(project(files).changes[demoPaths.payments]?.touched.crow).toBe(now + 2000)
  })

  context("running", () => {
    it("has Crow write every few seconds", () => {
      const { clock, advance } = manual()
      const files = createDemoFiles(now, clock)
      const stop = files.start()
      advance(4999)
      expect(project(files).changes[demoPaths.checkoutTest]!.touched.crow).toBe(now - 20_000)
      advance(1)
      expect(project(files).changes[demoPaths.checkoutTest]!.touched.crow).toBe(now + 5000)
      stop()
    })

    it("has Crow end its turn for a rest, then write again", () => {
      const { clock, advance } = manual()
      const files = createDemoFiles(now, clock)
      const stop = files.start()
      // Six writes a turn at a roll of one half, 5 s apart.
      advance(5000 * 6)
      expect(project(files).writing.crow).toBeUndefined()
      advance(15_000 + 5000)
      expect(project(files).writing.crow).toBe(demoPaths.checkoutTest)
      stop()
    })

    it("writes nothing while the page is hidden", () => {
      const { clock, advance, hide } = manual()
      const files = createDemoFiles(now, clock)
      const stop = files.start()
      hide(true)
      advance(60_000)
      expect(project(files).changes[demoPaths.checkoutTest]!.touched.crow).toBe(now - 20_000)
      stop()
    })

    it("stops with its stop", () => {
      const { clock, pending } = manual()
      const stop = createDemoFiles(now, clock).start()
      stop()
      expect(pending()).toBe(0)
    })

    it("leaves Moth still while it waits", () => {
      const { clock, advance } = manual()
      const files = createDemoFiles(now, clock)
      const stop = files.start(demoTurns())
      advance(120_000)
      expect(project(files).changes["src/cart/useCart.ts"]!.touched.moth).toBe(now - 7 * 60_000)
      expect(project(files).writing.moth).toBeUndefined()
      stop()
    })

    it("has Moth write while its turn works and stop when it ends", () => {
      const { clock, advance } = manual()
      const turns = demoTurns()
      const files = createDemoFiles(now, clock)
      const stop = files.start(turns)
      const key = {
        projectId: "storefront",
        workspaceSessionId: "initial",
        terminalId: "storefront-initial-01",
      }
      turns.work(key, undefined)
      advance(5000)
      expect(project(files).writing.moth).toBe("src/cart/CartSummary.tsx")
      turns.rest(key, undefined)
      expect(project(files).writing.moth).toBeUndefined()
      stop()
    })

    const crowKey = {
      projectId: "storefront",
      workspaceSessionId: "initial",
      terminalId: "storefront-initial-04",
    }
    const mothKey = { ...crowKey, terminalId: "storefront-initial-01" }

    it("leaves Crow still while its agent waits on the person, and has it write again after", () => {
      const { clock, advance } = manual()
      const turns = demoTurns()
      const files = createDemoFiles(now, clock)
      const stop = files.start(turns)
      turns.ask(crowKey, undefined, "permission", 1)
      expect(project(files).writing.crow).toBeUndefined()
      advance(60_000)
      expect(project(files).changes[demoPaths.checkoutTest]!.touched.crow).toBe(now - 20_000)
      turns.work(crowKey, undefined)
      advance(5000)
      expect(project(files).writing.crow).toBe(demoPaths.checkoutTest)
      expect(project(files).changes[demoPaths.checkoutTest]!.touched.crow).toBe(now + 65_000)
      stop()
    })

    it("has Crow write through no permission prompt that is open", () => {
      const { clock, advance } = manual()
      const turns = demoTurns()
      const files = createDemoFiles(now, clock)
      const stop = files.start(turns)
      advance(5000)
      turns.ask(crowKey, undefined, "question", 1)
      const touched = project(files).changes[demoPaths.checkoutTest]!.touched.crow
      advance(60_000)
      expect(project(files).changes[demoPaths.checkoutTest]!.touched.crow).toBe(touched)
      stop()
    })

    it("does not start Moth writing on a request", () => {
      const { clock, advance } = manual()
      const turns = demoTurns()
      const files = createDemoFiles(now, clock)
      const stop = files.start(turns)
      turns.ask(mothKey, undefined, "permission", 1)
      advance(60_000)
      expect(project(files).writing.moth).toBeUndefined()
      expect(project(files).changes["src/cart/useCart.ts"]!.touched.moth).toBe(now - 7 * 60_000)
      stop()
    })

    it("has nothing write when the agent rests, and Crow's cursor go", () => {
      const { clock, advance } = manual()
      const turns = demoTurns()
      const files = createDemoFiles(now, clock)
      const stop = files.start(turns)
      turns.rest(crowKey, undefined)
      expect(project(files).writing.crow).toBeUndefined()
      advance(60_000)
      expect(project(files).writing.crow).toBeUndefined()
      stop()
    })

    it("leaves no cursor when it stops", () => {
      const { clock, advance } = manual()
      const turns = demoTurns()
      const files = createDemoFiles(now, clock)
      const stop = files.start(turns)
      turns.work(mothKey, undefined)
      advance(5000)
      expect(Object.keys(project(files).writing).toSorted()).toEqual(["crow", "moth"])
      stop()
      expect(project(files).writing).toEqual({})
    })

    it("moves nothing where the visitor asked for less motion", () => {
      vi.stubGlobal("matchMedia", () => ({ matches: true }))
      const { clock, pending } = manual()
      const stop = createDemoFiles(now, clock).start()
      expect(pending()).toBe(0)
      stop()
    })

    it("moves nothing on a page held still", () => {
      vi.stubGlobal("location", { search: "?still" })
      const { clock, pending } = manual()
      createDemoFiles(now, clock).start()
      expect(pending()).toBe(0)
    })

    it("shows nobody writing on a page held still", () => {
      vi.stubGlobal("location", { search: "?still" })
      const { clock } = manual()
      const files = createDemoFiles(now, clock)
      files.start(demoTurns())
      expect(project(files).writing).toEqual({})
    })

    it("leaves the store as it was when an idle agent is stopped again", () => {
      const { clock } = manual()
      const files = createDemoFiles(now, clock, [])
      const before = files.state.getSnapshot()
      files.endTurn("moth")
      expect(files.state.getSnapshot()).toBe(before)
    })

    it("takes Crow's cursor away under less motion once its agent waits on the person", () => {
      vi.stubGlobal("matchMedia", () => ({ matches: true }))
      const { clock } = manual()
      const turns = demoTurns()
      const files = createDemoFiles(now, clock)
      files.start(turns)
      expect(project(files).writing.crow).toBe(demoPaths.checkoutTest)
      turns.ask(crowKey, undefined, "permission", 1)
      expect(project(files).writing.crow).toBeUndefined()
    })

    it("has Crow write no more once its terminal closes, even when its agent works again", () => {
      const { clock, advance, pending } = manual()
      const turns = demoTurns()
      const files = createDemoFiles(now, clock)
      const stop = files.start(turns)
      files.close(crowKey.terminalId)
      expect(project(files).writing.crow).toBeUndefined()
      expect(pending()).toBe(0)
      turns.work(crowKey, undefined)
      advance(60_000)
      expect(project(files).writing.crow).toBeUndefined()
      expect(project(files).changes[demoPaths.checkoutTest]!.touched.crow).toBe(now - 20_000)
      stop()
    })
  })
})

describe("a backend with the demo's files", () => {
  const target = { projectId: "storefront", workspaceSessionId: "initial" }
  const workspace = workspaceFromSeed(demoSeed(now), { view: "focus", windowedView: "grid", now })

  context("where a window shows a file of the project", () => {
    const ready: ItemContent = {
      state: "ready",
      stamp: "1",
      content: {
        kind: "file",
        path: "~/shown.ts",
        firstLine: 1,
        lines: ["export {}"],
        from: 1,
        to: 1,
        total: 1,
        truncated: false,
        clamped: false,
      },
    }
    // The demo's backend whose companions show `ready` for every item, with a window in the
    // storefront's first session showing the file at `path`, and what it heard.
    const showing = (files: ReturnType<typeof createDemoFiles>, path: string) => {
      const inner = plainDemo("plain")
      const backend = withFiles(
        {
          ...inner,
          companions: { ...inner.companions!, follow: (_t, _id, _o, on) => (on(ready), () => {}) },
        },
        undefined,
        files,
      )
      const directory = workspace.projects.find((each) => each.id === "storefront")!.directory
      const item = itemFixture("shown", "01", { path: `${directory}/${path}` })
      backend.commit(workspaceReducer(workspace, { type: "item/upsert", target, item }), [])
      const heard: ItemContent[] = []
      const stop = backend.companions!.follow(target, item.id, { reveal: undefined }, (content) =>
        heard.push(content),
      )
      return { heard, stop }
    }
    const missing = { state: "unavailable", reason: "missing", size: null }

    it("shows the file as it is until the person deletes it, then says it is gone", async () => {
      const files = createDemoFiles(now)
      const { heard } = showing(files, "src/cart/useCart.ts")
      await files.remove("storefront", "src/main.tsx")
      expect(heard).toEqual([ready])

      await files.remove("storefront", "src/cart")
      expect(heard).toEqual([ready, missing])
    })

    it("says a file the person moved away is gone, and shows it again once it is back", async () => {
      const files = createDemoFiles(now)
      const { heard } = showing(files, "README.md")
      await files.move("storefront", "README.md", "README.txt")
      await files.move("storefront", "README.txt", "README.md")
      expect(heard).toEqual([ready, missing, ready])
    })

    it("hears nothing more once it stops following", async () => {
      const files = createDemoFiles(now)
      const { heard, stop } = showing(files, "README.md")
      stop()
      await files.remove("storefront", "README.md")
      expect(heard).toEqual([ready])
    })
  })

  it("stops the agent of a terminal that closes", () => {
    const { clock, pending } = manual()
    const files = createDemoFiles(now, clock)
    const stop = files.start()
    withFiles(plainDemo("plain"), undefined, files).commit(workspace, [
      { type: "terminal/close", target, terminalId: "storefront-initial-04" },
    ])
    expect(project(files).writing.crow).toBeUndefined()
    expect(pending()).toBe(0)
    stop()
  })

  // The try demo's workspace, where Moth and Crow work and ask nothing.
  const working = workspaceFromSeed(visitorSeed(now, true), {
    view: "focus",
    windowedView: "grid",
    now,
  })
  const crowId = "storefront-initial-04"
  const started = () => {
    const { clock, advance } = manual()
    const turns = demoTurns()
    const files = createDemoFiles(now, clock, ["moth", "crow"])
    const stop = files.start(turns)
    // Both have written by now.
    advance(5000)
    return { files, turns, advance, stop }
  }

  it("keeps the agents going when the storefront project is refused removal", () => {
    const { files, stop } = started()
    expect(Object.keys(project(files).writing).toSorted()).toEqual(["crow", "moth"])
    withFiles(plainDemo("plain"), undefined, files).commit(working, [
      { type: "project/remove", projectId: "storefront", now },
    ])
    expect(Object.keys(project(files).writing).toSorted()).toEqual(["crow", "moth"])
    stop()
  })

  it("stops every agent when the storefront project is really gone", () => {
    const { files, turns, advance, stop } = started()
    const gone = {
      ...working,
      projects: working.projects.filter((each) => each.id !== "storefront"),
    }
    withFiles(plainDemo("plain"), turns, files).commit(gone, [
      { type: "project/remove", projectId: "storefront", now },
    ])
    expect(project(files).writing).toEqual({})
    advance(60_000)
    expect(project(files).writing).toEqual({})
    stop()
  })

  it("has no agent write after a restart while it waits on the person", () => {
    const { clock, advance } = manual()
    const turns = demoTurns()
    const files = createDemoFiles(now, clock, ["moth", "crow"])
    const backend = withFiles(plainDemo("plain"), turns, files)
    backend.commit(working, [])
    const sink = { dispatch: () => {}, open: () => {} }
    backend.start!(sink)()
    // Crow asks while the backend is stopped, and no commit comes after the restart.
    const asking = workspaceReducer(working, {
      type: "terminal/status",
      target,
      terminalId: crowId,
      status: {
        state: "running",
        agent: { working: true, attention: { kind: "permission", count: 1 } },
      },
    })
    backend.commit(asking, [])
    const stop = backend.start!(sink)
    advance(60_000)
    expect(project(files).writing.crow).toBeUndefined()
    expect(project(files).writing.moth).toBeDefined()
    stop()
  })

  // What the debug panel does to a terminal: it releases the agent and dispatches a status
  // itself, so the turns never report it.
  const dispatched = (status: TerminalStatus) => {
    const action = { type: "terminal/status" as const, target, terminalId: crowId, status }
    return { action, after: workspaceReducer(working, action) }
  }

  it("stops Crow writing once its terminal is at a prompt, however it got there", () => {
    const { files, turns, advance, stop } = started()
    expect(project(files).writing.crow).toBeDefined()
    turns.release({ ...target, terminalId: crowId })
    const { action, after } = dispatched({ state: "running" })
    withFiles(plainDemo("plain"), turns, files).commit(after, [action])
    expect(project(files).writing.crow).toBeUndefined()
    advance(60_000)
    expect(project(files).writing.crow).toBeUndefined()
    expect(project(files).writing.moth).toBeDefined()
    stop()
  })

  it("stops Crow writing once its terminal failed, as in the crash loop", () => {
    const { files, advance, stop } = started()
    const { action, after } = dispatched({ state: "failed", message: "crashed" })
    withFiles(plainDemo("plain"), undefined, files).commit(after, [action])
    expect(project(files).writing.crow).toBeUndefined()
    advance(60_000)
    expect(project(files).writing.crow).toBeUndefined()
    stop()
  })

  it("has Crow write again when its agent is reported working after that", () => {
    const { files, turns, advance, stop } = started()
    const { action, after } = dispatched({ state: "running" })
    withFiles(plainDemo("plain"), turns, files).commit(after, [action])
    expect(project(files).writing.crow).toBeUndefined()
    turns.work({ ...target, terminalId: crowId }, undefined)
    advance(8000)
    expect(project(files).writing.crow).toBeDefined()
    stop()
  })
})

describe("the file the project window edits, in the agents demo", () => {
  const target = { projectId: "storefront", workspaceSessionId: "initial" }
  const stops: (() => void)[] = []
  afterEach(() => stops.splice(0).forEach((stop) => stop()))

  // The agents demo, started over a workspace store as the app keeps one, with its files and
  // ways to open a file in the project window, follow an item and save the window's file.
  const started = () => {
    const backend = plainDemo("agents")
    const files = backend.files
    if (!isDemoFiles(files)) throw new Error("The agents demo has files")
    const store = createWorkspaceStore(
      workspaceFromSeed(backend.seed, { view: "focus", windowedView: "grid", now }),
      backend.commit,
    )
    backend.commit(store.getSnapshot(), [])
    stops.push(
      backend.start!({
        dispatch: (actions) => void store.transact(actions as never),
        open: () => {},
      }),
    )
    const companions = backend.companions!
    const open = async (path: string): Promise<{ readonly id: ItemId; readonly at: string }> => {
      const { item } = await companions.openInProject!(target, path, "project-window")
      return { id: item.id, at: item.path! }
    }
    // What a window that follows the item hears, the last of it, once it has heard anything:
    // the demo reads the window's file whole once what keeps the edits has loaded.
    const follow = async (id: ItemId, edit = true, reveal?: string) => {
      const heard: ItemContent[] = []
      await new Promise<void>((resolve) => {
        companions.follow(target, id, { reveal, ...(edit && { edit }) }, (content) => {
          heard.push(content)
          resolve()
        })
      })
      return () => heard.at(-1)!
    }
    const save = async (opened: { readonly id: ItemId; readonly at: string }, text: string) => {
      const last = (await follow(opened.id))()
      return companions.save(
        target,
        opened.id,
        text,
        last.state === "ready" ? last.stamp : "",
        opened.at,
      )
    }
    // What the window hears of the file at `path`, opened in it.
    const read = async (path: string) => (await follow((await open(path)).id))()
    return { files, companions, open, follow, save, read }
  }

  const textOf = (content: ItemContent): string | undefined =>
    content.state === "ready" && content.content.kind === "text" ? content.content.text : undefined

  it("reads it whole to edit, writable, and saves the person's edit, which it reads after", async () => {
    const { open, follow, save } = started()
    const opened = await open("package.json")
    expect((await follow(opened.id))()).toMatchObject({
      content: { kind: "text", text: '{\n  "name": "package"\n}\n', writable: true },
    })
    expect(await save(opened, '{ "name": "storefront" }\n')).toMatchObject({ saved: true })
    expect(textOf((await follow(opened.id))())).toBe('{ "name": "storefront" }\n')
  })

  it("keeps no edits until the window first reads a file whole, which loads them", async () => {
    const { files, open, follow } = started()
    const opened = await open("package.json")
    expect(files.edits()).toBeUndefined()
    await follow(opened.id)
    expect(files.edits()).toBeDefined()
  })

  it("tells a window that stopped following before the edits loaded nothing", async () => {
    const { files, companions, open } = started()
    const opened = await open("package.json")
    const heard: ItemContent[] = []
    companions.follow(target, opened.id, { reveal: undefined, edit: true }, (content) =>
      heard.push(content),
    )()
    await files.editing()
    await Promise.resolve()
    expect(heard).toEqual([])
  })

  it("reads a file only an agent's work has read-only, as the agent's copy it is", async () => {
    const { open, follow } = started()
    const opened = await open("src/checkout/OrderSummary.tsx")
    expect((await follow(opened.id))()).toMatchObject({
      content: { kind: "text", writable: false, reason: "outside" },
    })
  })

  it("holds a file that may hold secrets behind its gate until it is revealed, then reads it whole", async () => {
    const { open, follow } = started()
    const opened = await open(".env.local")
    expect((await follow(opened.id))()).toMatchObject({ state: "unavailable", reason: "secret" })
    expect((await follow(opened.id, true, opened.at))()).toMatchObject({
      content: { kind: "text", text: "API_URL=http://localhost:3000\n", writable: true },
    })
  })

  it("leaves a follow without edit, as the pane beside a terminal follows, the listing it was", async () => {
    const { open, follow } = started()
    const opened = await open("package.json")
    expect((await follow(opened.id, false))()).toMatchObject({ content: { kind: "file" } })
  })

  it("keeps its edits through a rename and into a copy, and makes a file empty", async () => {
    const { files, open, save, read } = started()
    await save(await open("README.md"), "# Storefront\n")
    await files.move("storefront", "README.md", "NOTES.md")
    expect(textOf(await read("NOTES.md"))).toBe("# Storefront\n")
    await files.copy("storefront", "NOTES.md", "")
    expect(textOf(await read("NOTES copy.md"))).toBe("# Storefront\n")
    await files.remove("storefront", "NOTES.md")
    await files.create("storefront", "NOTES.md", false)
    expect(textOf(await read("NOTES.md"))).toBe("")
  })

  it("refuses an edit to a file the window no longer shows as moved", async () => {
    const { open, follow, companions } = started()
    const first = await open("package.json")
    const last = (await follow(first.id))()
    await open("index.html")
    const saving = companions.save(
      target,
      first.id,
      "x",
      last.state === "ready" ? last.stamp : "",
      first.at,
    )
    await expect(saving).rejects.toEqual(new PlanUnwritableError("moved"))
  })

  it("saves anything else, as a plan, as the demo does", async () => {
    const { companions } = started()
    await expect(companions.save(target, "plan-1" as ItemId, "x", "1")).rejects.toThrow("No plan")
  })
})
