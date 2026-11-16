import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Install, Model } from "@novadeck/harness-core/harness"
import type { AgentName, Project } from "@novadeck/protocol"

import { DomainError } from "../errors.js"
import { harnesses } from "../harnesses/registry.js"
import { describe, expect, it } from "../test.js"
import { nudgeLine, startLine } from "./brief.js"
import { tourFolder, tourMarker } from "./folder.js"
import { Tour, withinFolder, type TourHost } from "./tour.js"

// Where a harness lives, for the model lists the tour picks from: Novadeck's own lists ignore it.
const install: Install = { env: {}, home: "/home/x", platform: "linux", plugin: "/plugins" }

const conflict = (error: unknown): boolean =>
  error instanceof DomainError && error.code === "CONFLICT"

const tourIn = (
  home: string,
  options: {
    projects?: Project[]
    connected?: readonly AgentName[]
    notices?: [string, string][]
    shown?: readonly string[]
    models?: readonly Model[]
    // Models by harness, over the harnesses' own lists.
    lists?: Partial<Record<AgentName, readonly Model[]>>
    git?: string
    account?: string
    // How each removal goes; at once by default.
    removal?: () => Promise<void>
    // Each terminal's folder; the tour's own by default.
    cwds?: Readonly<Record<string, string>>
  } = {},
) => {
  const projects = options.projects ?? []
  const removed: string[] = []
  const host: TourHost = {
    home,
    connected: (agent) => Promise.resolve((options.connected ?? ["claude"]).includes(agent)),
    models: (agent) =>
      options.lists?.[agent]
        ? Promise.resolve(options.lists[agent])
        : options.models
          ? Promise.resolve(options.models)
          : harnesses[agent].launch.models(install),
    install: () => Promise.resolve(undefined),
    projects: {
      list: () => projects.filter(({ id }) => !removed.includes(id)),
      remove: (id) => {
        if (removed.includes(id)) return Promise.reject(new DomainError("NOT_FOUND"))
        removed.push(id)
        return options.removal?.() ?? Promise.resolve()
      },
    },
    notice: (terminalId, text) => {
      if (!(options.shown ?? []).includes(terminalId)) return false
      options.notices?.push([terminalId, text])
      return true
    },
    cwdOf: (terminalId) => options.cwds?.[terminalId] ?? tourFolder(home),
    gitName: () => Promise.resolve(options.git),
    account: () => options.account,
  }
  return { tour: new Tour(host), removed }
}

const project = (id: string, cwd: string): Project => ({ id, name: id, cwd, pinned: false })

const scratchHome = async (resources: { defer: (cleanup: () => Promise<void>) => void }) => {
  const home = await mkdtemp(join(tmpdir(), "novadeck-tour-home-"))
  resources.defer(() => rm(home, { recursive: true, force: true }))
  return home
}

