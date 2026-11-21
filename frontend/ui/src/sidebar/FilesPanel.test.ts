import {
  ChangeUnanswered,
  type FilesExclude,
  type FolderListing,
  type FilesProject,
} from "@novadeck/core/files"
import { nextFrame, render } from "@novadeck/test-kit/render"
import { act, createElement, StrictMode } from "react"
import { afterEach, beforeEach, vi } from "vitest"

import { context, describe, eventually, expect, it } from "../test"
import { folderListings } from "../test/files"
import { atOrBelow, moved, nameOf, parentOf, type EntryChanges } from "./files-edit"
import { checkoutPollMs, type Checkout } from "./FilesCheckout"
import { FilesPanel } from "./FilesPanel"
import { readTimeoutMs } from "./useFolderReader"
import { pulseMs } from "./usePulses"

// jsdom has no layout and no ResizeObserver, which the header's tooltip and the tree's chip
// folding both watch with. The stub lets a test set the tree's width and height and resize it.
// The tree draws only the rows in view, so it is tall enough for every row unless a test says so.
let treeWidth = 0
const tallEnough = 100_000
let treeHeight = tallEnough
const observers = new Set<() => void>()
Object.assign(globalThis, {
  ResizeObserver: class {
    constructor(private readonly callback: () => void) {}
    observe(): void {
      observers.add(this.callback)
    }
    unobserve(): void {}
    disconnect(): void {
      observers.delete(this.callback)
    }
  },
})
Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get(this: HTMLElement) {
    return this.getAttribute("role") === "tree" ? treeWidth : 0
  },
})
Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return this.getAttribute("role") === "tree" ? treeHeight : 0
  },
})
// The panel measures names on a canvas where there is one; jsdom has none and says so loudly.
// A test that wants one sets `measured` to the context it measures with.
let measured: { font: string; measureText: (text: string) => { width: number } } | null = null
HTMLCanvasElement.prototype.getContext = (() => measured) as never
const resizeTree = (width: number, height: number = treeHeight): void => {
  treeWidth = width
  treeHeight = height
  act(() => observers.forEach((callback) => callback()))
}

afterEach(() => {
  vi.useRealTimers()
  treeWidth = 0
  treeHeight = tallEnough
  measured = null
  observers.clear()
  Reflect.deleteProperty(navigator, "clipboard")
})

// The page's clipboard as a test gives it: what it was asked to copy, each copy refused when it
// `refuses`. Without one the page has none, as in jsdom.
const clipboard = (refuses = false): string[] => {
  const copied: string[] = []
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        copied.push(text)
        return refuses ? Promise.reject(new Error("Write permission denied.")) : Promise.resolve()
      },
    },
  })
  return copied
}

// A browser lets go of focus held in what it hides, as the closing menu does; jsdom keeps it
// there, and won't blur what is hidden, so the menu is shown again for the blur. For the tests
// of a context whose menus give focus back.
const blurWhatHides = (): void => {
  const fixup = new MutationObserver(() => {
    const active = document.activeElement
    const hidden = active instanceof HTMLElement ? active.closest<HTMLElement>("[hidden]") : null
    if (!hidden) return
    hidden.hidden = false
    ;(active as HTMLElement).blur()
    hidden.hidden = true
  })
  beforeEach(() =>
    fixup.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    }),
  )
  afterEach(() => fixup.disconnect())
}

// A menu opens, closes and runs what was chosen over animation frames.
const frames = async (): Promise<void> => {
  for (let frame = 0; frame < 6; frame += 1)
    // eslint-disable-next-line no-await-in-loop -- Each frame comes after the one before.
    await nextFrame()
}
const rightClick = async (target: Element): Promise<void> => {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    )
  })
  await frames()
}
const openMenu = (): HTMLElement | null =>
  document.querySelector('[data-scope="menu"][data-part="content"][data-state="open"]')
const menuItems = (): string[] =>
  Array.from(openMenu()?.querySelectorAll('[data-part="item-text"]') ?? []).map(
    (each) => each.textContent ?? "",
  )
const choose = async (label: string): Promise<void> => {
  const item = Array.from(openMenu()!.querySelectorAll<HTMLElement>('[data-part="item"]')).find(
    (each) => each.querySelector('[data-part="item-text"]')?.textContent === label,
  )!
  act(() => item.click())
  await frames()
}

const recent = Date.now() - 1000

const work = (parts: Partial<FilesProject> = {}): FilesProject => ({
  changes: {
    "src/cart/useCart.ts": { kind: "modified", touched: { moth: recent, crow: recent - 5000 } },
    "src/cart/new.ts": { kind: "added", touched: { moth: recent } },
  },
  writing: { moth: "src/cart/useCart.ts" },
  ...parts,
})

const files = ["src/cart/useCart.ts", "src/cart/Cart.tsx", "docs/readme.md", "package.json"]
// Where the project is on the backend's machine.
const directory = "/home/me/shop"

// The backend a test gives the panel: the folders of `files` unless a test says otherwise. Every
// read it gets is recorded, and `answer` can hold one back until the test lets it go.
type Reads = {
  readonly folders: string[]
  readonly list: (folder: string) => Promise<FolderListing>
}

const backend = (
  answer: (folder: string, listing: FolderListing) => Promise<FolderListing> | FolderListing = (
    _,
    listing,
  ) => listing,
  entries: readonly string[] = files,
): Reads => {
  const listings = folderListings(entries)
  const folders: string[] = []
  return {
    folders,
    list: async (folder) => {
      folders.push(folder)
      const listing = listings.get(folder)
      if (!listing && folder !== "") throw new Error("There is no such folder")
      return answer(folder, listing ?? { entries: [], truncated: false })
    },
  }
}

// What hides files from the panel: the person's patterns for every project, and where the backend
// keeps them, the project's own, with Preferences to open at the person's.
type Hiding = {
  readonly exclude: FilesExclude
  readonly project?: {
    readonly read: () => Promise<FilesExclude>
    readonly save: (patterns: FilesExclude) => Promise<void>
  }
  readonly onSettings?: () => void
}

// How the backend changes the project's files, where it does, and what hears that one moved.
type Changing = {
  readonly entries?: EntryChanges | undefined
  readonly onMoved?: ((from: string, to: string) => void) | undefined
}

// A project's own patterns as a backend keeps them, from `initial`: how many reads were asked of
// it, what was saved, and each save refused with `refusal` where it is given. A read answers with
// them as they were when it was asked.
const projectPatterns = (initial: FilesExclude = {}, refusal?: string) => {
  let patterns = initial
  let reads = 0
  let readRefusal: string | undefined
  // What the reads and the saves asked for wait on, open unless a test holds them.
  let reading = Promise.resolve()
  let saving = Promise.resolve()
  const saved: FilesExclude[] = []
  // Holds back what waits on the gate `shut` is given, until the release it returns.
  const hold = (shut: (gate: Promise<void>) => void): (() => Promise<void>) => {
    let open = (): void => {}
    shut(new Promise<void>((resolve) => (open = resolve)))
    return async () => {
      open()
      await settle()
    }
  }
  return {
    saved,
    reads: () => reads,
    // Changes them as another window would.
    set: (next: FilesExclude): void => {
      patterns = next
    },
    // Hold back the reads, or the saves, asked for from now on until the release they return.
    holdReads: () => hold((gate) => (reading = gate)),
    holdSaves: () => hold((gate) => (saving = gate)),
    // Refuses every read from now on, with `why`.
    refuseReads: (why: string): void => {
      readRefusal = why
    },
    source: {
      read: async (): Promise<FilesExclude> => {
        reads += 1
        const asked = patterns
        await reading
        if (readRefusal) throw new Error(readRefusal)
        return asked
      },
      save: async (next: FilesExclude): Promise<void> => {
        await saving
        if (refusal) throw new Error(refusal)
        saved.push(next)
        patterns = next
      },
    },
  }
}

// Lets reads that were asked for come back, and the reads they ask for in turn.
const settle = async (): Promise<void> => {
  for (let round = 0; round < 6; round++)
    // eslint-disable-next-line no-await-in-loop -- One round of reads after another.
    await act(async () => {
      await Promise.resolve()
    })
}

const mount = async (
  project: FilesProject | undefined,
  selectedHandle?: string,
  agents: { roster: string[]; squads: string[][] } = { roster: [], squads: [] },
  reads: Reads = backend(),
  onOpenFile: (path: string) => Promise<void> = () => Promise.resolve(),
  watch?: () => () => void,
  hiding: Hiding = { exclude: {} },
  changing: Changing = {},
  checkout?: Checkout,
) => {
  let visible = true
  let turn = 0
  const props = (next: FilesProject | undefined, handle: string | undefined) => ({
    project: next,
    directory,
    list: reads.list,
    exclude: hiding.exclude,
    projectExclude: hiding.project,
    onExcludeSettings: hiding.onSettings ?? (() => {}),
    entries: changing.entries,
    onMoved: changing.onMoved,
    turn,
    checkout,
    watch,
    onOpenFile,
    selectedHandle: handle,
    roster: agents.roster,
    squads: agents.squads,
    active: true,
    visible,
    onHide: () => {},
  })
  const view = render(createElement(FilesPanel, props(project, selectedHandle)))
  await settle()
  const rows = (): string[] =>
    Array.from(view.container.querySelectorAll(".files-name")).map((el) => el.textContent ?? "")
  const row = (name: string): HTMLElement =>
    Array.from(view.container.querySelectorAll<HTMLElement>(".files-row")).find(
      (el) => el.querySelector(".files-name")?.textContent === name,
    )!
  const click = async (name: string): Promise<void> => {
    act(() => row(name).querySelector<HTMLElement>(".files-row-select")!.click())
    await settle()
  }
  let latest = project
  const redraw = async (): Promise<void> => {
    view.rerender(createElement(FilesPanel, props(latest, selectedHandle)))
    await settle()
  }
  const show = async (next: boolean): Promise<void> => {
    visible = next
    await redraw()
  }
  return {
    view,
    reads,
    rows,
    row,
    click,
    settle,
    update: async (next: FilesProject): Promise<void> => {
      latest = next
      await redraw()
    },
    show,
    // An agent's turn ends in the project.
    endTurn: async (): Promise<void> => {
      turn += 1
      await redraw()
    },
  }
}