describe("readying the tour", () => {
  it("writes the brief in the folder and answers the launch line", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home)
    const prepared = await tour.prepare("claude")
    const directory = tourFolder(home)
    expect(prepared).toMatchObject({ directory, brief: "launch", model: "haiku", removed: [] })
    expect(prepared.command).toMatch(/^claude --model haiku /)
    expect((await readdir(directory)).toSorted()).toEqual(
      [".claude", "AGENTS.md", "CLAUDE.md", tourMarker].toSorted(),
    )
    expect(await readFile(join(directory, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n")
    expect(JSON.parse(await readFile(join(directory, ".claude", "settings.json"), "utf8"))).toEqual(
      {
        permissions: { defaultMode: "acceptEdits" },
      },
    )
  })

  it("removes the projects open at its folder, and no other", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour, removed } = tourIn(home, {
      projects: [project("old-tour", tourFolder(home)), project("mine", join(home, "code"))],
    })
    const prepared = await tour.prepare("claude")
    expect(prepared.removed).toEqual(["old-tour"])
    expect(removed).toEqual(["old-tour"])
  })

  it("refuses an agent Novadeck isn't connected to, changing nothing", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour, removed } = tourIn(home, {
      connected: ["claude"],
      projects: [project("old-tour", tourFolder(home))],
    })
    await expect(tour.prepare("codex")).rejects.toSatisfy(conflict)
    expect(removed).toEqual([])
    await expect(readdir(tourFolder(home))).rejects.toThrow()
  })

  it("removes a project inside its folder too", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home, {
      projects: [project("inside", join(tourFolder(home), "site"))],
    })
    await expect(tour.prepare("claude")).resolves.toMatchObject({ removed: ["inside"] })
  })

  it("empties its folder only once a removal under way has closed its terminals", async ({
    resources,
  }) => {
    const home = await scratchHome(resources)
    const directory = tourFolder(home)
    const { tour: first } = tourIn(home)
    await first.prepare("claude")
    let closed: () => void = () => {}
    const { tour } = tourIn(home, {
      projects: [project("closing", directory)],
      removal: () => new Promise<void>((resolve) => (closed = resolve)),
    })
    const prepared = tour.prepare("claude")
    // Still closing: what the earlier run left is untouched.
    await writeFile(join(directory, "index.html"), "<p>made</p>")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await readdir(directory)).toContain("index.html")
    closed()
    await prepared
    expect(await readdir(directory)).not.toContain("index.html")
  })

  it("refuses an agent whose cheapest model can't be told, changing nothing", async ({
    resources,
  }) => {
    const home = await scratchHome(resources)
    const { tour, removed } = tourIn(home, {
      connected: ["codex"],
      models: [],
      projects: [project("old-tour", tourFolder(home))],
    })
    await expect(tour.prepare("codex")).rejects.toSatisfy(
      (error: unknown) => error instanceof DomainError && error.code === "MODELS_UNLISTED",
    )
    expect(removed).toEqual([])
    await expect(readdir(tourFolder(home))).rejects.toThrow()
  })

  it("refuses a second run while the first is being readied", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home)
    const first = tour.prepare("claude")
    await expect(tour.prepare("claude")).rejects.toSatisfy(conflict)
    await first
    await expect(tour.prepare("claude")).resolves.toMatchObject({ brief: "launch" })
  })

  it("leaves Antigravity's start line to the doorbell", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home, { connected: ["agy"] })
    await expect(tour.prepare("agy")).resolves.toMatchObject({ brief: "doorbell" })
  })
})

const brief = (home: string) => readFile(join(tourFolder(home), "AGENTS.md"), "utf8")

// The arguments the brief gives `open_agent` for each of its two teammates, in order.
const opened = (text: string): string[] =>
  [...text.matchAll(/Call `open_agent` with (agent "[^\n]*?)(?:, and as|\n)/g)].map(
    ([, each]) => each!,
  )

const luna: Model = { id: "gpt-e2e-luna", efforts: ["low", "medium"] }

describe("the brief's facts", () => {
  it("names the person and has a lead's own harness open both teammates on its cheapest model", async ({
    resources,
  }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home, { git: "Ada Lovelace" })
    await tour.prepare("claude")
    const text = await brief(home)
    expect(text).toContain("welcome card for Ada, with two teammates")
    expect(text).toContain('NAME with "Ada"')
    expect(text).toContain("welcome.svg")
    expect(text).toContain('<text x="48" y="110"')
    expect(opened(text)).toEqual([
      'agent "claude", model "haiku", effort "low"',
      'agent "claude", model "haiku", effort "low"',
    ])
  })

  it("puts the designer on a second connected harness where one lists its cheapest model", async ({
    resources,
  }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home, {
      connected: ["claude", "codex", "agy"],
      lists: { codex: [luna] },
    })
    await tour.prepare("agy")
    // Claude Code comes first of the others.
    expect(opened(await brief(home))).toEqual([
      'agent "agy", model "gemini-3.8-flash-low", effort "low"',
      'agent "claude", model "haiku", effort "low"',
    ])
    await tour.prepare("claude")
    expect(opened(await brief(home))).toEqual([
      'agent "claude", model "haiku", effort "low"',
      'agent "codex", model "gpt-e2e-luna", effort "low"',
    ])
  })

  it("takes Codex's luna from its catalog, and keeps the lead's harness where the other can't be told", async ({
    resources,
  }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home, { connected: ["codex", "claude"], lists: { codex: [luna] } })
    await tour.prepare("codex")
    expect(opened(await brief(home))).toEqual([
      'agent "codex", model "gpt-e2e-luna", effort "low"',
      'agent "claude", model "haiku", effort "low"',
    ])
    // A connected harness that lists no models, as Codex before it has signed in.
    const alone = tourIn(home, { connected: ["claude", "codex"], lists: { codex: [] } })
    await alone.tour.prepare("claude")
    expect(opened(await brief(home))).toEqual([
      'agent "claude", model "haiku", effort "low"',
      'agent "claude", model "haiku", effort "low"',
    ])
  })

  it("leaves out an effort a model takes none of", async ({ resources }) => {
    const home = await scratchHome(resources)
    const { tour } = tourIn(home, {
      connected: ["codex"],
      lists: { codex: [{ id: "gpt-e2e-luna", efforts: [] }] },
    })
    await tour.prepare("codex")
    expect(opened(await brief(home))).toEqual([
      'agent "codex", model "gpt-e2e-luna"',
      'agent "codex", model "gpt-e2e-luna"',
    ])
  })

  it("is composed again for each run", async ({ resources }) => {
    const home = await scratchHome(resources)
    await tourIn(home, { git: "Ada" }).tour.prepare("claude")
    expect(await brief(home)).toContain("for Ada,")
    await tourIn(home, { git: "Grace Hopper" }).tour.prepare("claude")
    expect(await brief(home)).toContain("for Grace,")
  })
})