describe("The Files panel", () => {
  context("when its changes come from the works", () => {
    it("follows them while it shows, and lets go while it is hidden", async () => {
      const released = vi.fn<() => void>()
      const watch = vi.fn<() => () => void>(() => released)
      const panel = await mount(undefined, undefined, undefined, undefined, undefined, watch)
      expect(watch).toHaveBeenCalledTimes(1)
      expect(released).not.toHaveBeenCalled()

      await panel.show(false)
      expect(released).toHaveBeenCalledTimes(1)

      await panel.show(true)
      expect(watch).toHaveBeenCalledTimes(2)
    })
  })

  context("when it first shows a project", () => {
    it("opens the folders with a changed file and leaves the rest shut", async () => {
      const panel = await mount(work())

      expect(panel.rows()).toEqual([
        "docs",
        "src",
        "cart",
        "Cart.tsx",
        "new.ts",
        "useCart.ts",
        "package.json",
      ])
      expect(panel.row("src").querySelector("[role=treeitem]")?.getAttribute("aria-expanded")).toBe(
        "true",
      )
      expect(
        panel.row("docs").querySelector("[role=treeitem]")?.getAttribute("aria-expanded"),
      ).toBe("false")
      await nextFrame()
      panel.view.unmount()
    })

    it("does not open or close anything when later changes arrive", async () => {
      const panel = await mount(work())
      await panel.update(
        work({
          changes: {
            ...work().changes,
            "docs/readme.md": { kind: "modified", touched: { crow: recent } },
          },
        }),
      )

      expect(panel.rows()).not.toContain("readme.md")
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when the person clicks", () => {
    it("toggles a folder, and the collapse button shuts them all", async () => {
      const panel = await mount(work())
      await panel.click("docs")
      expect(panel.rows()).toContain("readme.md")
      await panel.click("docs")
      expect(panel.rows()).not.toContain("readme.md")

      act(() =>
        panel.view.container.querySelector<HTMLElement>("[aria-label='Collapse folders']")!.click(),
      )

      expect(panel.rows()).toEqual(["docs", "src", "package.json"])
      await nextFrame()
      panel.view.unmount()
    })

    it("selects a file", async () => {
      const panel = await mount(work())
      await panel.click("package.json")

      expect(panel.row("package.json").getAttribute("data-selected")).toBe("true")
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when agents have worked on files", () => {
    it("shows how each changed and who did it", async () => {
      const panel = await mount(work())

      expect(panel.row("useCart.ts").getAttribute("data-kind")).toBe("modified")
      expect(panel.row("new.ts").getAttribute("data-kind")).toBe("added")
      expect(panel.row("useCart.ts").textContent).toContain("@moth")
      expect(panel.row("useCart.ts").textContent).toContain("@crow")
      await nextFrame()
      panel.view.unmount()
    })

    it("draws a cursor for a file being written and a trail for the other changed ones", async () => {
      const panel = await mount(work())

      expect(panel.row("useCart.ts").querySelectorAll(".files-cursor")).toHaveLength(1)
      expect(panel.row("useCart.ts").querySelector(".files-trail")).toBeNull()
      expect(panel.row("new.ts").querySelector(".files-trail")).not.toBeNull()
      await nextFrame()
      panel.view.unmount()
    })

    it("draws no cursor for a file hidden in a closed folder, and names the agents on the folder", async () => {
      const panel = await mount(work())
      await panel.click("src")

      expect(panel.view.container.querySelector(".files-cursor")).toBeNull()
      expect(panel.row("src").querySelector(".files-chips")?.textContent).toContain("@moth")
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when an agent is lit", () => {
    it("dims the rows it did not touch", async () => {
      const panel = await mount(
        work({
          changes: {
            ...work().changes,
            "docs/readme.md": { kind: "modified", touched: { crow: recent } },
          },
        }),
        "crow",
      )

      expect(panel.row("readme.md").getAttribute("data-dim")).toBe("false")
      expect(panel.row("new.ts").getAttribute("data-dim")).toBe("true")
      expect(panel.row("package.json").getAttribute("data-dim")).toBe("true")
      await nextFrame()
      panel.view.unmount()
    })

    it("dims nothing when the selected agent has no work here", async () => {
      const panel = await mount(work(), "wren")

      expect(panel.row("package.json").getAttribute("data-dim")).toBe("false")
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when agents have work here", () => {
    // moth leads crow; wren works alone. Everyone changed a file of their own.
    const team = (): FilesProject =>
      work({
        changes: {
          ...work().changes,
          "docs/readme.md": { kind: "modified", touched: { crow: recent } },
          "package.json": { kind: "modified", touched: { wren: recent } },
        },
      })
    const agents = { roster: ["wren", "moth", "crow"], squads: [["moth", "crow"]] }
    const mountTeam = (selected?: string) => mount(team(), selected, agents)
    const chip = (panel: Awaited<ReturnType<typeof mount>>, handle: string): HTMLElement =>
      Array.from(
        panel.view.container.querySelectorAll<HTMLElement>(".files-strip .files-agent"),
      ).find((el) => el.textContent === `@${handle}`)!
    const press = (panel: Awaited<ReturnType<typeof mount>>, handle: string): void =>
      act(() => chip(panel, handle).click())
    const pressed = (panel: Awaited<ReturnType<typeof mount>>): string[] =>
      Array.from(panel.view.container.querySelectorAll(".files-agent[aria-pressed=true]")).map(
        (el) => el.textContent ?? "",
      )
    const dimmed = (panel: Awaited<ReturnType<typeof mount>>): string[] =>
      Array.from(
        panel.view.container.querySelectorAll(".files-row[data-dim=true][data-folder=false]"),
      ).map((el) => el.querySelector(".files-name")?.textContent ?? "")
    const fileRows = (panel: Awaited<ReturnType<typeof mount>>): string[] =>
      Array.from(panel.view.container.querySelectorAll(".files-row[data-folder=false]")).map(
        (el) => el.querySelector(".files-name")?.textContent ?? "",
      )
    const everyFile = ["readme.md", "Cart.tsx", "new.ts", "useCart.ts", "package.json"]
    const hover = (el: Element, type: "pointerover" | "pointerout"): void =>
      act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true })))

    it("shows a chip for each, a squad in a labelled track with its lead first", async () => {
      const panel = await mountTeam()

      const strip = panel.view.container.querySelector(`[aria-label="Show agents' work"]`)!
      expect(strip.getAttribute("role")).toBe("group")
      expect(
        Array.from(strip.querySelectorAll(".files-agent")).map((el) => el.textContent),
      ).toEqual(["@wren", "@moth", "@crow"])
      const squad = strip.querySelector('[aria-label="@moth\'s squad"]')!
      expect(Array.from(squad.querySelectorAll("button")).map((el) => el.textContent)).toEqual([
        "@moth",
        "@crow",
      ])
      await nextFrame()
      panel.view.unmount()
    })

    it("has no strip while nobody has worked here", async () => {
      const panel = await mount(work({ changes: {}, writing: {} }), undefined, agents)

      expect(panel.view.container.querySelector(".files-strip")).toBeNull()
      await nextFrame()
      panel.view.unmount()
    })

    it("shows only the work of the agents kept, and releases one on a second click", async () => {
      const panel = await mountTeam()
      const folders = (): string[] =>
        Array.from(panel.view.container.querySelectorAll(".files-row[data-folder=true]")).map(
          (el) => el.querySelector(".files-name")?.textContent ?? "",
        )
      expect(fileRows(panel)).toEqual(everyFile)

      press(panel, "wren")
      expect(fileRows(panel)).toEqual(["package.json"])
      expect(folders()).toEqual([])
      press(panel, "crow")

      expect(pressed(panel)).toEqual(["@wren", "@crow"])
      expect(fileRows(panel)).toEqual(["readme.md", "useCart.ts", "package.json"])
      expect(folders()).toEqual(["docs", "src", "cart"])
      expect(dimmed(panel)).toEqual([])
      expect(
        panel.view.container.querySelector("[role=tree]")?.getAttribute("aria-description"),
      ).toBe("Only the work of @wren and @crow is shown.")
      press(panel, "wren")
      expect(pressed(panel)).toEqual(["@crow"])
      expect(fileRows(panel)).toEqual(["readme.md", "useCart.ts"])
      press(panel, "crow")
      expect(fileRows(panel)).toEqual(everyFile)
      await nextFrame()
      panel.view.unmount()
    })

    it("keeps or releases the whole squad from its lead, and one member from the member", async () => {
      const panel = await mountTeam()

      // Nothing marks a lead, so its hint names the squad.
      expect(chip(panel, "moth").getAttribute("title")).toBe("Show only @moth's squad's work")
      expect(chip(panel, "crow").getAttribute("title")).toBe("Show only @crow's work")
      press(panel, "moth")
      expect(chip(panel, "moth").getAttribute("title")).toBe("Let @moth's squad go")
      expect(chip(panel, "wren").getAttribute("title")).toBe("Show @wren's work too")
      expect(pressed(panel)).toEqual(["@moth", "@crow"])
      expect(panel.view.container.querySelector(".files-squad")?.getAttribute("data-kept")).toBe(
        "true",
      )
      press(panel, "crow")
      expect(pressed(panel)).toEqual([])
      expect(chip(panel, "moth").getAttribute("aria-pressed")).toBe("mixed")
      // Not every member is kept, so the lead keeps them all rather than releasing.
      press(panel, "moth")
      expect(pressed(panel)).toEqual(["@moth", "@crow"])
      press(panel, "moth")
      expect(pressed(panel)).toEqual([])
      await nextFrame()
      panel.view.unmount()
    })

    it("follows the selected terminal's agent until something is kept, and again after Escape", async () => {
      const panel = await mountTeam("wren")

      expect(chip(panel, "wren").getAttribute("data-following")).toBe("true")
      expect(dimmed(panel)).toEqual(["readme.md", "Cart.tsx", "new.ts", "useCart.ts"])
      press(panel, "crow")
      expect(chip(panel, "wren").getAttribute("data-following")).toBe("false")
      expect(fileRows(panel)).toEqual(["readme.md", "useCart.ts"])
      expect(dimmed(panel)).toEqual([])

      act(() => {
        chip(panel, "crow").dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        )
      })

      expect(pressed(panel)).toEqual([])
      expect(fileRows(panel)).toEqual(everyFile)
      expect(dimmed(panel)).toEqual(["readme.md", "Cart.tsx", "new.ts", "useCart.ts"])
      await nextFrame()
      panel.view.unmount()
    })

    it("leaves Escape to others while nothing is kept", async () => {
      const panel = await mountTeam()
      const seen: boolean[] = []
      const listen = (event: Event): void => void seen.push(event.defaultPrevented)
      document.body.addEventListener("keydown", listen)

      act(() => {
        chip(panel, "wren").dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        )
      })
      press(panel, "wren")
      act(() => {
        chip(panel, "wren").dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        )
      })

      // The first Escape propagated to the body, the second (which let go) did not.
      expect(seen).toHaveLength(1)
      document.body.removeEventListener("keydown", listen)
      await nextFrame()
      panel.view.unmount()
    })

    it("marks a lead pressed for its squad: true when all are kept, mixed when some are", async () => {
      const panel = await mountTeam()
      const state = (handle: string): string | null =>
        chip(panel, handle).getAttribute("aria-pressed")
      expect(state("moth")).toBe("false")

      press(panel, "crow")
      expect(state("moth")).toBe("mixed")
      expect(state("crow")).toBe("true")
      press(panel, "moth")
      expect(state("moth")).toBe("true")
      press(panel, "crow")
      expect(state("moth")).toBe("mixed")
      press(panel, "moth")
      press(panel, "moth")
      expect(state("moth")).toBe("false")
      await nextFrame()
      panel.view.unmount()
    })

    it("lets go of a kept agent that leaves the project, so every file shows again", async () => {
      const panel = await mountTeam()
      press(panel, "wren")
      expect(fileRows(panel)).toEqual(["package.json"])

      await panel.update(work())

      expect(pressed(panel)).toEqual([])
      expect(fileRows(panel)).toEqual([
        "readme.md",
        "Cart.tsx",
        "new.ts",
        "useCart.ts",
        "package.json",
      ])
      expect(dimmed(panel)).toEqual([])
      await nextFrame()
      panel.view.unmount()
    })

    it("forgets a hover on a chip that leaves the strip", async () => {
      const panel = await mountTeam()
      hover(chip(panel, "wren"), "pointerover")
      expect(dimmed(panel)).not.toEqual([])

      await panel.update(work())

      expect(dimmed(panel)).toEqual([])
      await nextFrame()
      panel.view.unmount()
    })

    it("clears what is kept on Escape in the tree too", async () => {
      const panel = await mountTeam()
      press(panel, "wren")

      act(() => {
        panel
          .row("package.json")
          .querySelector("[role=treeitem]")!
          .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      })

      expect(pressed(panel)).toEqual([])
      await nextFrame()
      panel.view.unmount()
    })

    it("lights an agent while its chip is pointed at, its whole squad for a lead, without reordering", async () => {
      const panel = await mountTeam()
      const order = (): string[] =>
        Array.from(panel.row("useCart.ts").querySelectorAll(".files-chip")).map(
          (el) => el.textContent ?? "",
        )
      const before = order()

      hover(chip(panel, "wren"), "pointerover")
      expect(dimmed(panel)).toEqual(["readme.md", "Cart.tsx", "new.ts", "useCart.ts"])
      hover(chip(panel, "wren"), "pointerout")
      // A member alone would rank its chip first on a row if hover fed the ranking.
      hover(chip(panel, "crow"), "pointerover")
      expect(dimmed(panel)).toEqual(["Cart.tsx", "new.ts", "package.json"])
      expect(order()).toEqual(before)
      hover(chip(panel, "crow"), "pointerout")
      hover(chip(panel, "moth"), "pointerover")
      expect(dimmed(panel)).toEqual(["Cart.tsx", "package.json"])
      expect(order()).toEqual(before)
      hover(chip(panel, "moth"), "pointerout")

      expect(dimmed(panel)).toEqual([])
      await nextFrame()
      panel.view.unmount()
    })

    it("still reads again the open folders that the kept agents' work leaves out", async () => {
      const reads = backend()
      const panel = await mount(team(), undefined, agents, reads)
      press(panel, "wren")
      expect(panel.rows()).toEqual(["package.json"])
      reads.folders.length = 0

      await panel.endTurn()

      expect(reads.folders.toSorted()).toEqual(["", "docs", "src", "src/cart"])
      await nextFrame()
      panel.view.unmount()
    })

    it("steps the keyboard over the rows the kept agents' work leaves out", async () => {
      const panel = await mountTeam()
      press(panel, "crow")
      const focused = (): string | null | undefined =>
        document.activeElement?.querySelector(".files-name")?.textContent
      const key = (name: string): void =>
        act(() => {
          document.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", { key: name, bubbles: true }),
          )
        })
      act(() => panel.row("readme.md").querySelector<HTMLElement>("[role=treeitem]")!.focus())

      key("ArrowDown")
      expect(focused()).toBe("src")
      key("End")
      expect(focused()).toBe("useCart.ts")
      key("ArrowUp")
      expect(focused()).toBe("cart")
      await nextFrame()
      panel.view.unmount()
    })

    it("dims, among the kept agents' work, what a chip pointed at did not touch", async () => {
      const panel = await mountTeam()
      press(panel, "wren")
      press(panel, "crow")

      hover(chip(panel, "wren"), "pointerover")
      expect(fileRows(panel)).toEqual(["readme.md", "useCart.ts", "package.json"])
      expect(dimmed(panel)).toEqual(["readme.md", "useCart.ts"])
      expect(
        panel.view.container.querySelector("[role=tree]")?.getAttribute("aria-description"),
      ).toBe(
        "Only the work of @wren and @crow is shown. Of that, the work of @wren is lit; the rest is dimmed.",
      )
      hover(chip(panel, "wren"), "pointerout")

      expect(dimmed(panel)).toEqual([])
      await nextFrame()
      panel.view.unmount()
    })

    it("puts the kept agents first on a row's chips", async () => {
      const panel = await mountTeam()
      const shown = (): string[] =>
        Array.from(panel.row("useCart.ts").querySelectorAll(".files-chip")).map(
          (el) => el.textContent ?? "",
        )
      expect(shown()).toEqual(["@moth", "@crow"])

      press(panel, "crow")

      expect(shown()).toEqual(["@crow", "@moth"])
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when an agent writes again", () => {
    it("pulses the file's row, or the closed folder hiding it, but not on first mount", async () => {
      const panel = await mount(work())
      expect(panel.view.container.querySelector("[data-pulse]")).toBeNull()

      await panel.update(
        work({
          changes: {
            ...work().changes,
            "src/cart/new.ts": { kind: "added", touched: { moth: recent + 500 } },
          },
        }),
      )
      expect(panel.row("new.ts").getAttribute("data-pulse")).toBe("a")

      await panel.click("src")
      await panel.update(
        work({
          changes: {
            ...work().changes,
            "src/cart/new.ts": { kind: "added", touched: { moth: recent + 900 } },
          },
        }),
      )
      expect(panel.row("src").getAttribute("data-pulse")).toBe("a")
      await nextFrame()
      panel.view.unmount()
    })

    it("pulses nothing for a file the patterns hide, not even the closed folder above it", async () => {
      const panel = await mount(work(), undefined, undefined, undefined, undefined, undefined, {
        exclude: { "**/new.ts": true },
      })
      const written = (at: number) =>
        work({
          changes: {
            ...work().changes,
            "src/cart/new.ts": { kind: "added", touched: { moth: at } },
          },
        })

      await panel.update(written(recent + 500))
      expect(panel.view.container.querySelector("[data-pulse]")).toBeNull()
      await panel.click("src")
      await panel.update(written(recent + 900))

      expect(panel.view.container.querySelector("[data-pulse]")).toBeNull()
      await nextFrame()
      panel.view.unmount()
    })
  })
  context("when a write lands while the panel is hidden", () => {
    const written = (at: number) =>
      work({
        changes: {
          ...work().changes,
          "src/cart/new.ts": { kind: "added", touched: { moth: at } },
        },
      })

    it("does not pulse it, now or when the panel comes back", async () => {
      const panel = await mount(work())
      await panel.show(false)
      await panel.update(written(recent + 500))
      await panel.show(true)

      expect(panel.view.container.querySelector("[data-pulse]")).toBeNull()
      await nextFrame()
      panel.view.unmount()
    })

    it("starts the trails over when the panel is shown again", async () => {
      const panel = await mount(work())
      const before = panel.row("new.ts").querySelector(".files-trail")
      await panel.show(false)
      await panel.show(true)

      expect(panel.row("new.ts").querySelector(".files-trail")).not.toBe(before)
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when a pulse has played", () => {
    it("forgets it on a timer, with no animation to end", async () => {
      vi.useFakeTimers()
      const panel = await mount(work())
      await panel.update(
        work({
          changes: {
            ...work().changes,
            "src/cart/new.ts": { kind: "added", touched: { moth: recent + 500 } },
          },
        }),
      )
      expect(panel.row("new.ts").getAttribute("data-pulse")).toBe("a")

      act(() => vi.advanceTimersByTime(pulseMs + 1))

      expect(panel.view.container.querySelector("[data-pulse]")).toBeNull()
      panel.view.unmount()
    })
  })

  context("when the pointer is over a chip", () => {
    it("lights the agent without reordering the chips", async () => {
      const panel = await mount(
        work({
          changes: {
            "src/cart/useCart.ts": {
              kind: "modified",
              touched: { moth: recent, crow: recent - 5000, wren: recent - 9000 },
            },
          },
        }),
      )
      const names = (): string[] =>
        Array.from(panel.row("useCart.ts").querySelectorAll(".files-chip")).map(
          (chip) => chip.textContent ?? "",
        )
      const before = names()
      const second = panel.row("useCart.ts").querySelectorAll(".files-chip")[1]!
      act(() => void second.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })))

      expect(panel.view.container.querySelector("[data-lit]")?.getAttribute("data-lit")).toBe(
        "crow",
      )
      expect(names()).toEqual(before)
      await nextFrame()
      panel.view.unmount()
    })

    it("stops lighting the agent once a write folds its chip away from the pointer", async () => {
      const panel = await mount(
        work({
          changes: {
            "src/cart/useCart.ts": {
              kind: "modified",
              touched: { moth: recent, crow: recent - 5000 },
            },
          },
        }),
      )
      const second = panel.row("useCart.ts").querySelectorAll(".files-chip")[1]!
      act(() => void second.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })))
      expect(panel.view.container.querySelector("[data-lit]")?.getAttribute("data-lit")).toBe(
        "crow",
      )
      await panel.update(
        work({
          changes: {
            "src/cart/useCart.ts": {
              kind: "modified",
              touched: { moth: recent, crow: recent - 5000, wren: recent + 1000 },
            },
          },
        }),
      )

      expect(panel.view.container.querySelector("[role=tree]")?.hasAttribute("data-lit")).toBe(
        false,
      )
      await nextFrame()
      panel.view.unmount()
    })

    it("leaves the chips out of the tab order and names everyone on the row", async () => {
      const panel = await mount(
        work({
          changes: {
            "src/cart/useCart.ts": {
              kind: "modified",
              touched: { moth: recent, crow: recent - 5000, wren: recent - 9000 },
            },
          },
        }),
      )
      const row = panel.row("useCart.ts")

      expect(row.querySelector(".files-chip[tabindex]")).toBeNull()
      expect(row.querySelector("[role=treeitem]")?.getAttribute("aria-label")).toBe(
        "useCart.ts, modified, @moth @crow @wren",
      )
      expect(row.querySelector(".files-chips")?.getAttribute("aria-hidden")).toBe("true")
      expect(row.querySelector(".files-more")?.getAttribute("title")).toContain("@wren")
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when a folder is empty", () => {
    it("opens onto a note saying so, and is read again with the rest", async () => {
      let entries = [...files, "dist/"]
      const reads: Reads = {
        folders: [],
        list: (folder) => backend(undefined, entries).list(folder),
      }
      const panel = await mount(work(), undefined, undefined, reads)
      await panel.click("dist")

      expect(
        panel.row("dist").querySelector("[role=treeitem]")!.getAttribute("aria-expanded"),
      ).toBe("true")
      expect(panel.view.container.querySelector("[data-note=empty]")?.textContent).toBe("Empty")

      entries = [...files, "dist/a.js"]
      await panel.endTurn()

      expect(panel.rows()).toContain("a.js")
      expect(panel.view.container.querySelector("[data-note=empty]")).toBeNull()
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when the project's root is read", () => {
    it("says plainly that it can't be, in place of the tree", async () => {
      const reads = backend((folder, listing) => {
        if (folder === "") throw new Error("gone")
        return listing
      })
      const panel = await mount(undefined, undefined, undefined, reads)

      expect(panel.view.container.textContent).toContain("Can't read this project's files.")
      expect(panel.view.container.querySelector("[role=tree]")).toBeNull()
      await nextFrame()
      panel.view.unmount()
    })

    it("says plainly that it is empty", async () => {
      const panel = await mount(undefined, undefined, undefined, backend(undefined, []))

      expect(panel.view.container.textContent).toContain("This project's folder is empty.")
      await nextFrame()
      panel.view.unmount()
    })

    it("says it is empty though agents are said to have changed files in it", async () => {
      const panel = await mount(work(), undefined, undefined, backend(undefined, []))

      expect(panel.view.container.textContent).toContain("This project's folder is empty.")
      expect(panel.view.container.querySelector("[role=tree]")).toBeNull()
      await nextFrame()
      panel.view.unmount()
    })

    it("lists nothing until it is read, and reads nothing while the panel is hidden", async () => {
      const reads = backend()
      const view = render(
        createElement(FilesPanel, {
          project: undefined,
          directory,
          list: reads.list,
          exclude: {},
          onExcludeSettings: () => {},
          turn: 0,
          onOpenFile: () => Promise.resolve(),
          selectedHandle: undefined,
          roster: [],
          squads: [],
          active: false,
          visible: true,
          onHide: () => {},
        }),
      )
      await settle()

      expect(reads.folders).toEqual([])
      expect(view.container.querySelector("[role=tree]")).toBeNull()
      view.unmount()
    })

    it("ends a root that lists only part with a muted note", async () => {
      const reads = backend((folder, listing) =>
        folder === "" ? { ...listing, truncated: true } : listing,
      )
      const panel = await mount(undefined, undefined, undefined, reads)

      expect(panel.view.container.querySelector("[data-note=truncated]")?.textContent).toBe(
        "More not shown",
      )
      await nextFrame()
      panel.view.unmount()
    })

    it("shows a note beside a file named like it without a clash", async () => {
      const reads = backend(
        (folder, listing) => (folder === "" ? { ...listing, truncated: true } : listing),
        ["truncated", "failed"],
      )
      const panel = await mount(undefined, undefined, undefined, reads)

      expect(panel.rows()).toEqual(["failed", "truncated"])
      expect(panel.view.container.querySelectorAll("[data-note]")).toHaveLength(1)
      await nextFrame()
      panel.view.unmount()
    })

    it("shows the plain tree where the backend tells of no changes, with nothing open", async () => {
      const panel = await mount(undefined)

      expect(panel.rows()).toEqual(["docs", "src", "package.json"])
      expect(panel.view.container.querySelector(".files-strip")).toBeNull()
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when a folder is read", () => {
    it("reads it as it opens, and shows what it lists", async () => {
      const reads = backend()
      const panel = await mount(undefined, undefined, undefined, reads)
      expect(reads.folders).toEqual([""])

      await panel.click("docs")

      expect(reads.folders).toEqual(["", "docs"])
      expect(panel.rows()).toContain("readme.md")
      await nextFrame()
      panel.view.unmount()
    })

    it("shows a muted row in a folder that can't be read, and reads it again on reopening", async () => {
      let broken = true
      const reads = backend((folder, listing) => {
        if (folder === "docs" && broken) throw new Error("denied")
        return listing
      })
      const panel = await mount(undefined, undefined, undefined, reads)
      await panel.click("docs")

      const note = panel.view.container.querySelector("[data-note=failed]")
      expect(note?.textContent).toBe("Can't read this folder")
      expect(panel.rows()).not.toContain("readme.md")

      broken = false
      await panel.click("docs")
      await panel.click("docs")

      expect(panel.view.container.querySelector("[data-note=failed]")).toBeNull()
      expect(panel.rows()).toContain("readme.md")
      await nextFrame()
      panel.view.unmount()
    })

    it("says what a folder that lists only part lacks", async () => {
      const reads = backend((folder, listing) =>
        folder === "docs" ? { ...listing, truncated: true } : listing,
      )
      const panel = await mount(undefined, undefined, undefined, reads)
      await panel.click("docs")

      expect(panel.view.container.querySelector("[data-note=truncated]")?.textContent).toBe(
        "More not shown",
      )
      expect(panel.rows()).toContain("readme.md")
      await nextFrame()
      panel.view.unmount()
    })

    it("reads the folders opened for the changes in them", async () => {
      const reads = backend()
      await mount(work(), undefined, undefined, reads)

      expect(reads.folders.toSorted()).toEqual(["", "src", "src/cart"])
    })

    it("lists a file an agent added that its folder's listing lacks", async () => {
      const panel = await mount(work())

      expect(panel.rows()).toContain("new.ts")
    })
  })

  context("when the folders are read again", () => {
    it("does so when the panel is shown again, for the root and the open folders only", async () => {
      const reads = backend()
      const panel = await mount(undefined, undefined, undefined, reads)
      await panel.click("docs")
      reads.folders.length = 0

      await panel.show(false)
      expect(reads.folders).toEqual([])
      await panel.show(true)

      expect(reads.folders.toSorted()).toEqual(["", "docs"])
      await nextFrame()
      panel.view.unmount()
    })

    it("does so for the folders left open inside one opened again", async () => {
      let entries = files
      const reads: Reads = {
        folders: [],
        list: (folder) => backend(undefined, entries).list(folder),
      }
      const panel = await mount(undefined, undefined, undefined, reads)
      await panel.click("src")
      await panel.click("cart")
      await panel.click("src")

      entries = [...files, "src/cart/total.ts"]
      await panel.click("src")

      expect(panel.rows()).toContain("total.ts")
      await nextFrame()
      panel.view.unmount()
    })

    it("does so when an agent's turn ends, and not when it ends while the panel is hidden", async () => {
      const reads = backend()
      const panel = await mount(undefined, undefined, undefined, reads)
      reads.folders.length = 0

      await panel.endTurn()
      expect(reads.folders).toEqual([""])
      await panel.show(false)
      reads.folders.length = 0
      await panel.endTurn()
      expect(reads.folders).toEqual([])
      await panel.show(true)

      expect(reads.folders).toEqual([""])
      await nextFrame()
      panel.view.unmount()
    })

    it("shows a file that appeared, and drops the folder that vanished with its listing", async () => {
      let entries = files
      const reads: Reads = {
        folders: [],
        list: (folder) => backend(undefined, entries).list(folder),
      }
      const panel = await mount(undefined, undefined, undefined, reads)
      await panel.click("docs")
      expect(panel.rows()).toContain("readme.md")

      entries = [...files, "docs/new.md"]
      await panel.endTurn()
      expect(panel.rows()).toContain("new.md")

      entries = ["package.json"]
      await panel.endTurn()
      expect(panel.rows()).toEqual(["package.json"])

      entries = files
      await panel.endTurn()
      expect(panel.rows()).toContain("readme.md")
      await nextFrame()
      panel.view.unmount()
    })

    it("reads a folder once more, not at once again, when asked while a read is out", async () => {
      const slow: ((listing: FolderListing) => void)[] = []
      let reading = 0
      const reads = backend((folder, listing) => {
        if (folder !== "docs") return listing
        reading += 1
        if (reading > 1)
          return { ...listing, entries: [{ name: "newer.md", folder: false, ignored: false }] }
        return new Promise<FolderListing>((resolve) => slow.push(resolve))
      })
      const panel = await mount(undefined, undefined, undefined, reads)
      await panel.click("docs")
      await panel.endTurn()
      await panel.endTurn()
      await panel.endTurn()
      expect(reads.folders.filter((folder) => folder === "docs")).toHaveLength(1)

      await act(async () => {
        slow[0]!({
          entries: [{ name: "older.md", folder: false, ignored: false }],
          truncated: false,
        })
      })
      await panel.settle()

      expect(reads.folders.filter((folder) => folder === "docs")).toHaveLength(2)
      expect(panel.rows()).toContain("newer.md")
      expect(panel.rows()).not.toContain("older.md")
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when the person opens a file", () => {
    const keyOn = (panel: Awaited<ReturnType<typeof mount>>, name: string, key: string): void =>
      act(() => {
        const button = panel.row(name).querySelector<HTMLElement>("[role=treeitem]")!
        button.focus()
        button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
      })

    it("opens it on a click, and once on a double click's two", async () => {
      const opened: string[] = []
      const panel = await mount(undefined, undefined, undefined, backend(), (path) => {
        opened.push(path)
        return Promise.resolve()
      })
      await panel.click("package.json")
      expect(opened).toEqual(["package.json"])
      expect(panel.row("package.json").getAttribute("data-selected")).toBe("true")

      // A double click's second click comes with a count of two.
      act(() =>
        panel
          .row("package.json")
          .querySelector<HTMLElement>("[role=treeitem]")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 })),
      )

      expect(opened).toEqual(["package.json"])
      await nextFrame()
      panel.view.unmount()
    })

    it("opens it on Enter, by its path from the root, and a folder on Enter only toggles", async () => {
      const opened: string[] = []
      const panel = await mount(undefined, undefined, undefined, backend(), (path) => {
        opened.push(path)
        return Promise.resolve()
      })
      await panel.click("docs")

      keyOn(panel, "readme.md", "Enter")
      keyOn(panel, "docs", "Enter")
      await panel.settle()

      expect(opened).toEqual(["docs/readme.md"])
      await nextFrame()
      panel.view.unmount()
    })

    it("opens it once however long Enter is held", async () => {
      const opened: string[] = []
      const panel = await mount(undefined, undefined, undefined, backend(), (path) => {
        opened.push(path)
        return Promise.resolve()
      })
      await panel.click("docs")
      const button = panel.row("readme.md").querySelector<HTMLElement>("[role=treeitem]")!

      act(() => {
        button.focus()
        for (const repeat of [false, true, true])
          button.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", repeat, bubbles: true, cancelable: true }),
          )
      })

      expect(opened).toEqual(["docs/readme.md"])
      await nextFrame()
      panel.view.unmount()
    })

    it("reads its folder again when it can't be opened", async () => {
      const reads = backend()
      const panel = await mount(undefined, undefined, undefined, reads, () =>
        Promise.reject(new Error("gone")),
      )
      await panel.click("docs")
      reads.folders.length = 0

      keyOn(panel, "readme.md", "Enter")
      await panel.settle()

      expect(reads.folders).toEqual(["docs"])
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when the person asks for a row's menu", () => {
    blurWhatHides()
    const select = (panel: Awaited<ReturnType<typeof mount>>, name: string): HTMLElement =>
      panel.row(name).querySelector<HTMLElement>("[role=treeitem]")!

    it("focuses the row, which keeps the tree's tab stop and has focus back once the menu closes", async () => {
      const panel = await mount(work())
      await rightClick(select(panel, "package.json"))

      expect(menuItems()).toEqual(["Copy Path", "Copy Relative Path"])
      expect(panel.view.container.querySelector("[role=treeitem][tabindex='0']")?.textContent).toBe(
        "package.json",
      )
      act(() => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        )
      })
      await frames()

      expect(openMenu()).toBeNull()
      expect(document.activeElement).toBe(select(panel, "package.json"))
      panel.view.unmount()
    })

    it("copies its path on the backend's machine, or from the project's root, and says nothing", async () => {
      const copied = clipboard()
      const panel = await mount(work())

      await rightClick(select(panel, "useCart.ts"))
      await choose("Copy Path")
      await rightClick(select(panel, "useCart.ts"))
      await choose("Copy Relative Path")
      await panel.settle()

      expect(copied).toEqual(["/home/me/shop/src/cart/useCart.ts", "src/cart/useCart.ts"])
      expect(panel.view.container.querySelector("[role=alert]")).toBeNull()
      panel.view.unmount()
    })

    it("is the row's from its chips too", async () => {
      const copied = clipboard()
      const panel = await mount(work())

      await rightClick(panel.row("useCart.ts").querySelector(".files-chip")!)
      await choose("Copy Relative Path")

      expect(copied).toEqual(["src/cart/useCart.ts"])
      panel.view.unmount()
    })

    it("is aimed at the row a long press began on, which opens it with no right-click", async () => {
      const copied = clipboard()
      const panel = await mount(work())
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })

      act(() => {
        select(panel, "package.json").dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerType: "touch",
            bubbles: true,
            clientX: 10,
            clientY: 10,
          }),
        )
      })
      await act(() => vi.advanceTimersByTimeAsync(1000))
      vi.useRealTimers()
      await frames()
      await choose("Copy Relative Path")

      expect(copied).toEqual(["package.json"])
      panel.view.unmount()
    })
  })

  context("when the person asks for the menu of the tree's empty space", () => {
    it("copies the project's folder itself, and refreshes", async () => {
      const copied = clipboard()
      const reads = backend()
      const panel = await mount(undefined, undefined, undefined, reads)
      await panel.click("docs")
      const tree = panel.view.container.querySelector("[role=tree]")!

      await rightClick(tree)
      expect(menuItems()).toEqual(["Copy Path", "Refresh"])
      await choose("Copy Path")
      reads.folders.length = 0
      await rightClick(tree)
      await choose("Refresh")
      await panel.settle()

      expect(copied).toEqual(["/home/me/shop"])
      expect(reads.folders.toSorted()).toEqual(["", "docs"])
      panel.view.unmount()
    })

    it("is what a note's right-click opens, as a note has no menu of its own", async () => {
      const panel = await mount(
        undefined,
        undefined,
        undefined,
        backend(undefined, [...files, "dist/"]),
      )
      await panel.click("dist")

      await rightClick(panel.view.container.querySelector(".files-note")!)

      expect(menuItems()).toEqual(["Copy Path", "Refresh"])
      panel.view.unmount()
    })

    it("is on the line that says the project's folder is empty, which still copies the folder", async () => {
      const copied = clipboard()
      const panel = await mount(undefined, undefined, undefined, backend(undefined, []))

      await rightClick(panel.view.container.querySelector(".files-empty")!)
      expect(menuItems()).toEqual(["Copy Path", "Refresh"])
      await choose("Copy Path")
      await panel.settle()

      expect(copied).toEqual(["/home/me/shop"])
      panel.view.unmount()
    })

    it("is on the line that says the files can't be read, whose Refresh reads them again", async () => {
      clipboard()
      let unreadable = false
      const reads = backend((folder, listing) => {
        if (folder === "" && unreadable) throw new Error("gone")
        return listing
      })
      const panel = await mount(undefined, undefined, undefined, reads)
      await rightClick(panel.row("package.json"))
      await choose("Copy Path")
      unreadable = true
      act(() =>
        panel.view.container.querySelector<HTMLElement>("button[aria-label=Refresh]")!.click(),
      )
      await panel.settle()
      const line = Array.from(panel.view.container.querySelectorAll(".files-empty")).find(
        (each) => each.textContent === "Can't read this project's files.",
      )!

      // The menu asked last was a row's, which the line doesn't keep.
      await rightClick(line)
      expect(menuItems()).toEqual(["Copy Path", "Refresh"])
      unreadable = false
      await choose("Refresh")
      await panel.settle()

      expect(panel.rows()).toContain("package.json")
      panel.view.unmount()
    })
  })

  context("when a copy fails", () => {
    const alert = (panel: Awaited<ReturnType<typeof mount>>): Element | null =>
      panel.view.container.querySelector("[role=alert]")

    it("says so above the tree when the clipboard refuses, until dismissed", async () => {
      clipboard(true)
      const panel = await mount(undefined)

      await rightClick(panel.row("package.json"))
      await choose("Copy Path")
      await panel.settle()

      expect(alert(panel)?.textContent).toBe(
        "Couldn't copy /home/me/shop/package.json to the clipboard.",
      )
      act(() => alert(panel)!.querySelector<HTMLElement>("button[aria-label=Dismiss]")!.click())
      expect(alert(panel)).toBeNull()
      panel.view.unmount()
    })

    it("says so where the page has no clipboard, and forgets it once the panel hides", async () => {
      const panel = await mount(undefined)

      await rightClick(panel.row("package.json"))
      await choose("Copy Relative Path")
      expect(alert(panel)?.textContent).toBe("Couldn't copy package.json to the clipboard.")

      await panel.show(false)
      expect(alert(panel)).toBeNull()
      await panel.show(true)
      expect(alert(panel)).toBeNull()
      panel.view.unmount()
    })

    it("says nothing of a copy that fails once the panel is hidden, there or when it shows again", async () => {
      let refuse = (): void => {}
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            new Promise<void>((_, reject) => {
              refuse = () => reject(new Error("Write permission denied."))
            }),
        },
      })
      const panel = await mount(undefined)
      await rightClick(panel.row("package.json"))
      await choose("Copy Path")

      await panel.show(false)
      await act(async () => refuse())
      await panel.settle()
      expect(alert(panel)).toBeNull()
      await panel.show(true)

      expect(alert(panel)).toBeNull()
      panel.view.unmount()
    })

    it("says nothing of a copy chosen from a menu left open as the panel hid", async () => {
      clipboard(true)
      const panel = await mount(undefined)
      await rightClick(panel.row("package.json"))

      await panel.show(false)
      await choose("Copy Path")
      await panel.settle()
      expect(alert(panel)).toBeNull()
      await panel.show(true)

      expect(alert(panel)).toBeNull()
      panel.view.unmount()
    })

    it("stops saying so once a copy works", async () => {
      const panel = await mount(undefined)
      await rightClick(panel.row("package.json"))
      await choose("Copy Path")
      expect(alert(panel)).not.toBeNull()

      clipboard()
      await rightClick(panel.row("package.json"))
      await choose("Copy Path")
      await panel.settle()

      expect(alert(panel)).toBeNull()
      panel.view.unmount()
    })
  })

  context("when the person presses Shift+Alt+C on a row", () => {
    const chord = (key: string): KeyboardEvent =>
      new KeyboardEvent("keydown", {
        key,
        code: "KeyC",
        shiftKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      })

    it("copies its path, whatever character the keys type, and keeps the keys from the workspace", async () => {
      const copied = clipboard()
      const panel = await mount(work())
      const reached: KeyboardEvent[] = []
      const listen = (event: KeyboardEvent): void => void reached.push(event)
      window.addEventListener("keydown", listen)
      const button = panel.row("useCart.ts").querySelector<HTMLElement>("[role=treeitem]")!
      // Option and Shift on a Mac type Ç.
      const [plain, mac] = [chord("C"), chord("Ç")]

      act(() => {
        button.focus()
        button.dispatchEvent(plain)
        button.dispatchEvent(mac)
      })
      window.removeEventListener("keydown", listen)
      await panel.settle()

      expect(copied).toEqual([
        "/home/me/shop/src/cart/useCart.ts",
        "/home/me/shop/src/cart/useCart.ts",
      ])
      expect([plain.defaultPrevented, mac.defaultPrevented]).toEqual([true, true])
      expect(reached).toEqual([])
      panel.view.unmount()
    })
  })

  context("when the person refreshes", () => {
    it("reads the root and the open folders again", async () => {
      const reads = backend()
      const panel = await mount(undefined, undefined, undefined, reads)
      await panel.click("docs")
      reads.folders.length = 0

      act(() =>
        panel.view.container.querySelector<HTMLElement>("button[aria-label=Refresh]")!.click(),
      )
      await panel.settle()

      expect(reads.folders.toSorted()).toEqual(["", "docs"])
      panel.view.unmount()
    })
  })

  context("when patterns hide files", () => {
    it("leaves out what the person's patterns for every project match, listed or an agent's", async () => {
      const panel = await mount(work(), undefined, undefined, undefined, undefined, undefined, {
        exclude: { docs: true, "**/new.ts": true },
      })

      expect(panel.rows()).toEqual(["src", "cart", "Cart.tsx", "useCart.ts", "package.json"])
      panel.view.unmount()
    })

    it("leaves out what the project's own match once read, and shows what they switch off", async () => {
      const kept = projectPatterns({ "**/*.md": false, "package.json": true })
      const panel = await mount(undefined, undefined, undefined, undefined, undefined, undefined, {
        exclude: { "**/*.md": true },
        project: kept.source,
      })
      await panel.click("docs")

      expect(panel.rows()).toEqual(["docs", "readme.md", "src"])
      panel.view.unmount()
    })

    it("reads the project's patterns again whenever the panel is shown, and on Refresh", async () => {
      const kept = projectPatterns()
      const panel = await mount(undefined, undefined, undefined, undefined, undefined, undefined, {
        exclude: {},
        project: kept.source,
      })
      expect(kept.reads()).toBe(1)

      kept.set({ docs: true })
      await panel.show(false)
      await panel.show(true)
      expect(kept.reads()).toBe(2)
      expect(panel.rows()).not.toContain("docs")

      kept.set({})
      act(() =>
        panel.view.container.querySelector<HTMLElement>("button[aria-label=Refresh]")!.click(),
      )
      await panel.settle()
      expect(kept.reads()).toBe(3)
      expect(panel.rows()).toContain("docs")
      panel.view.unmount()
    })

    it("doesn't read a folder left open inside one opened again once it is hidden", async () => {
      const kept = projectPatterns()
      const reads = backend()
      const panel = await mount(undefined, undefined, undefined, reads, undefined, undefined, {
        exclude: {},
        project: kept.source,
      })
      await panel.click("src")
      await panel.click("cart")
      await panel.click("src")
      kept.set({ "src/cart": true })
      await panel.show(false)
      await panel.show(true)
      reads.folders.length = 0

      await panel.click("src")

      expect(reads.folders).toEqual(["src"])
      expect(panel.rows()).toEqual(["docs", "src", "package.json"])
      panel.view.unmount()
    })

    it("says everything is hidden where every entry at the top is, and draws no tree", async () => {
      const panel = await mount(undefined, undefined, undefined, undefined, undefined, undefined, {
        exclude: { "*": true },
      })

      expect(panel.view.container.querySelector(".files-empty")?.textContent).toBe(
        "Everything in this project's folder is hidden.",
      )
      expect(panel.view.container.querySelector("[role=tree]")).toBeNull()
      panel.view.unmount()
    })

    it("draws the agents' work at the top that no pattern hides, though all it lists is, kept or not", async () => {
      const added = work({
        changes: { "notes.md": { kind: "added", touched: { moth: recent } } },
        writing: {},
      })
      const panel = await mount(added, undefined, undefined, undefined, undefined, undefined, {
        exclude: { docs: true, src: true, "package.json": true },
      })
      expect(panel.rows()).toEqual(["notes.md"])

      act(() =>
        panel.view.container.querySelector<HTMLElement>(".files-strip .files-agent")!.click(),
      )

      expect(panel.rows()).toEqual(["notes.md"])
      expect(panel.view.container.querySelector(".files-empty")).toBeNull()
      panel.view.unmount()
    })

    it("offers neither Hidden files nor Hide in This Project until the project's patterns are read", async () => {
      const kept = projectPatterns({ docs: true })
      const release = kept.holdReads()
      const panel = await mount(undefined, undefined, undefined, undefined, undefined, undefined, {
        exclude: {},
        project: kept.source,
      })

      expect(panel.view.container.querySelector("button[aria-label='Hidden files']")).toBeNull()
      expect(panel.rows()).toContain("docs")
      await rightClick(panel.row("package.json").querySelector("[role=treeitem]")!)
      expect(menuItems()).toEqual(["Copy Path", "Copy Relative Path"])
      act(() => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        )
      })
      await frames()

      await release()
      expect(panel.view.container.querySelector("button[aria-label='Hidden files']")).not.toBeNull()
      expect(panel.rows()).not.toContain("docs")
      panel.view.unmount()
    })

    it("hides by the person's patterns alone, and offers no changes, when the project's can't be read", async () => {
      const kept = projectPatterns({ "package.json": true })
      kept.refuseReads("The runner is out of reach.")
      const panel = await mount(undefined, undefined, undefined, undefined, undefined, undefined, {
        exclude: { docs: true },
        project: kept.source,
      })

      expect(panel.rows()).toEqual(["src", "package.json"])
      expect(panel.view.container.querySelector("button[aria-label='Hidden files']")).toBeNull()
      expect(panel.view.container.querySelector("[role=alert]")).toBeNull()
      panel.view.unmount()
    })

    it("takes an agent whose work is all hidden out of the strip", async () => {
      const agents = { roster: ["moth", "crow"], squads: [] }
      const shown = await mount(work(), undefined, agents)
      const hidden = await mount(work(), undefined, agents, undefined, undefined, undefined, {
        exclude: { "src/cart": true },
      })

      expect(shown.view.container.querySelector(".files-strip")).not.toBeNull()
      expect(hidden.view.container.querySelector(".files-strip")).toBeNull()
      expect(hidden.rows()).toEqual(["docs", "src", "package.json"])
      shown.view.unmount()
      hidden.view.unmount()
    })
  })

  context("when the person edits the project's hidden files", () => {
    const hiddenFiles = (panel: Awaited<ReturnType<typeof mount>>): HTMLButtonElement | null =>
      panel.view.container.querySelector("button[aria-label='Hidden files']")
    const dialog = (): HTMLElement | null => document.querySelector("[role=dialog]")
    const button = (label: string): HTMLButtonElement =>
      [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(
        (each) => each.textContent === label || each.getAttribute("aria-label") === label,
      )!
    // The patterns of the dialog's list `name`, each with whether it is on and can change.
    const listed = (name: string): [string, boolean, boolean][] =>
      [...dialog()!.querySelectorAll(`ul[aria-label="${name}"] li`)].flatMap((row) => {
        const box = row.querySelector<HTMLInputElement>("input[type=checkbox]")
        return box ? [[row.textContent ?? "", box.checked, !box.disabled]] : []
      })
    const open = async (panel: Awaited<ReturnType<typeof mount>>): Promise<void> => {
      act(() => hiddenFiles(panel)!.click())
      await eventually(() => expect(dialog()).not.toBeNull())
    }
    const typePattern = (text: string): void =>
      act(() => {
        const field = dialog()!.querySelector<HTMLInputElement>(
          "input[aria-label='Pattern to hide']",
        )!
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text)
        field.dispatchEvent(new Event("input", { bubbles: true }))
      })
    const click = async (label: string): Promise<void> => {
      act(() => button(label).click())
      await settle()
    }
    const mounted = (kept: ReturnType<typeof projectPatterns>, onSettings = () => {}) =>
      mount(undefined, undefined, undefined, undefined, undefined, undefined, {
        exclude: { "**/*.md": true },
        project: kept.source,
        onSettings,
      })

    it("lists this project's patterns to change, and those of every project as they are", async () => {
      const panel = await mounted(projectPatterns({ docs: true }))
      await open(panel)

      expect(listed("This project's patterns")).toEqual([["docs", true, true]])
      expect(listed("Patterns for every project")).toEqual([["**/*.md", true, false]])
      panel.view.unmount()
    })

    it("saves what was added, switched off and removed, whole, and the tree follows", async () => {
      const kept = projectPatterns({ docs: true, "package.json": true })
      const panel = await mounted(kept)
      await open(panel)

      typePattern("  src  ")
      await click("Add")
      act(() =>
        dialog()!
          .querySelectorAll<HTMLInputElement>('ul[aria-label="This project\'s patterns"] input')[0]!
          .click(),
      )
      await click("Remove package.json")
      await click("Save")

      expect(kept.saved).toEqual([{ docs: false, src: true }])
      await eventually(() => expect(dialog()).toBeNull())
      expect(panel.rows()).toEqual(["docs", "package.json"])
      panel.view.unmount()
    })

    it("keeps the project's patterns as they were on Cancel", async () => {
      const kept = projectPatterns({ docs: true })
      const panel = await mounted(kept)
      await open(panel)
      typePattern("src")
      await click("Add")

      await click("Cancel")
      await eventually(() => expect(dialog()).toBeNull())
      await open(panel)

      expect(kept.saved).toEqual([])
      expect(listed("This project's patterns")).toEqual([["docs", true, true]])
      panel.view.unmount()
    })

    it("stays open saying why when the save fails, with the changes still there", async () => {
      const kept = projectPatterns({}, "The runner is out of reach.")
      const panel = await mounted(kept)
      await open(panel)
      typePattern("docs")
      await click("Add")

      await click("Save")

      await eventually(() =>
        expect(dialog()?.querySelector("[role=alert]")?.textContent).toBe(
          "Couldn't save this project's hidden files: The runner is out of reach.",
        ),
      )
      expect(listed("This project's patterns")).toEqual([["docs", true, true]])
      expect(button("Save").disabled).toBe(false)
      expect(panel.rows()).toContain("docs")
      panel.view.unmount()
    })

    it("saves a pattern typed and not added along with the rest", async () => {
      const kept = projectPatterns({ docs: true })
      const panel = await mounted(kept)
      await open(panel)

      typePattern(" src ")
      await click("Save")

      expect(kept.saved).toEqual([{ docs: true, src: true }])
      await eventually(() => expect(dialog()).toBeNull())
      panel.view.unmount()
    })

    it("opens Preferences at the patterns for every project, with nothing to save", async () => {
      const kept = projectPatterns({ docs: true })
      const opened = vi.fn<() => void>()
      const panel = await mounted(kept, opened)
      await open(panel)

      await click("Edit in Preferences")

      expect(opened).toHaveBeenCalledTimes(1)
      expect(kept.saved).toEqual([])
      await eventually(() => expect(dialog()).toBeNull())
      panel.view.unmount()
    })

    it("saves what changed here before it opens Preferences, the typed pattern too", async () => {
      const kept = projectPatterns({ docs: true })
      const opened = vi.fn<() => void>()
      const panel = await mounted(kept, opened)
      await open(panel)
      await click("Remove docs")
      typePattern("src")
      const release = kept.holdSaves()

      await click("Edit in Preferences")
      expect(opened).not.toHaveBeenCalled()
      await release()

      expect(kept.saved).toEqual([{ src: true }])
      expect(opened).toHaveBeenCalledTimes(1)
      await eventually(() => expect(dialog()).toBeNull())
      panel.view.unmount()
    })

    it("stays open saying why, and doesn't open Preferences, when that save fails", async () => {
      const kept = projectPatterns({}, "The runner is out of reach.")
      const opened = vi.fn<() => void>()
      const panel = await mounted(kept, opened)
      await open(panel)
      typePattern("docs")

      await click("Edit in Preferences")

      await eventually(() =>
        expect(dialog()?.querySelector("[role=alert]")?.textContent).toBe(
          "Couldn't save this project's hidden files: The runner is out of reach.",
        ),
      )
      expect(opened).not.toHaveBeenCalled()
      expect(listed("This project's patterns")).toEqual([["docs", true, true]])
      panel.view.unmount()
    })

    it("keeps what was saved over a read of the project's patterns begun before it", async () => {
      const kept = projectPatterns({ docs: true })
      const panel = await mounted(kept)
      expect(panel.rows()).not.toContain("docs")
      const release = kept.holdReads()
      act(() =>
        panel.view.container.querySelector<HTMLElement>("button[aria-label=Refresh]")!.click(),
      )
      await open(panel)
      await click("Remove docs")
      await click("Save")
      await eventually(() => expect(dialog()).toBeNull())

      await release()

      expect(kept.saved).toEqual([{}])
      expect(panel.rows()).toContain("docs")
      panel.view.unmount()
    })
  })

  context("when the person hides a row in the project", () => {
    blurWhatHides()
    const select = (panel: Awaited<ReturnType<typeof mount>>, name: string): HTMLElement =>
      panel.row(name).querySelector<HTMLElement>("[role=treeitem]")!
    const mounted = (kept: ReturnType<typeof projectPatterns>, entries = files) =>
      mount(undefined, undefined, undefined, backend(undefined, entries), undefined, undefined, {
        exclude: {},
        project: kept.source,
      })

    it("adds the row's exact path to the project's patterns, and the row leaves", async () => {
      const kept = projectPatterns({ docs: true })
      const panel = await mounted(kept, [...files, "src/app/[id]/page.tsx"])
      await panel.click("src")
      await panel.click("app")

      await rightClick(select(panel, "[id]"))
      expect(menuItems()).toContain("Hide in This Project")
      await choose("Hide in This Project")
      await panel.settle()

      expect(kept.saved).toEqual([{ docs: true, "src/app/\\[id\\]": true }])
      expect(panel.rows()).toEqual(["src", "app", "cart", "package.json"])
      expect(panel.view.container.querySelector("[role=alert]")).toBeNull()
      // The keyboard was on the row, and goes on to the next.
      expect(document.activeElement).toBe(select(panel, "cart"))
      panel.view.unmount()
    })

    it("adds to the patterns as the backend holds them, keeping what another window saved", async () => {
      const kept = projectPatterns({ docs: true })
      const panel = await mounted(kept)
      kept.set({ docs: true, "*.log": true })

      await rightClick(select(panel, "package.json"))
      await choose("Hide in This Project")
      await panel.settle()

      expect(kept.saved).toEqual([{ docs: true, "*.log": true, "package.json": true }])
      panel.view.unmount()
    })

    it("lands each of two hides asked for before the first was saved", async () => {
      const kept = projectPatterns()
      const panel = await mounted(kept)
      const release = kept.holdSaves()

      await rightClick(select(panel, "package.json"))
      await choose("Hide in This Project")
      await rightClick(select(panel, "docs"))
      await choose("Hide in This Project")
      await release()

      expect(kept.saved).toEqual([{ "package.json": true }, { "package.json": true, docs: true }])
      expect(panel.rows()).toEqual(["src"])
      panel.view.unmount()
    })

    it("says above the tree when the patterns can't be read first, and keeps the row", async () => {
      const kept = projectPatterns()
      const panel = await mounted(kept)
      kept.refuseReads("The runner is out of reach.")

      await rightClick(select(panel, "package.json"))
      await choose("Hide in This Project")
      await panel.settle()

      expect(kept.saved).toEqual([])
      expect(panel.view.container.querySelector("[role=alert]")?.textContent).toBe(
        "Couldn't hide package.json: The runner is out of reach.",
      )
      expect(panel.rows()).toContain("package.json")
      panel.view.unmount()
    })

    it("says above the tree when the save fails, and keeps the row", async () => {
      const kept = projectPatterns({}, "The runner is out of reach.")
      const panel = await mounted(kept)

      await rightClick(select(panel, "package.json"))
      await choose("Hide in This Project")
      await panel.settle()

      expect(panel.view.container.querySelector("[role=alert]")?.textContent).toBe(
        "Couldn't hide package.json: The runner is out of reach.",
      )
      expect(panel.rows()).toContain("package.json")
      panel.view.unmount()
    })

    it("offers nothing to hide on the tree's empty space", async () => {
      const panel = await mounted(projectPatterns())

      await rightClick(panel.view.container.querySelector("[role=tree]")!)

      expect(menuItems()).toEqual(["Copy Path", "Refresh"])
      panel.view.unmount()
    })
  })

  context("where the backend keeps no patterns of the project's", () => {
    it("offers neither Hidden files nor Hide in This Project, and hides by the person's", async () => {
      const panel = await mount(undefined, undefined, undefined, undefined, undefined, undefined, {
        exclude: { docs: true },
      })

      expect(panel.view.container.querySelector("button[aria-label='Hidden files']")).toBeNull()
      await rightClick(panel.row("package.json").querySelector("[role=treeitem]")!)
      expect(menuItems()).toEqual(["Copy Path", "Copy Relative Path"])
      expect(panel.rows()).not.toContain("docs")
      panel.view.unmount()
    })
  })

  context("when the person makes, renames and deletes files", () => {
    blurWhatHides()

    // A backend whose files the panel changes: `initial` as `backend` takes them, made, moved,
    // copied and deleted as asked, with each change asked for noted, and each refused while
    // `refuse` says why. A copy takes its own name where that is free, else `name copy.ext`. After
    // `hold`, the next change waits for `release`; `lose` takes a path away as another program
    // would.
    const changing = (initial: readonly string[] = files) => {
      let paths = [...initial]
      let refusal: string | undefined
      let holding = false
      let release = (): void => {}
      // Whether the connection drops under the next change, before it is made or after.
      let dropping: "before" | "after" | undefined
      const folders: string[] = []
      const changes: string[] = []
      const refuse = async (): Promise<void> => {
        if (holding) {
          holding = false
          await new Promise<void>((resolve) => (release = resolve))
        }
        if (dropping === "before") {
          dropping = undefined
          throw new ChangeUnanswered()
        }
        if (refusal !== undefined) throw new Error(refusal)
      }
      const answer = <T>(made: T): T => {
        if (dropping !== "after") return made
        dropping = undefined
        throw new ChangeUnanswered()
      }
      // A folder left with nothing in it stays, empty.
      const keepFolder = (folder: string): void => {
        if (folder !== "" && !paths.some((each) => atOrBelow(each, folder)))
          paths = [...paths, `${folder}/`]
      }
      return {
        folders,
        changes,
        refuse: (why: string | undefined): void => {
          refusal = why
        },
        hold: (): void => {
          holding = true
        },
        // The connection drops under the next change, which is `made` or not.
        drop: (made: boolean): void => {
          dropping = made ? "after" : "before"
        },
        release: (): void => release(),
        lose: (path: string): void => {
          paths = paths.filter((each) => !atOrBelow(each.replace(/\/$/, ""), path))
        },
        list: async (folder: string): Promise<FolderListing> => {
          folders.push(folder)
          const listing = folderListings(paths).get(folder)
          if (!listing && folder !== "") throw new Error("There is no such folder")
          return listing ?? { entries: [], truncated: false }
        },
        entries: {
          create: async (path: string, folder: boolean) => {
            changes.push(`create ${path}`)
            await refuse()
            paths = [
              ...paths.filter((each) => each !== `${parentOf(path)}/`),
              folder ? `${path}/` : path,
            ]
            return path
          },
          move: async (from: string, to: string) => {
            changes.push(`move ${from} ${to}`)
            await refuse()
            paths = paths.map(
              (each) => moved(each.replace(/\/$/, ""), from, to) + (each.endsWith("/") ? "/" : ""),
            )
            keepFolder(parentOf(from))
            return answer(to)
          },
          copy: async (from: string, into: string) => {
            changes.push(`copy ${from} ${into}`)
            await refuse()
            const name = nameOf(from)
            const own = into === "" ? name : `${into}/${name}`
            const taken = paths.some((each) => atOrBelow(each.replace(/\/$/, ""), own))
            const to = taken ? own.replace(/(\.[^./]+)?$/, " copy$1") : own
            paths = [
              ...paths.filter((each) => each !== `${into}/`),
              ...paths
                .filter((each) => atOrBelow(each.replace(/\/$/, ""), from))
                .map(
                  (each) =>
                    moved(each.replace(/\/$/, ""), from, to) + (each.endsWith("/") ? "/" : ""),
                ),
            ]
            return answer(to)
          },
          remove: async (path: string) => {
            changes.push(`remove ${path}`)
            await refuse()
            paths = paths.filter((each) => !atOrBelow(each.replace(/\/$/, ""), path))
            keepFolder(parentOf(path))
            answer(undefined)
          },
        } satisfies EntryChanges,
      }
    }
    type Fake = ReturnType<typeof changing>
    const mountChanging = (
      fake: Fake,
      options: {
        readonly work?: FilesProject
        readonly hiding?: Hiding
        readonly entries?: EntryChanges
        readonly onMoved?: (from: string, to: string) => void
      } = {},
    ) =>
      mount(options.work, undefined, undefined, fake, undefined, undefined, options.hiding, {
        entries: options.entries ?? fake.entries,
        onMoved: options.onMoved,
      })
    type Panel = Awaited<ReturnType<typeof mount>>
    const item = (panel: Panel, name: string): HTMLElement =>
      panel.row(name).querySelector<HTMLElement>("[role=treeitem]")!
    const field = (): HTMLInputElement | null =>
      document.querySelector<HTMLInputElement>(".files-naming-input")
    const problem = (): string | null =>
      document.querySelector(".files-naming-problem")?.textContent ?? null
    const type = (text: string): void =>
      act(() => {
        const input = field()!
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text)
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
    const press = async (
      on: Element,
      key: string,
      init: KeyboardEventInit = {},
    ): Promise<KeyboardEvent> => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
      act(() => {
        on.dispatchEvent(event)
      })
      await settle()
      return event
    }
    const alert = (panel: Panel): string | null =>
      panel.view.container.querySelector("[role=alert]")?.textContent ?? null
    const dialog = (): HTMLElement | null => document.querySelector("[role=alertdialog]")
    const dialogButton = (label: string): HTMLButtonElement =>
      [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(
        (each) => each.textContent === label,
      )!
    // Asks for a row's menu, or the empty space's, and chooses `label`.
    const fromMenu = async (on: Element, label: string): Promise<void> => {
      await rightClick(on)
      await choose(label)
      await settle()
    }

    context("in the menu", () => {
      it("offers New File…, New Folder…, Cut, Copy, Paste, Rename… and Delete on a row, where the backend makes them", async () => {
        const panel = await mountChanging(changing())

        await rightClick(item(panel, "package.json"))

        expect(menuItems()).toEqual([
          "New File…",
          "New Folder…",
          "Cut",
          "Copy",
          "Paste",
          "Copy Path",
          "Copy Relative Path",
          "Rename…",
          "Delete",
        ])
        panel.view.unmount()
      })

      it("offers only what the backend makes", async () => {
        const fake = changing()
        const panel = await mountChanging(fake, { entries: { remove: fake.entries.remove } })

        await rightClick(item(panel, "package.json"))

        expect(menuItems()).toEqual(["Copy Path", "Copy Relative Path", "Delete"])
        panel.view.unmount()
      })

      it("offers only the copies on a row only an agent's work has", async () => {
        const panel = await mountChanging(changing(), { work: work() })

        await rightClick(item(panel, "new.ts"))

        expect(menuItems()).toEqual(["Copy Path", "Copy Relative Path"])
        panel.view.unmount()
      })

      it("offers a new file or folder in the root on the line that says the folder is empty", async () => {
        const fake = changing([])
        const panel = await mountChanging(fake)

        await rightClick(panel.view.container.querySelector(".files-empty")!)
        expect(menuItems()).toEqual(["New File…", "New Folder…", "Paste", "Copy Path", "Refresh"])
        await choose("New Folder…")
        await settle()
        expect(panel.view.container.querySelector(".files-empty")).toBeNull()
        type("assets")
        await press(field()!, "Enter")

        expect(fake.changes).toEqual(["create assets"])
        expect(panel.rows()).toEqual(["assets"])
        panel.view.unmount()
      })
    })

    context("when naming a new file or folder", () => {
      it("names it in a field first in a folder, which opens, then makes it, selected and focused", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)

        await fromMenu(item(panel, "docs"), "New File…")
        expect(document.activeElement).toBe(field())
        expect(field()!.getAttribute("aria-label")).toBe("Name of the new file")
        // The field comes first in docs, which opened.
        const lines = [...panel.view.container.querySelectorAll(".files-row, .files-naming-row")]
        expect(
          lines.map((line) => line.querySelector(".files-name")?.textContent ?? "field"),
        ).toEqual(["docs", "field", "readme.md", "src", "package.json"])
        type("guide.md")
        await press(field()!, "Enter")

        expect(fake.changes).toEqual(["create docs/guide.md"])
        expect(field()).toBeNull()
        expect(item(panel, "guide.md").getAttribute("aria-selected")).toBe("true")
        expect(document.activeElement).toBe(item(panel, "guide.md"))
        panel.view.unmount()
      })

      it("makes it beside a file, and the folders a slash names on the way, open", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        await panel.click("src")
        await panel.click("cart")

        await fromMenu(item(panel, "useCart.ts"), "New File…")
        type("api/orders.ts")
        await press(field()!, "Enter")

        expect(fake.changes).toEqual(["create src/cart/api/orders.ts"])
        expect(panel.rows()).toEqual([
          "docs",
          "src",
          "cart",
          "api",
          "orders.ts",
          "Cart.tsx",
          "useCart.ts",
          "package.json",
        ])
        expect(document.activeElement).toBe(item(panel, "orders.ts"))
        panel.view.unmount()
      })

      it("says under the field what is wrong with a name, and keeps it open on Enter", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        await panel.click("src")

        await fromMenu(item(panel, "src"), "New File…")
        expect(problem()).toBeNull()
        type("cart")
        expect(problem()).toBe("There's already a folder named cart here.")
        expect(field()!.getAttribute("aria-invalid")).toBe("true")
        await press(field()!, "Enter")
        expect(field()).not.toBeNull()
        type("a\\b.ts")
        expect(problem()).toBe("A name can't hold a backslash.")

        expect(fake.changes).toEqual([])
        panel.view.unmount()
      })

      it("ends on Escape with nothing made, giving the row it was asked on its focus back", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)

        await fromMenu(item(panel, "package.json"), "New Folder…")
        type("dist")
        await press(field()!, "Escape")

        expect(field()).toBeNull()
        expect(fake.changes).toEqual([])
        expect(document.activeElement).toBe(item(panel, "package.json"))
        panel.view.unmount()
      })

      it("makes what a name that will do asks for when the field is left, and nothing for one that won't or none", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)

        await fromMenu(item(panel, "docs"), "New File…")
        type("notes.md")
        act(() => field()!.blur())
        await settle()
        expect(fake.changes).toEqual(["create docs/notes.md"])
        // Leaving it gives no focus to the new row, though it is selected.
        expect(item(panel, "notes.md").getAttribute("aria-selected")).toBe("true")
        expect(document.activeElement).not.toBe(item(panel, "notes.md"))

        for (const typed of ["readme.md", ""]) {
          // eslint-disable-next-line no-await-in-loop -- One field after another.
          await fromMenu(item(panel, "docs"), "New File…")
          type(typed)
          act(() => field()!.blur())
          // eslint-disable-next-line no-await-in-loop -- Each field ends before the next.
          await settle()
          expect(field()).toBeNull()
        }
        expect(fake.changes).toEqual(["create docs/notes.md"])
        panel.view.unmount()
      })

      it("leaves Enter to an input method composing", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)

        await fromMenu(item(panel, "docs"), "New File…")
        type("ノート.md")
        await press(field()!, "Enter", { isComposing: true })

        expect(field()).not.toBeNull()
        expect(fake.changes).toEqual([])
        panel.view.unmount()
      })

      it("makes one the patterns hide, and says which pattern hides it", async () => {
        const fake = changing()
        const panel = await mountChanging(fake, { hiding: { exclude: { "**/*.log": true } } })

        await fromMenu(panel.view.container.querySelector("[role=tree]")!, "New File…")
        type("debug.log")
        await press(field()!, "Enter")

        expect(fake.changes).toEqual(["create debug.log"])
        expect(alert(panel)).toBe("Made debug.log, which the pattern **/*.log hides.")
        expect(panel.rows()).not.toContain("debug.log")
        panel.view.unmount()
      })

      it("says above the tree why the backend refused it", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        fake.refuse("The system doesn't allow it: permission denied.")

        await fromMenu(item(panel, "docs"), "New Folder…")
        type("guides")
        await press(field()!, "Enter")

        expect(alert(panel)).toBe(
          "Couldn't make docs/guides: The system doesn't allow it: permission denied.",
        )
        expect(panel.rows()).not.toContain("guides")
        panel.view.unmount()
      })
    })

    context("when renaming", () => {
      it("names a row anew in its place, its name's stem selected, then selects and focuses it", async () => {
        const fake = changing()
        const followed: string[] = []
        const panel = await mountChanging(fake, {
          onMoved: (from, to) => void followed.push(`${from} -> ${to}`),
        })
        await panel.click("src")
        await panel.click("cart")

        await fromMenu(item(panel, "useCart.ts"), "Rename…")
        expect(field()!.value).toBe("useCart.ts")
        expect([field()!.selectionStart, field()!.selectionEnd]).toEqual([0, 7])
        expect(panel.rows()).not.toContain("useCart.ts")
        type("useBasket.ts")
        await press(field()!, "Enter")

        expect(fake.changes).toEqual(["move src/cart/useCart.ts src/cart/useBasket.ts"])
        expect(followed).toEqual(["src/cart/useCart.ts -> src/cart/useBasket.ts"])
        expect(panel.rows()).toEqual([
          "docs",
          "src",
          "cart",
          "Cart.tsx",
          "useBasket.ts",
          "package.json",
        ])
        expect(item(panel, "useBasket.ts").getAttribute("aria-selected")).toBe("true")
        expect(document.activeElement).toBe(item(panel, "useBasket.ts"))
        panel.view.unmount()
      })

      it("keeps a renamed open folder open, with what it lists and the file selected in it", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        await panel.click("src")
        await panel.click("cart")
        await panel.click("Cart.tsx")
        fake.folders.length = 0

        await fromMenu(item(panel, "cart"), "Rename…")
        type("basket")
        await press(field()!, "Enter")

        expect(panel.rows()).toEqual([
          "docs",
          "src",
          "basket",
          "Cart.tsx",
          "useCart.ts",
          "package.json",
        ])
        expect(item(panel, "basket").getAttribute("aria-expanded")).toBe("true")
        expect(item(panel, "Cart.tsx").getAttribute("aria-selected")).toBe("true")
        // Its folder is read again; what it lists itself is kept, not read anew.
        expect(fake.folders).toEqual(["src"])
        panel.view.unmount()
      })

      it("renames to a name the patterns hide, and says which pattern hides it", async () => {
        const fake = changing()
        const panel = await mountChanging(fake, { hiding: { exclude: { "**/*.log": true } } })

        await fromMenu(item(panel, "package.json"), "Rename…")
        type("package.log")
        await press(field()!, "Enter")

        expect(fake.changes).toEqual(["move package.json package.log"])
        expect(alert(panel)).toBe("Renamed to package.log, which the pattern **/*.log hides.")
        expect(panel.rows()).toEqual(["docs", "src"])
        panel.view.unmount()
      })

      it("does nothing for the name it has, and says why the backend refused another", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)

        await fromMenu(item(panel, "package.json"), "Rename…")
        await press(field()!, "Enter")
        expect(fake.changes).toEqual([])
        expect(document.activeElement).toBe(item(panel, "package.json"))

        fake.refuse("There's already something named package.JSON in the project's folder.")
        await fromMenu(item(panel, "package.json"), "Rename…")
        type("package.JSON")
        await press(field()!, "Enter")

        expect(alert(panel)).toBe(
          "Couldn't rename package.json to package.JSON: There's already something named package.JSON in the project's folder.",
        )
        expect(panel.rows()).toContain("package.json")
        panel.view.unmount()
      })
    })

    context("when deleting", () => {
      it("asks first, naming the entry, a folder's insides and that it can't be undone", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        await panel.click("src")

        await fromMenu(item(panel, "cart"), "Delete")
        await eventually(() => expect(dialog()).not.toBeNull())

        expect(dialog()!.querySelector(".modal-title")?.textContent).toBe("Delete cart?")
        expect(dialog()!.querySelector(".modal-description")?.textContent).toBe(
          "src/cart and everything in it will be deleted. This can't be undone.",
        )
        act(() => dialogButton("Cancel").click())
        await settle()

        expect(fake.changes).toEqual([])
        await eventually(() => expect(document.activeElement).toBe(item(panel, "cart")))
        panel.view.unmount()
      })

      it("says a file goes alone", async () => {
        const panel = await mountChanging(changing())

        await fromMenu(item(panel, "package.json"), "Delete")
        await eventually(() => expect(dialog()).not.toBeNull())

        expect(dialog()!.querySelector(".modal-description")?.textContent).toBe(
          "package.json will be deleted. This can't be undone.",
        )
        act(() => dialogButton("Cancel").click())
        await settle()
        panel.view.unmount()
      })

      it("deletes once confirmed, and the row after it takes the focus", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        await panel.click("docs")

        await fromMenu(item(panel, "docs"), "Delete")
        await eventually(() => expect(dialog()).not.toBeNull())
        act(() => dialogButton("Delete").click())
        await settle()

        expect(fake.changes).toEqual(["remove docs"])
        expect(panel.rows()).toEqual(["src", "package.json"])
        await eventually(() => expect(document.activeElement).toBe(item(panel, "src")))
        panel.view.unmount()
      })

      it("says above the tree why the backend refused it, and keeps the row", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        fake.refuse("It's in use by another program.")

        await fromMenu(item(panel, "package.json"), "Delete")
        await eventually(() => expect(dialog()).not.toBeNull())
        act(() => dialogButton("Delete").click())
        await settle()

        expect(alert(panel)).toBe("Couldn't delete package.json: It's in use by another program.")
        expect(panel.rows()).toContain("package.json")
        panel.view.unmount()
      })
    })

    context("with the keyboard", () => {
      it("renames the focused row on F2 and asks to delete it on Delete, keeping both from the workspace", async () => {
        const panel = await mountChanging(changing())
        const reached: KeyboardEvent[] = []
        const listen = (event: KeyboardEvent): void => void reached.push(event)
        window.addEventListener("keydown", listen)
        act(() => item(panel, "package.json").focus())

        const rename = await press(item(panel, "package.json"), "F2")
        expect(field()!.value).toBe("package.json")
        await press(field()!, "Escape")
        const remove = await press(item(panel, "package.json"), "Delete")
        await eventually(() => expect(dialog()).not.toBeNull())
        window.removeEventListener("keydown", listen)

        expect([rename.defaultPrevented, remove.defaultPrevented]).toEqual([true, true])
        expect(reached).toEqual([])
        act(() => dialogButton("Cancel").click())
        await settle()
        panel.view.unmount()
      })

      it("keeps F2 and Delete from the workspace on a row it may not change, doing nothing", async () => {
        const panel = await mountChanging(changing(), { work: work() })
        const reached: KeyboardEvent[] = []
        const listen = (event: KeyboardEvent): void => void reached.push(event)
        window.addEventListener("keydown", listen)

        await press(item(panel, "new.ts"), "F2")
        await press(item(panel, "new.ts"), "Delete")
        window.removeEventListener("keydown", listen)

        expect(reached).toEqual([])
        expect(field()).toBeNull()
        expect(dialog()).toBeNull()
        panel.view.unmount()
      })

      it("keeps F2 and Delete from the workspace where the backend changes nothing, doing nothing", async () => {
        const panel = await mount(undefined)
        const reached: string[] = []
        const listen = (event: KeyboardEvent): void => void reached.push(event.key)
        window.addEventListener("keydown", listen)

        await press(item(panel, "package.json"), "F2")
        await press(item(panel, "package.json"), "Delete")
        window.removeEventListener("keydown", listen)

        expect(reached).toEqual([])
        expect(field()).toBeNull()
        expect(dialog()).toBeNull()
        panel.view.unmount()
      })

      it("on macOS deletes on ⌘⌫ only, keeping a forward Delete from the workspace too", async () => {
        const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
        const panel = await mountChanging(changing())
        const reached: string[] = []
        const listen = (event: KeyboardEvent): void => void reached.push(event.key)
        window.addEventListener("keydown", listen)

        const forward = await press(item(panel, "package.json"), "Delete")
        expect(dialog()).toBeNull()
        await press(item(panel, "package.json"), "Backspace", { metaKey: true })
        await eventually(() => expect(dialog()).not.toBeNull())
        window.removeEventListener("keydown", listen)

        expect(forward.defaultPrevented).toBe(true)
        expect(reached).toEqual([])
        act(() => dialogButton("Cancel").click())
        await settle()
        platform.mockRestore()
        panel.view.unmount()
      })

      it("keeps the focus on the row a refused rename was asked on", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        act(() => item(panel, "package.json").focus())
        fake.refuse("It's in use by another program.")

        await press(item(panel, "package.json"), "F2")
        type("manifest.json")
        await press(field()!, "Enter")

        expect(alert(panel)).toBe(
          "Couldn't rename package.json to manifest.json: It's in use by another program.",
        )
        expect(document.activeElement).toBe(item(panel, "package.json"))
        panel.view.unmount()
      })

      it("gives the focus to the row after one renamed to a name the patterns hide", async () => {
        const fake = changing()
        const panel = await mountChanging(fake, { hiding: { exclude: { "**/*.log": true } } })
        act(() => item(panel, "docs").focus())

        await press(item(panel, "docs"), "F2")
        type("logs.log")
        await press(field()!, "Enter")

        expect(fake.changes).toEqual(["move docs logs.log"])
        expect(document.activeElement).toBe(item(panel, "src"))
        panel.view.unmount()
      })
    })

    context("while another change is under way", () => {
      it("keeps the field a name is typed in, its text and its focus, when a delete asked before ends", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        fake.hold()
        await fromMenu(item(panel, "package.json"), "Delete")
        await eventually(() => expect(dialog()).not.toBeNull())
        act(() => dialogButton("Delete").click())
        await settle()

        await fromMenu(item(panel, "docs"), "New File…")
        type("draft.md")
        fake.release()
        await settle()

        expect(panel.rows()).not.toContain("package.json")
        expect(document.activeElement).toBe(field())
        expect(field()!.value).toBe("draft.md")
        expect(fake.changes).toEqual(["remove package.json"])
        panel.view.unmount()
      })

      it("clears the line above the tree as a delete is asked", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        fake.refuse("It's in use by another program.")
        await fromMenu(item(panel, "package.json"), "Rename…")
        type("manifest.json")
        await press(field()!, "Enter")
        expect(alert(panel)).not.toBeNull()
        fake.refuse(undefined)

        await fromMenu(item(panel, "package.json"), "Delete")
        await eventually(() => expect(dialog()).not.toBeNull())
        act(() => dialogButton("Delete").click())
        await settle()

        expect(alert(panel)).toBeNull()
        panel.view.unmount()
      })
    })

    context("when it is refused part way", () => {
      it("reads again the folder a refused make was asked in", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        fake.refuse("The disk is full.")
        await fromMenu(item(panel, "docs"), "New File…")
        fake.folders.length = 0

        type("guides/install.md")
        await press(field()!, "Enter")

        expect(fake.folders).toEqual(["docs"])
        panel.view.unmount()
      })

      it("reads again the folder of a refused delete, and the open folder it was asked on", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        await panel.click("src")
        await panel.click("cart")
        fake.refuse("It's in use by another program.")
        fake.folders.length = 0

        await fromMenu(item(panel, "cart"), "Delete")
        await eventually(() => expect(dialog()).not.toBeNull())
        act(() => dialogButton("Delete").click())
        await settle()

        expect(fake.folders.toSorted()).toEqual(["src", "src/cart"])
        panel.view.unmount()
      })
    })

    context("when what a field names leaves the tree", () => {
      it("keeps the field, its text and its focus through a reading of the folders", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        await fromMenu(item(panel, "docs"), "New File…")
        type("draft.md")
        const typing = field()

        await panel.endTurn()

        expect(field()).toBe(typing)
        expect(document.activeElement).toBe(typing)
        expect(field()!.value).toBe("draft.md")
        panel.view.unmount()
      })

      it("ends a rename whose row is gone, giving the tree's tab stop the focus, and makes nothing later", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        act(() => item(panel, "package.json").focus())
        await press(item(panel, "package.json"), "F2")
        type("manifest.json")
        fake.lose("package.json")

        await panel.endTurn()

        expect(field()).toBeNull()
        expect(document.activeElement).toBe(item(panel, "docs"))
        await panel.endTurn()
        expect(field()).toBeNull()
        expect(fake.changes).toEqual([])
        panel.view.unmount()
      })
    })

    context("when the window loses focus", () => {
      it("keeps the field open with its text, making nothing", async () => {
        const fake = changing()
        const panel = await mountChanging(fake)
        await fromMenu(item(panel, "docs"), "New File…")
        type("dra")
        const away = vi.spyOn(document, "hasFocus").mockReturnValue(false)

        act(() => field()!.blur())
        await settle()
        away.mockRestore()

        expect(field()!.value).toBe("dra")
        expect(fake.changes).toEqual([])
        panel.view.unmount()
      })
    })

    context("when cutting, copying and pasting", () => {
      // The row of the entry at `path`, whatever its name, as a pasted copy shares its name.
      const at = (panel: Panel, path: string): HTMLElement | null =>
        panel.view.container.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
      const cutRows = (panel: Panel): string[] =>
        Array.from(panel.view.container.querySelectorAll(".files-row[data-cut=true]")).map(
          (row) => row.querySelector<HTMLElement>("[data-path]")!.dataset["path"]!,
        )
      const busyRows = (panel: Panel): string[] =>
        Array.from(panel.view.container.querySelectorAll<HTMLElement>("[aria-busy=true]")).map(
          (row) => row.dataset["path"]!,
        )
      // The menu's items shown but not chosen now.
      const greyed = (): string[] =>
        Array.from(openMenu()?.querySelectorAll("[data-part=item][data-disabled]") ?? []).map(
          (each) => each.querySelector("[data-part=item-text]")?.textContent ?? "",
        )
      const closeMenu = async (): Promise<void> => {
        act(() => {
          openMenu()?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
          )
        })
        await frames()
      }
      // Ctrl, or ⌘ on a Mac, with `key`, on a row's or a field's element.
      const chord = (on: Element, key: string, init: KeyboardEventInit = {}) =>
        press(on, key, { code: `Key${key.toUpperCase()}`, ctrlKey: true, ...init })
      const kept = (panel: Panel): string[] =>
        Array.from(panel.view.container.querySelectorAll(".files-agent[aria-pressed=true]")).map(
          (each) => each.textContent ?? "",
        )

      context("in the menu", () => {
        it("greys Paste until a row is cut or copied, then pastes it on a row or off one", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)

          await rightClick(item(panel, "package.json"))
          expect(greyed()).toEqual(["Paste"])
          await choose("Copy")
          await rightClick(panel.view.container.querySelector("[role=tree]")!)
          expect(menuItems()).toEqual(["New File…", "New Folder…", "Paste", "Copy Path", "Refresh"])
          expect(greyed()).toEqual([])
          await choose("Paste")
          await settle()

          expect(fake.changes).toEqual(["copy package.json "])
          expect(panel.rows()).toContain("package copy.json")
          panel.view.unmount()
        })

        it("offers no Cut, Copy or Paste on a row only an agent's work has", async () => {
          const fake = changing()
          const panel = await mountChanging(fake, { work: work() })

          await rightClick(item(panel, "new.ts"))

          expect(menuItems()).toEqual(["Copy Path", "Copy Relative Path"])
          panel.view.unmount()
        })
      })

      context("with a copy", () => {
        it("copies into a folder, which opens, then selects and focuses the copy, and keeps the copy to paste again", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)

          await fromMenu(item(panel, "package.json"), "Copy")
          await fromMenu(item(panel, "docs"), "Paste")

          expect(fake.changes).toEqual(["copy package.json docs"])
          expect(item(panel, "docs").getAttribute("aria-expanded")).toBe("true")
          expect(at(panel, "docs/package.json")!.getAttribute("aria-selected")).toBe("true")
          expect(document.activeElement).toBe(at(panel, "docs/package.json"))
          await fromMenu(item(panel, "readme.md"), "Paste")
          expect(fake.changes).toEqual(["copy package.json docs", "copy package.json docs"])
          expect(document.activeElement).toBe(at(panel, "docs/package copy.json"))
          panel.view.unmount()
        })

        it("pastes beside a file, into that file's folder, a folder with all it holds", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await panel.click("src")

          await fromMenu(item(panel, "docs"), "Copy")
          await fromMenu(item(panel, "package.json"), "Paste")
          await panel.click("docs copy")

          expect(fake.changes).toEqual(["copy docs "])
          expect(at(panel, "docs copy/readme.md")).not.toBeNull()
          panel.view.unmount()
        })
      })

      context("with a cut", () => {
        it("dims the row cut, moves it where it is pasted, lets the cut go, and has what shows it follow", async () => {
          const fake = changing()
          const moves: string[] = []
          const panel = await mountChanging(fake, {
            onMoved: (from, to) => void moves.push(`${from} ${to}`),
          })

          await fromMenu(item(panel, "package.json"), "Cut")
          expect(cutRows(panel)).toEqual(["package.json"])
          expect(item(panel, "package.json").getAttribute("aria-label")).toBe("package.json, cut")
          await fromMenu(item(panel, "docs"), "Paste")

          expect(fake.changes).toEqual(["move package.json docs/package.json"])
          expect(moves).toEqual(["package.json docs/package.json"])
          expect(cutRows(panel)).toEqual([])
          expect(document.activeElement).toBe(at(panel, "docs/package.json"))
          await rightClick(item(panel, "src"))
          expect(greyed()).toEqual(["Paste"])
          await closeMenu()
          panel.view.unmount()
        })

        it("does nothing for a cut pasted back into its own folder, and lets it go", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await panel.click("docs")

          await fromMenu(item(panel, "readme.md"), "Cut")
          await fromMenu(item(panel, "docs"), "Paste")

          expect(fake.changes).toEqual([])
          expect(cutRows(panel)).toEqual([])
          panel.view.unmount()
        })

        it("says above the tree why a move was refused, reads both folders again, and keeps the cut", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await panel.click("docs")
          await fromMenu(item(panel, "package.json"), "Cut")
          fake.refuse("There's already something named package.json in docs.")
          fake.folders.length = 0

          await fromMenu(item(panel, "docs"), "Paste")

          expect(alert(panel)).toBe(
            "Couldn't move package.json into docs: There's already something named package.json in docs.",
          )
          expect(fake.folders.toSorted()).toEqual(["", "docs"])
          expect(cutRows(panel)).toEqual(["package.json"])
          panel.view.unmount()
        })

        it("lets a cut go whose entry is gone, once the refusal has its folder read again", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await fromMenu(item(panel, "package.json"), "Cut")
          fake.lose("package.json")
          fake.refuse("package.json isn't there any more.")

          await fromMenu(item(panel, "docs"), "Paste")

          expect(alert(panel)).toBe(
            "Couldn't move package.json into docs: package.json isn't there any more.",
          )
          expect(panel.rows()).not.toContain("package.json")
          await rightClick(item(panel, "docs"))
          expect(greyed()).toEqual(["Paste"])
          await closeMenu()
          panel.view.unmount()
        })
      })

      context("while a paste runs", () => {
        it("shows the row pasted busy, and greys a cut's Paste until it ends", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await fromMenu(item(panel, "package.json"), "Cut")
          fake.hold()

          await fromMenu(item(panel, "docs"), "Paste")
          expect(busyRows(panel)).toEqual(["package.json"])
          expect(item(panel, "package.json").querySelector(".files-busy")).not.toBeNull()
          await rightClick(item(panel, "src"))
          expect(greyed()).toEqual(["Paste"])
          await closeMenu()
          fake.release()
          await settle()

          expect(busyRows(panel)).toEqual([])
          expect(fake.changes).toEqual(["move package.json docs/package.json"])
          panel.view.unmount()
        })

        it("runs another paste of a copy meanwhile, the row busy until both end", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await fromMenu(item(panel, "package.json"), "Copy")
          fake.hold()

          await fromMenu(item(panel, "docs"), "Paste")
          await fromMenu(panel.view.container.querySelector("[role=tree]")!, "Paste")
          expect(fake.changes).toEqual(["copy package.json docs", "copy package.json "])
          expect(busyRows(panel)).toEqual(["package.json"])
          fake.release()
          await settle()

          expect(busyRows(panel)).toEqual([])
          expect(panel.rows()).toContain("package copy.json")
          expect(at(panel, "docs/package.json")).not.toBeNull()
          panel.view.unmount()
        })
      })

      context("afterwards", () => {
        it("says which pattern hides an entry pasted, leaving the focus on the row it was asked on", async () => {
          const fake = changing()
          const panel = await mountChanging(fake, { hiding: { exclude: { "docs/*.json": true } } })
          act(() => item(panel, "package.json").focus())
          await chord(item(panel, "package.json"), "c")
          act(() => item(panel, "docs").focus())

          await chord(item(panel, "docs"), "v")

          expect(alert(panel)).toBe(
            "Copied to docs/package.json, which the pattern docs/*.json hides.",
          )
          expect(document.activeElement).toBe(item(panel, "docs"))
          panel.view.unmount()
        })

        it("reads the folders pasted into and from again when a paste fails", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await panel.click("docs")
          await fromMenu(item(panel, "package.json"), "Copy")
          fake.refuse("The disk is full.")
          fake.folders.length = 0

          await fromMenu(item(panel, "docs"), "Paste")

          expect(fake.folders.toSorted()).toEqual(["", "docs"])
          expect(alert(panel)).toBe("Couldn't copy package.json into docs: The disk is full.")
          panel.view.unmount()
        })

        it("leaves the focus and the selection where the person moved them while it ran", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await panel.click("docs")
          act(() => item(panel, "package.json").focus())
          await chord(item(panel, "package.json"), "c")
          fake.hold()

          await chord(item(panel, "docs"), "v")
          await press(item(panel, "docs"), "ArrowDown")
          await press(item(panel, "readme.md"), "ArrowDown")
          await panel.click("readme.md")
          fake.release()
          await settle()

          expect(at(panel, "docs/package.json")).not.toBeNull()
          expect(document.activeElement).toBe(item(panel, "src"))
          expect(item(panel, "readme.md").getAttribute("aria-selected")).toBe("true")
          panel.view.unmount()
        })

        it("says a paste that fails in a later showing, and none that fails while hidden", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await fromMenu(item(panel, "package.json"), "Copy")
          fake.refuse("The disk is full.")
          fake.hold()
          await fromMenu(item(panel, "docs"), "Paste")
          await panel.show(false)
          await panel.show(true)
          fake.release()
          await settle()
          expect(alert(panel)).toBe("Couldn't copy package.json into docs: The disk is full.")

          act(() =>
            panel.view.container.querySelector<HTMLElement>("[aria-label=Dismiss]")!.click(),
          )
          fake.hold()
          await fromMenu(item(panel, "docs"), "Paste")
          await panel.show(false)
          fake.release()
          await settle()
          await panel.show(true)

          expect(alert(panel)).toBeNull()
          panel.view.unmount()
        })
      })

      context("when the connection drops before the backend answers", () => {
        it("says a paste may have been done, and reads the folders, which show what was", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await panel.click("docs")
          await fromMenu(item(panel, "package.json"), "Copy")
          fake.drop(true)

          await fromMenu(item(panel, "docs"), "Paste")

          expect(alert(panel)).toBe(
            "Novadeck lost its connection before it heard whether it could copy package.json into docs; it may have been done, or may still be under way.",
          )
          expect(at(panel, "docs/package.json")).not.toBeNull()
          panel.view.unmount()
        })

        it("takes a cut as moved where the folders show it moved, and has what shows it follow", async () => {
          const fake = changing()
          const moves: string[] = []
          const panel = await mountChanging(fake, {
            onMoved: (from, to) => void moves.push(`${from} ${to}`),
          })
          await fromMenu(item(panel, "package.json"), "Cut")
          fake.drop(true)

          await fromMenu(item(panel, "docs"), "Paste")

          expect(alert(panel)).toBeNull()
          expect(moves).toEqual(["package.json docs/package.json"])
          expect(cutRows(panel)).toEqual([])
          expect(at(panel, "docs/package.json")!.getAttribute("aria-selected")).toBe("true")
          panel.view.unmount()
        })

        it("keeps a cut the folders show where it was, saying it may be under way", async () => {
          const fake = changing()
          const moves: string[] = []
          const panel = await mountChanging(fake, {
            onMoved: (from, to) => void moves.push(`${from} ${to}`),
          })
          await fromMenu(item(panel, "package.json"), "Cut")
          fake.drop(false)

          await fromMenu(item(panel, "docs"), "Paste")

          expect(alert(panel)).toBe(
            "Novadeck lost its connection before it heard whether it could move package.json into docs; it may have been done, or may still be under way.",
          )
          expect(moves).toEqual([])
          expect(cutRows(panel)).toEqual(["package.json"])
          panel.view.unmount()
        })

        it("takes a rename as made where the folders show it, and reads its folder where they don't", async () => {
          const fake = changing()
          const moves: string[] = []
          const panel = await mountChanging(fake, {
            onMoved: (from, to) => void moves.push(`${from} ${to}`),
          })
          await fromMenu(item(panel, "package.json"), "Rename…")
          type("manifest.json")
          fake.drop(true)
          await press(field()!, "Enter")
          expect(alert(panel)).toBeNull()
          expect(moves).toEqual(["package.json manifest.json"])

          await fromMenu(item(panel, "manifest.json"), "Rename…")
          type("app.json")
          fake.drop(false)
          fake.folders.length = 0
          await press(field()!, "Enter")

          expect(alert(panel)).toBe(
            "Novadeck lost its connection before it heard whether it could rename manifest.json to app.json; it may have been done, or may still be under way.",
          )
          expect(fake.folders).toContain("")
          expect(panel.rows()).toContain("manifest.json")
          panel.view.unmount()
        })

        it("says a delete may have been done, and reads its folder, which shows what was", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await fromMenu(item(panel, "package.json"), "Delete")
          fake.drop(true)

          act(() => dialogButton("Delete").click())
          await settle()

          expect(alert(panel)).toBe(
            "Novadeck lost its connection before it heard whether it could delete package.json; it may have been done, or may still be under way.",
          )
          expect(panel.rows()).not.toContain("package.json")
          panel.view.unmount()
        })
      })

      context("when what was cut or copied changes", () => {
        it("lets a copy go once it is deleted", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await fromMenu(item(panel, "package.json"), "Copy")

          await fromMenu(item(panel, "package.json"), "Delete")
          act(() => dialogButton("Delete").click())
          await settle()

          await rightClick(item(panel, "docs"))
          expect(greyed()).toEqual(["Paste"])
          await closeMenu()
          panel.view.unmount()
        })

        it("follows a cut whose folder is renamed, and moves it from there", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await panel.click("docs")
          await fromMenu(item(panel, "readme.md"), "Cut")

          await fromMenu(item(panel, "docs"), "Rename…")
          type("guides")
          await press(field()!, "Enter")
          expect(cutRows(panel)).toEqual(["guides/readme.md"])
          await fromMenu(panel.view.container.querySelector("[role=tree]")!, "Paste")

          expect(fake.changes).toEqual(["move docs guides", "move guides/readme.md readme.md"])
          panel.view.unmount()
        })

        it("follows a copy that is renamed, and copies it from there", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await fromMenu(item(panel, "package.json"), "Copy")

          await fromMenu(item(panel, "package.json"), "Rename…")
          type("manifest.json")
          await press(field()!, "Enter")
          await fromMenu(item(panel, "docs"), "Paste")

          expect(fake.changes).toEqual([
            "move package.json manifest.json",
            "copy manifest.json docs",
          ])
          panel.view.unmount()
        })

        it("lets a cut go whose folder went, once the folder holding that is read again", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await panel.click("docs")
          await fromMenu(item(panel, "readme.md"), "Cut")
          fake.lose("docs")

          await panel.endTurn()

          expect(cutRows(panel)).toEqual([])
          await rightClick(panel.view.container.querySelector("[role=tree]")!)
          expect(greyed()).toEqual(["Paste"])
          await closeMenu()
          panel.view.unmount()
        })
      })

      context("with the keyboard", () => {
        it("cuts, copies and pastes the focused row with Ctrl and X, C and V, keeping them from the workspace and the system's clipboard", async () => {
          const copied = clipboard()
          const fake = changing()
          const panel = await mountChanging(fake)
          const reached: KeyboardEvent[] = []
          const listen = (event: KeyboardEvent): void => void reached.push(event)
          window.addEventListener("keydown", listen)
          act(() => item(panel, "package.json").focus())

          const presses = [
            await chord(item(panel, "package.json"), "c"),
            await chord(item(panel, "docs"), "v"),
            await chord(at(panel, "package.json")!, "x"),
            await chord(item(panel, "src"), "v"),
          ]
          window.removeEventListener("keydown", listen)

          expect(fake.changes).toEqual([
            "copy package.json docs",
            "move package.json src/package.json",
          ])
          expect(presses.map((event) => event.defaultPrevented)).toEqual([true, true, true, true])
          expect(reached).toEqual([])
          expect(copied).toEqual([])
          panel.view.unmount()
        })

        it("on macOS cuts, copies and pastes with ⌘ alone, by the letter, or the key's place where it types none", async () => {
          const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
          const fake = changing()
          const panel = await mountChanging(fake)

          await chord(item(panel, "package.json"), "x", { ctrlKey: false, metaKey: true })
          await chord(item(panel, "docs"), "v")
          expect(fake.changes).toEqual([])
          // Dvorak types k where V is: ⌘K is the workspace's, not a paste.
          const workspaces = await press(item(panel, "docs"), "k", { code: "KeyV", metaKey: true })
          expect([workspaces.defaultPrevented, fake.changes]).toEqual([false, []])
          // A Russian layout types м where V is.
          await press(item(panel, "docs"), "м", { code: "KeyV", metaKey: true })

          expect(fake.changes).toEqual(["move package.json docs/package.json"])
          platform.mockRestore()
          panel.view.unmount()
        })

        it("pastes once for a paste held down", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await chord(item(panel, "package.json"), "c")

          await chord(item(panel, "docs"), "v")
          await chord(item(panel, "docs"), "v", { repeat: true })

          expect(fake.changes).toEqual(["copy package.json docs"])
          panel.view.unmount()
        })

        it("keeps them from the workspace on a row only an agent's work has, doing nothing", async () => {
          const fake = changing()
          const panel = await mountChanging(fake, { work: work() })
          const reached: string[] = []
          const listen = (event: KeyboardEvent): void => void reached.push(event.key)
          window.addEventListener("keydown", listen)

          await chord(item(panel, "new.ts"), "x")
          await chord(item(panel, "new.ts"), "c")
          window.removeEventListener("keydown", listen)

          expect(reached).toEqual([])
          expect(cutRows(panel)).toEqual([])
          panel.view.unmount()
        })

        it("keeps them from the workspace where the backend changes nothing, doing nothing", async () => {
          const panel = await mount(undefined)
          const reached: string[] = []
          const listen = (event: KeyboardEvent): void => void reached.push(event.key)
          window.addEventListener("keydown", listen)

          const presses = [
            await chord(item(panel, "package.json"), "x"),
            await chord(item(panel, "package.json"), "c"),
            await chord(item(panel, "docs"), "v"),
          ]
          window.removeEventListener("keydown", listen)

          expect(presses.map((event) => event.defaultPrevented)).toEqual([true, true, true])
          expect(reached).toEqual([])
          expect(cutRows(panel)).toEqual([])
          panel.view.unmount()
        })

        it("leaves them to the field a name is typed in", async () => {
          const fake = changing()
          const panel = await mountChanging(fake)
          await chord(item(panel, "package.json"), "c")
          await fromMenu(item(panel, "docs"), "New File…")

          const pasted = await chord(field()!, "v")

          expect(pasted.defaultPrevented).toBe(false)
          expect(field()).not.toBeNull()
          expect(fake.changes).toEqual([])
          panel.view.unmount()
        })

        it("lets a cut go on Escape before the agents kept, and leaves the next Escape to them", async () => {
          const fake = changing()
          const panel = await mountChanging(fake, { work: work() })
          act(() =>
            Array.from(panel.view.container.querySelectorAll<HTMLElement>(".files-agent"))
              .find((each) => each.textContent === "@moth")!
              .click(),
          )
          await chord(item(panel, "useCart.ts"), "x")
          expect(cutRows(panel)).toEqual(["src/cart/useCart.ts"])

          const first = await press(item(panel, "useCart.ts"), "Escape")
          expect(cutRows(panel)).toEqual([])
          expect(kept(panel)).toEqual(["@moth"])
          await press(item(panel, "useCart.ts"), "Escape")

          expect(first.defaultPrevented).toBe(false)
          expect(kept(panel)).toEqual([])
          panel.view.unmount()
        })
      })
    })
  })

  context("when the person uses the keyboard", () => {
    const press = (panel: Awaited<ReturnType<typeof mount>>, name: string, key: string): void => {
      const button = panel.row(name).querySelector<HTMLElement>("[role=treeitem]")!
      act(() => {
        button.focus()
        button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
      })
    }
    const focused = (): string | null =>
      document.activeElement?.closest(".files-row")?.querySelector(".files-name")?.textContent ??
      null

    it("keeps one tab stop and moves through the rows with the arrows", async () => {
      const panel = await mount(work())
      document.body.append(panel.view.container)
      const stops = panel.view.container.querySelectorAll("[role=treeitem][tabindex='0']")
      expect(stops).toHaveLength(1)

      press(panel, "docs", "ArrowDown")
      expect(focused()).toBe("src")
      press(panel, "src", "End")
      expect(focused()).toBe("package.json")
      press(panel, "package.json", "Home")
      expect(focused()).toBe("docs")
      expect(panel.view.container.querySelectorAll("[role=treeitem][tabindex='0']")).toHaveLength(1)
      await nextFrame()
      panel.view.unmount()
    })

    it("opens and closes folders and walks to the parent with Right and Left", async () => {
      const panel = await mount(work())
      document.body.append(panel.view.container)

      press(panel, "docs", "ArrowRight")
      await panel.settle()
      expect(panel.rows()).toContain("readme.md")
      press(panel, "docs", "ArrowRight")
      expect(focused()).toBe("readme.md")
      press(panel, "readme.md", "ArrowLeft")
      expect(focused()).toBe("docs")
      press(panel, "docs", "ArrowLeft")
      expect(panel.rows()).not.toContain("readme.md")
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when the keyboard meets a folder with no rows inside", () => {
    it("keeps ArrowRight on an open empty folder where it is", async () => {
      const panel = await mount(
        undefined,
        undefined,
        undefined,
        backend(undefined, [...files, "dist/"]),
      )
      document.body.append(panel.view.container)
      await panel.click("dist")
      const button = panel.row("dist").querySelector<HTMLElement>("[role=treeitem]")!

      act(() => {
        button.focus()
        for (const _ of [1, 2])
          button.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
          )
      })

      expect(document.activeElement).toBe(button)
      await nextFrame()
      panel.view.unmount()
    })

    it("leaves a repeated Enter on a folder unhandled by the click, so a held key toggles it once", async () => {
      const panel = await mount(undefined)
      const button = panel.row("docs").querySelector<HTMLElement>("[role=treeitem]")!
      const enter = (repeat: boolean): KeyboardEvent => {
        const event = new KeyboardEvent("keydown", {
          key: "Enter",
          repeat,
          bubbles: true,
          cancelable: true,
        })
        act(() => void button.dispatchEvent(event))
        return event
      }

      // The first Enter is the button's own click; a repeat is stopped from becoming another.
      expect(enter(false).defaultPrevented).toBe(false)
      expect(enter(true).defaultPrevented).toBe(true)
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when a folder never answers", () => {
    it("is given up on under StrictMode too, whose remount starts the reads over", async () => {
      vi.useFakeTimers()
      const view = render(
        createElement(
          StrictMode,
          null,
          createElement(FilesPanel, {
            project: undefined,
            directory,
            list: () => new Promise<FolderListing>(() => {}),
            exclude: {},
            onExcludeSettings: () => {},
            turn: 0,
            onOpenFile: () => Promise.resolve(),
            selectedHandle: undefined,
            roster: [],
            squads: [],
            active: true,
            visible: true,
            onHide: () => {},
          }),
        ),
      )
      await settle()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(readTimeoutMs + 1)
      })

      expect(view.container.textContent).toContain("Can't read this project's files.")
      view.unmount()
    })

    it("is given up on as unreadable, and can be read again", async () => {
      vi.useFakeTimers()
      let hang = true
      const reads = backend((folder, listing) =>
        folder === "docs" && hang ? new Promise<FolderListing>(() => {}) : listing,
      )
      const panel = await mount(undefined, undefined, undefined, reads)
      await panel.click("docs")
      expect(panel.view.container.querySelector("[data-note=failed]")).toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(readTimeoutMs + 1)
      })
      expect(panel.view.container.querySelector("[data-note=failed]")).not.toBeNull()

      hang = false
      await panel.endTurn()
      expect(panel.rows()).toContain("readme.md")
      panel.view.unmount()
    })
  })

  context("when a row is too narrow for its name beside two chips", () => {
    const deep = "a/b/c/CheckoutSummaryPanel.tsx"
    const crowded = (touched: Record<string, number>): FilesProject => ({
      changes: { [deep]: { kind: "modified", touched }, "short.ts": { kind: "modified", touched } },
      writing: {},
    })
    const shown = (panel: Awaited<ReturnType<typeof mount>>, name: string): string[] =>
      Array.from(panel.row(name).querySelectorAll(".files-chip")).map((el) => el.textContent ?? "")
    const more = (panel: Awaited<ReturnType<typeof mount>>, name: string): string | undefined =>
      panel.row(name).querySelector(".files-more")?.textContent ?? undefined

    it("folds a long deep name to one chip and a count when the tree is narrow", async () => {
      treeWidth = 260
      const panel = await mount(crowded({ moth: recent, crow: recent - 1000, wren: recent - 2000 }))

      expect(shown(panel, "CheckoutSummaryPanel.tsx")).toEqual(["@moth"])
      expect(more(panel, "CheckoutSummaryPanel.tsx")).toBe("+2")
      expect(
        panel.row("CheckoutSummaryPanel.tsx").querySelector<HTMLElement>(".files-more")?.title,
      ).toContain("@wren")
      expect(panel.row("CheckoutSummaryPanel.tsx").querySelector("button")?.ariaLabel).toContain(
        "@crow",
      )
      await nextFrame()
      panel.view.unmount()
    })

    it("keeps two chips on the same row when the tree is wide", async () => {
      treeWidth = 400
      const panel = await mount(crowded({ moth: recent, crow: recent - 1000, wren: recent - 2000 }))

      expect(shown(panel, "CheckoutSummaryPanel.tsx")).toEqual(["@moth", "@crow"])
      expect(more(panel, "CheckoutSummaryPanel.tsx")).toBe("+1")
      await nextFrame()
      panel.view.unmount()
    })

    it("keeps two chips on a short name even when the tree is narrow", async () => {
      treeWidth = 228
      const panel = await mount(crowded({ moth: recent, crow: recent - 1000 }))

      expect(shown(panel, "short.ts")).toEqual(["@moth", "@crow"])
      expect(more(panel, "short.ts")).toBeUndefined()
      await nextFrame()
      panel.view.unmount()
    })

    it("folds and unfolds as the sidebar is resized", async () => {
      treeWidth = 400
      const panel = await mount(crowded({ moth: recent, crow: recent - 1000 }))
      expect(shown(panel, "CheckoutSummaryPanel.tsx")).toHaveLength(2)

      resizeTree(228)
      expect(shown(panel, "CheckoutSummaryPanel.tsx")).toEqual(["@moth"])
      expect(more(panel, "CheckoutSummaryPanel.tsx")).toBe("+1")

      resizeTree(400)
      expect(shown(panel, "CheckoutSummaryPanel.tsx")).toHaveLength(2)
      await nextFrame()
      panel.view.unmount()
    })

    it("never changes a row with one agent", async () => {
      treeWidth = 120
      const panel = await mount(crowded({ moth: recent }))

      expect(shown(panel, "CheckoutSummaryPanel.tsx")).toEqual(["@moth"])
      expect(more(panel, "CheckoutSummaryPanel.tsx")).toBeUndefined()
      await nextFrame()
      panel.view.unmount()
    })

    it("measures the name on a canvas in the font of its computed longhands", async () => {
      const fonts: string[] = []
      measured = {
        set font(value: string) {
          fonts.push(value)
        },
        // Wide enough that two chips cannot sit beside "short.ts" at this width.
        measureText: () => ({ width: 300 }),
      } as never
      const real = window.getComputedStyle.bind(window)
      vi.spyOn(window, "getComputedStyle").mockImplementation((element, ...rest) =>
        element.classList.contains("files-name")
          ? ({
              fontStyle: "normal",
              fontWeight: "450",
              fontSize: "13px",
              fontFamily: "Measured Sans",
              font: "",
            } as CSSStyleDeclaration)
          : // The chips' font stays unknown, so they are estimated and nothing of them is kept.
            element.classList.contains("handle-chip")
            ? ({ fontSize: "", fontFamily: "" } as CSSStyleDeclaration)
            : real(element, ...rest),
      )
      treeWidth = 400
      const panel = await mount(crowded({ moth: recent, crow: recent - 1000 }))

      expect(fonts).toContain("normal 450 13px Measured Sans")
      expect(shown(panel, "short.ts")).toEqual(["@moth"])
      expect(more(panel, "short.ts")).toBe("+1")
      await nextFrame()
      panel.view.unmount()
    })

    it("keeps the room for a trail that has aged out, so the fold never depends on the time", async () => {
      // "short.ts" and two chips fit in 190px without a mark, and not with one.
      treeWidth = 190
      const old = Date.now() - 20 * 60_000
      const fresh = await mount(crowded({ moth: recent, crow: recent - 1000 }))
      const aged = await mount(crowded({ moth: old, crow: old - 1000 }))

      expect(shown(fresh, "short.ts")).toHaveLength(1)
      expect(shown(aged, "short.ts")).toHaveLength(1)
      const trail = (panel: Awaited<ReturnType<typeof mount>>) =>
        panel.row("short.ts").querySelector<HTMLElement>(".files-trail")!
      expect(trail(fresh).style.visibility).toBe("")
      expect(trail(aged).style.visibility).toBe("hidden")
      await nextFrame()
      fresh.view.unmount()
      aged.view.unmount()
    })

    context("when the chips and the theme set their own fonts", () => {
      // A chip in "Wide Mono" measures 90px a text, any other font 8px.
      let family = "Narrow Mono"
      const measureFonts = (): void => {
        measured = {
          font: "",
          measureText(this: { font: string }) {
            return { width: this.font.includes("Wide Mono") ? 90 : 8 }
          },
        } as never
        const real = window.getComputedStyle.bind(window)
        vi.spyOn(window, "getComputedStyle").mockImplementation((element, ...rest) =>
          element.classList.contains("files-name")
            ? ({
                fontStyle: "normal",
                fontWeight: "400",
                fontSize: "13px",
                fontFamily: "Narrow Name",
                font: "",
              } as CSSStyleDeclaration)
            : element.classList.contains("handle-chip") || element.classList.contains("files-more")
              ? ({
                  fontStyle: "normal",
                  fontWeight: "400",
                  fontSize: "11px",
                  fontFamily: family,
                  font: "",
                } as CSSStyleDeclaration)
              : real(element, ...rest),
        )
      }
      afterEach(() => {
        vi.restoreAllMocks()
        family = "Narrow Mono"
        delete document.documentElement.dataset["theme"]
      })

      it("folds by the width the chips measure in their own font, not by an estimate", async () => {
        measureFonts()
        family = "Wide Mono"
        treeWidth = 220
        const panel = await mount(crowded({ moth: recent, crow: recent - 1000 }))

        // The estimate (6.6px a glyph) would keep both chips of "short.ts" here.
        expect(shown(panel, "short.ts")).toEqual(["@moth"])
        await nextFrame()
        panel.view.unmount()
      })

      it("folds again when a theme changes the fonts", async () => {
        measureFonts()
        treeWidth = 220
        const panel = await mount(crowded({ moth: recent, crow: recent - 1000 }))
        expect(shown(panel, "short.ts")).toHaveLength(2)

        family = "Wide Mono"
        await act(async () => {
          document.documentElement.dataset["theme"] = "phosphor"
          await nextFrame()
        })
        expect(shown(panel, "short.ts")).toEqual(["@moth"])

        family = "Narrow Mono"
        await act(async () => {
          document.documentElement.dataset["theme"] = "coolant"
          await nextFrame()
        })
        expect(shown(panel, "short.ts")).toHaveLength(2)
        await nextFrame()
        panel.view.unmount()
      })
    })

    it("stops lighting an agent whose chip a narrower tree folded away", async () => {
      treeWidth = 400
      const panel = await mount(crowded({ moth: recent, crow: recent - 1000 }))
      const second = panel.row("CheckoutSummaryPanel.tsx").querySelectorAll(".files-chip")[1]!
      act(() => void second.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })))
      // The row the pointer was on folds crow away, though the short row still shows its chip.
      resizeTree(228)
      expect(panel.view.container.querySelector("[role=tree]")?.hasAttribute("data-lit")).toBe(
        false,
      )
      await nextFrame()
      panel.view.unmount()
    })
  })

  context("when the checkout is behind its remote's main", () => {
    const behind = { branch: "main", remote: "origin/main", count: 3 }
    const stand = (state: Awaited<ReturnType<Checkout["read"]>>) => {
      let current = state
      const update = vi.fn<Checkout["update"]>(async () => ({ ok: true }))
      return {
        update,
        set: (next: typeof current) => (current = next),
        checkout: { read: async () => current, update } satisfies Checkout,
      }
    }
    const mountWith = (checkout: Checkout) =>
      mount(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        checkout,
      )

    it("says how far, and updates on request", async () => {
      const held = stand({ behind, moved: 0, head: "a" })
      const panel = await mountWith(held.checkout)
      const line = panel.view.container.querySelector(".files-behind")!
      expect(line.textContent).toContain("main is 3 behind origin")
      act(() => line.querySelector<HTMLButtonElement>(".files-update")!.click())
      await panel.settle()
      expect(held.update).toHaveBeenCalledTimes(1)
      await nextFrame()
      panel.view.unmount()
    })

    it("says nothing where the checkout is up to date", async () => {
      const panel = await mountWith(stand({ behind: null, moved: 0, head: "a" }).checkout)
      expect(panel.view.container.querySelector(".files-behind")).toBeNull()
      await nextFrame()
      panel.view.unmount()
    })

    it("gives git's reason when the update is refused, and lets it be tried again", async () => {
      const held = stand({ behind, moved: 0, head: "a" })
      held.update.mockResolvedValueOnce({ ok: false, said: "Your local changes would be lost." })
      const panel = await mountWith(held.checkout)
      act(() => panel.view.container.querySelector<HTMLButtonElement>(".files-update")!.click())
      await panel.settle()
      const line = panel.view.container.querySelector(".files-behind")!
      expect(line.textContent).toContain("Can't update: Your local changes would be lost.")
      expect(line.querySelector(".files-update")?.textContent).toBe("Retry")
      await nextFrame()
      panel.view.unmount()
    })

    it("reads the folders again when the backend moved the checkout", async () => {
      vi.useFakeTimers()
      const held = stand({ behind: null, moved: 0, head: "a" })
      const panel = await mountWith(held.checkout)
      const before = panel.reads.folders.length
      held.set({ behind: null, moved: 1, head: "a" })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(checkoutPollMs)
      })
      await panel.settle()
      expect(panel.reads.folders.length).toBeGreaterThan(before)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(checkoutPollMs)
      })
      const unchanged = panel.reads.folders.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(checkoutPollMs)
      })
      expect(panel.reads.folders.length).toBe(unchanged)
      panel.view.unmount()
    })

    it("reads the folders again when the commit it is at changes, as with the person's own pull", async () => {
      vi.useFakeTimers()
      const held = stand({ behind: null, moved: 0, head: "a" })
      const panel = await mountWith(held.checkout)
      const before = panel.reads.folders.length
      held.set({ behind: null, moved: 0, head: "b" })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(checkoutPollMs)
      })
      await panel.settle()
      expect(panel.reads.folders.length).toBeGreaterThan(before)
      panel.view.unmount()
    })

    it("asks again only once the last answer is in", async () => {
      vi.useFakeTimers()
      let asked = 0
      const slow: Checkout = {
        read: () => {
          asked += 1
          return new Promise(() => {})
        },
        update: async () => ({ ok: true }),
      }
      const panel = await mountWith(slow)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(checkoutPollMs * 3)
      })
      expect(asked).toBe(1)
      panel.view.unmount()
    })

    it("forgets a refusal once there is nothing to update", async () => {
      vi.useFakeTimers()
      const held = stand({ behind, moved: 0, head: "a" })
      held.update.mockResolvedValueOnce({ ok: false, said: "Nope." })
      const panel = await mountWith(held.checkout)
      act(() => panel.view.container.querySelector<HTMLButtonElement>(".files-update")!.click())
      await panel.settle()
      expect(panel.view.container.querySelector(".files-behind")?.textContent).toContain("Nope.")
      held.set({ behind: null, moved: 0, head: "b" })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(checkoutPollMs)
      })
      held.set({ behind, moved: 0, head: "c" })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(checkoutPollMs)
      })
      await panel.settle()
      expect(panel.view.container.querySelector(".files-behind")?.textContent).not.toContain(
        "Nope.",
      )
      panel.view.unmount()
    })
  })

  context("when the tree is long", () => {
    // 300 files at the root: 26px each, so a 260px view holds ten of them.
    const many = Array.from({ length: 300 }, (_, at) => `f${String(at).padStart(3, "0")}.ts`)
    const long = async (height: number) => {
      treeHeight = height
      const panel = await mount(undefined, undefined, undefined, backend(undefined, many))
      const tree = panel.view.container.querySelector<HTMLElement>("[role=tree]")!
      const scrollTo = (top: number): void => {
        act(() => {
          tree.scrollTop = top
          tree.dispatchEvent(new Event("scroll"))
        })
      }
      const press = (path: string, key: string): void => {
        const button = panel.view.container.querySelector<HTMLElement>(`[data-path="${path}"]`)!
        act(() => {
          button.focus()
          button.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
          )
        })
      }
      return { panel, tree, scrollTo, press }
    }

    it("draws only the rows in view and a few past each edge, in a box as tall as the tree", async () => {
      const { panel, tree } = await long(260)

      expect(panel.rows()).toHaveLength(20)
      expect(panel.rows()[0]).toBe("f000.ts")
      expect(tree.querySelector<HTMLElement>(".files-rows")!.style.height).toBe(`${300 * 26}px`)
      panel.view.unmount()
    })

    it("draws other rows as the tree scrolls", async () => {
      const { panel, scrollTo } = await long(260)

      scrollTo(26 * 150)

      // Thirty in and around the view, and the first row, which holds the Tab stop.
      expect(panel.rows()).toHaveLength(31)
      expect(panel.rows()).toContain("f150.ts")
      expect(panel.rows()).not.toContain("f139.ts")
      expect(panel.row("f150.ts").parentElement!.style.top).toBe(`${150 * 26}px`)
      panel.view.unmount()
    })

    it("tells a screen reader the tree's shape despite the rows it does not draw", async () => {
      const { panel, scrollTo } = await long(260)
      scrollTo(26 * 150)

      const item = panel.row("f150.ts").querySelector("[role=treeitem]")!
      expect(item.getAttribute("aria-posinset")).toBe("151")
      expect(item.getAttribute("aria-setsize")).toBe("300")
      expect(item.getAttribute("aria-level")).toBe("1")
      panel.view.unmount()
    })

    it("moves focus to a row that is not drawn, scrolling it into view first", async () => {
      const { panel, tree, press } = await long(260)

      press("f000.ts", "End")

      expect(document.activeElement?.getAttribute("data-path")).toBe("f299.ts")
      expect(tree.scrollTop).toBeGreaterThan(26 * 280)
      expect(panel.rows()).toContain("f299.ts")
      press("f299.ts", "Home")
      expect(document.activeElement?.getAttribute("data-path")).toBe("f000.ts")
      expect(tree.scrollTop).toBe(0)
      panel.view.unmount()
    })

    it("keeps the focused row drawn when it scrolls out of the view", async () => {
      const { panel, scrollTo } = await long(260)
      const first = panel.view.container.querySelector<HTMLElement>("[data-path='f000.ts']")!
      act(() => first.focus())

      scrollTo(26 * 150)

      expect(panel.rows()).toContain("f000.ts")
      expect(panel.view.container.querySelector("[data-path='f000.ts']")).toBe(first)
      expect(first.tabIndex).toBe(0)
      panel.view.unmount()
    })

    it("draws the last rows when the tree shrinks under a scroll, and keeps focus", async () => {
      const { panel, scrollTo } = await long(260)
      const last = panel.view.container.querySelector<HTMLElement>("[data-path='f000.ts']")!
      act(() => last.focus())
      scrollTo(26 * 250)
      // The browser clamps the scroll as the tree shrinks, but not before the next render.
      const reads = backend(undefined, many.slice(0, 40))
      panel.view.rerender(
        createElement(FilesPanel, {
          project: undefined,
          directory,
          exclude: {},
          onExcludeSettings: () => {},
          list: reads.list,
          turn: 1,
          onOpenFile: () => Promise.resolve(),
          selectedHandle: undefined,
          roster: [],
          squads: [],
          active: true,
          visible: true,
          onHide: () => {},
        }),
      )
      await panel.settle()

      expect(panel.rows().length).toBeGreaterThan(10)
      expect(panel.rows()).toContain("f039.ts")
      expect(panel.rows()).toContain("f000.ts")
      expect(document.activeElement).toBe(last)
      panel.view.unmount()
    })

    it("keeps the Tab stop below the view drawn, so Tab enters the tree there", async () => {
      const { panel, scrollTo, press } = await long(260)
      press("f000.ts", "End")
      scrollTo(0)

      const stop = panel.view.container.querySelector<HTMLElement>("[data-path='f299.ts']")!
      expect(stop.tabIndex).toBe(0)
      expect(panel.view.container.querySelectorAll("[role=treeitem][tabindex='0']")).toHaveLength(1)
      panel.view.unmount()
    })

    it("counts a note among its siblings", async () => {
      const panel = await mount(
        undefined,
        undefined,
        undefined,
        backend((folder, listing) => (folder === "" ? { ...listing, truncated: true } : listing)),
      )

      const note = panel.view.container.querySelector("[data-note=truncated]")!
      expect(note.getAttribute("aria-posinset")).toBe("4")
      expect(note.getAttribute("aria-setsize")).toBe("4")
      panel.view.unmount()
    })

    it("draws no rows while the panel has no height or is not measured", async () => {
      const { panel } = await long(0)

      expect(panel.rows()).toEqual([])
      resizeTree(0, 260)
      expect(panel.rows()).toHaveLength(20)
      resizeTree(0, 0)
      expect(panel.rows()).toEqual([])
      panel.view.unmount()
    })
  })
})