describe("ringing the tour's brief", () => {
  it("rings the start line to the terminal's agent", () => {
    const notices: [string, string][] = []
    const { tour } = tourIn("/nowhere", { notices, shown: ["t1"] })
    tour.brief("t1")
    expect(notices).toEqual([["t1", startLine]])
  })

  it("refuses a terminal whose agent hasn't shown yet", () => {
    const { tour } = tourIn("/nowhere")
    expect(() => tour.brief("t1")).toThrow(DomainError)
  })

  it("rings only the tour's own terminals", () => {
    const notices: [string, string][] = []
    const { tour } = tourIn("/h", { notices, shown: ["mine"], cwds: { mine: "/h/code" } })
    expect(() => tour.brief("mine")).toThrow(/isn't one of the tour's/)
    expect(notices).toEqual([])
  })
})

describe("nudging the tour's agent", () => {
  it("rings it a fixed line to carry on from its step, in the tour's folder only", () => {
    const notices: [string, string][] = []
    const { tour } = tourIn("/h", {
      notices,
      shown: ["lead", "elsewhere"],
      cwds: { elsewhere: "/h/code" },
    })
    tour.nudge("lead")
    expect(notices).toEqual([["lead", nudgeLine]])
    expect(() => tour.nudge("elsewhere")).toThrow(DomainError)
  })
})

describe("a project's folder within the tour's", () => {
  it("is the folder itself or one inside it, never one beside it", () => {
    expect(withinFolder("/h/.novadeck/tour", "/h/.novadeck/tour", "linux")).toBe(true)
    expect(withinFolder("/h/.novadeck/tour/site/", "/h/.novadeck/tour", "linux")).toBe(true)
    expect(withinFolder("/h/.novadeck/tour-old", "/h/.novadeck/tour", "linux")).toBe(false)
    expect(withinFolder("/h/.novadeck", "/h/.novadeck/tour", "linux")).toBe(false)
  })

  it("tells cases apart only where the file system does", () => {
    expect(withinFolder("/h/.Novadeck/Tour", "/h/.novadeck/tour", "linux")).toBe(false)
    expect(withinFolder("/h/.Novadeck/Tour", "/h/.novadeck/tour", "darwin")).toBe(true)
    expect(
      withinFolder("C:\\Users\\x\\.Novadeck\\TOUR", "c:/users/x/.novadeck/tour", "win32"),
    ).toBe(true)
  })
})

describe("the brief's wording", () => {
  it("keeps the nudge from making an agent redo a step", () => {
    expect(nudgeLine).toContain("Don't redo a step.")
  })

  it("leaves the tagline to the person, and has the copywriter cope with a dismissal or its own words", async ({
    resources,
  }) => {
    const home = await scratchHome(resources)
    await tourIn(home).tour.prepare("claude")
    const text = await brief(home)
    expect(text).toContain("Never answer your teammates' questions to the person yourself")
    expect(text).toMatch(/body "The lead is making a\s+>\s+welcome card for/)
    expect(text).toContain("dismissed the question")
    expect(text).toContain("their words as the tagline")
  })
})
