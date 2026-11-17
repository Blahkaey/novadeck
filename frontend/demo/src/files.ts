import {
  ChangeUnanswered,
  filesExcludeLimits,
  type ProjectFiles,
  type FilesExclude,
  type FolderEntry,
  type TouchedFile,
  type FolderListing,
  type FilesProject,
  type FilesState,
} from "@novadeck/core/files"
import type { ItemContent, ItemId } from "@novadeck/core/items"
import type { Backend } from "@novadeck/core/port"
import type { WorkspaceSeed } from "@novadeck/core/seed"
import { createStore } from "@novadeck/core/store"
import type { Workspace, WorkspaceTarget } from "@novadeck/core/types"

import type { DemoTurns } from "./agents/turns"
import { demoHandle } from "./handles"
import { lessMotion, stillRequested } from "./motion"
import { demoTerminalId } from "./samples"
import { terminalOf } from "./workspace"

// The demo's Files panel: the storefront project's files, listed a folder at a time from
// fixtures, as its agents change them. Each agent notionally works in its own worktree, so every write is its handle's.
// Moth's changes are history, from the plan it waits on. An agent writes only while it
// works: its terminal's agent status says it works and asks nothing of the person. Then it
// writes while the page is in view, a file every few seconds, now and then resting between
// turns; waiting on the person or at rest, it writes nothing and shows no cursor. Each project's
// own patterns for hiding files are kept in memory, as the runner keeps them, from none. The
// person makes, renames, moves, copies and deletes files in memory too, in a copy of the project's
// tree the agents' work follows (a copy starts with none of it), and a window showing a file they
// deleted, or moved away, says it is gone.

const projectId = "storefront"
const session = { projectId, workspaceSessionId: "initial" }

// The agents in the storefront project that change files, by the handle of their slot.
const moth = demoHandle(1)
const crow = demoHandle(4)
// The agents that write by themselves, by the terminal of their slot.
const slots = [
  { handle: moth, terminalId: demoTerminalId(session, 1) },
  { handle: crow, terminalId: demoTerminalId(session, 4) },
]

// The storefront terminal of the agent with the handle, if it is one that changes files.
export const terminalOfHandle = (handle: string): string | undefined =>
  slots.find((slot) => slot.handle === handle)?.terminalId ??
  (handle === filesThird ? demoTerminalId(session, 3) : undefined)

// The handles of the storefront agents that work, asking nothing of the person, as the seed
// opens them: the ones that write by themselves (Moth and Crow).
export const workingInSeed = (seed: WorkspaceSeed): readonly string[] =>
  seed.projects
    .filter((project) => project.id === projectId)
    .flatMap((project) => project.sessions.flatMap((each) => each.terminals))
    .flatMap((terminal) =>
      terminal.state === "running" &&
      terminal.agent?.working &&
      !terminal.agent.attention &&
      (terminal.handle === moth || terminal.handle === crow)
        ? [terminal.handle]
        : [],
    )

// The handle of a third storefront agent, which the debug panel has change a file Moth and
// Crow did, so a row has three: the third terminal, Claude Code in the agents demos.
export const filesThird = demoHandle(3)

const minute = 60_000

// Paths the debug panel and the specs name.
export const demoPaths = {
  checkout: "src/checkout/Checkout.tsx",
  checkoutTest: "src/checkout/Checkout.test.tsx",
  payments: "src/api/payments.ts",
} as const

// The storefront's tree before any agent's work, which `list` serves a folder at a time. An
// entry ending in `/` is a folder with nothing in it.
const entries: readonly string[] = [
  ".env.local",
  ".github/workflows/ci.yml",
  ".gitignore",
  "README.md",
  "index.html",
  "node_modules/",
  "package.json",
  "pnpm-lock.yaml",
  "public/favicon.svg",
  "src/App.tsx",
  "src/api/client.ts",
  "src/api/orders.ts",
  "src/cart/CartItem.tsx",
  "src/cart/CartSummary.tsx",
  "src/cart/useCart.ts",
  demoPaths.checkoutTest,
  "src/checkout/AddressForm.tsx",
  demoPaths.checkout,
  "src/checkout/PaymentStep.tsx",
  "src/components/Button.tsx",
  "src/components/Price.tsx",
  "src/main.tsx",
  "vite.config.ts",
  "vitest.config.ts",
]

const ignored: readonly string[] = ["node_modules/", ".env.local"]

const file = (kind: TouchedFile["kind"], touched: TouchedFile["touched"]): TouchedFile => ({
  kind,
  touched,
})

// What the agents changed before the page opened, `now` being when it did.
const history = (now: number): FilesProject["changes"] => ({
  "src/cart/CartSummary.tsx": file("modified", { [moth]: now - 6 * minute }),
  "src/cart/useCart.ts": file("modified", { [moth]: now - 7 * minute }),
  "src/checkout/OrderSummary.tsx": file("added", { [moth]: now - 9 * minute }),
  "src/checkout/OrderSummary.test.tsx": file("added", { [moth]: now - 10 * minute }),
  "package.json": file("modified", { [moth]: now - 14 * minute }),
  "pnpm-lock.yaml": file("modified", { [moth]: now - 14 * minute }),
  [demoPaths.checkout]: file("modified", { [moth]: now - 10 * minute, [crow]: now - minute }),
  [demoPaths.checkoutTest]: file("modified", { [crow]: now - 20_000 }),
  "src/checkout/LegacyCheckout.tsx": file("deleted", { [crow]: now - 3 * minute }),
})

// `working` is who works as the page opens: Crow, with its test in hand, where it does.
export const storefrontFiles = (
  now: number,
  working: readonly string[] = [crow],
): FilesProject => ({
  changes: history(now),
  writing: working.includes(crow) ? { [crow]: demoPaths.checkoutTest } : {},
})

// The project with `handle`'s write to `path` at `at`: the file is changed by it, a
// new one added, an existing one modified, and it is the file the agent is writing now. `tree`
// is the project's tree as it stands, the fixtures' before the person changes it.
export const writeTo = (
  project: FilesProject,
  handle: string,
  path: string,
  at: number,
  tree: readonly string[],
): FilesProject => {
  const was = project.changes[path]
  const kind =
    was && was.kind !== "deleted" ? was.kind : tree.includes(path) || was ? "modified" : "added"
  return {
    ...project,
    changes: { ...project.changes, [path]: file(kind, { ...was?.touched, [handle]: at }) },
    writing: { ...project.writing, [handle]: path },
  }
}

// The project with `handle`'s change to `path` as `kind` (at `at`), or, with no kind, with it
// no longer changing it: the file is as the others' changes leave it, and gone from the changes
// when nobody is left. `tree` is as for `writeTo`.
export const markIn = (
  project: FilesProject,
  handle: string,
  path: string,
  kind: TouchedFile["kind"] | undefined,
  at: number,
  tree: readonly string[],
): FilesProject => {
  const was = project.changes[path]
  if (kind !== undefined)
    return {
      ...project,
      changes: { ...project.changes, [path]: file(kind, { ...was?.touched, [handle]: at }) },
    }
  if (!was || !(handle in was.touched)) return project
  const { [handle]: _, ...touched } = was.touched
  const { [path]: gone, ...rest } = project.changes
  void gone
  return {
    ...project,
    changes:
      Object.keys(touched).length === 0
        ? rest
        : { ...rest, [path]: file(tree.includes(path) ? "modified" : "added", touched) },
  }
}

// The project with `handle`'s turn over: it is writing nothing.
export const endTurnIn = (project: FilesProject, handle: string): FilesProject => {
  if (!(handle in project.writing)) return project
  const { [handle]: _, ...writing } = project.writing
  return { ...project, writing }
}

const trimmed = (path: string): string => (path.endsWith("/") ? path.slice(0, -1) : path)

// Whether `each` is `path` or lies below it.
const atOrBelow = (each: string, path: string): boolean =>
  each === path || each.startsWith(`${path}/`)

// A path at or below `from` as it is once `from` moved to `to`; any other as it is.
const movedTo = (each: string, from: string, to: string): string =>
  atOrBelow(each, from) ? `${to}${each.slice(from.length)}` : each

// The project's changes and cursors once the person moved `from` to `to`: the agents' work on
// it, and on what is in it, follows it.
const movedIn = (project: FilesProject, from: string, to: string): FilesProject => ({
  changes: Object.fromEntries(
    Object.entries(project.changes).map(([path, change]) => [movedTo(path, from, to), change]),
  ),
  writing: Object.fromEntries(
    Object.entries(project.writing).map(([handle, path]) => [handle, movedTo(path, from, to)]),
  ),
})

// The project's changes and cursors once the person deleted `path`: none at it or in it.
const removedIn = (project: FilesProject, path: string): FilesProject => ({
  changes: Object.fromEntries(
    Object.entries(project.changes).filter(([each]) => !atOrBelow(each, path)),
  ),
  writing: Object.fromEntries(
    Object.entries(project.writing).filter(([, each]) => !atOrBelow(each, path)),
  ),
})

// A project's tree, as the fixtures hold it: an entry ending in `/` is a folder with nothing in
// it, and `ignored` names what the project's VCS ignores.
type Tree = { readonly entries: readonly string[]; readonly ignored: readonly string[] }

const storefront: Tree = { entries, ignored }

// The other sample projects' trees, small and generic to their names; a project the visitor adds
// has the plain one.
const trees: Readonly<Record<string, Tree>> = {
  "api-service": {
    entries: [
      ".gitignore",
      "Dockerfile",
      "README.md",
      "node_modules/",
      "package.json",
      "src/db/client.ts",
      "src/routes/orders.ts",
      "src/routes/users.ts",
      "src/server.ts",
      "test/orders.test.ts",
    ],
    ignored: ["node_modules/"],
  },
  "docs-site": {
    entries: [
      "README.md",
      "astro.config.mjs",
      "docs/getting-started.md",
      "docs/guides/config.md",
      "docs/guides/install.md",
      "docs/index.md",
      "node_modules/",
      "package.json",
      "public/logo.svg",
    ],
    ignored: ["node_modules/"],
  },
  "mobile-app": {
    entries: [
      "App.tsx",
      "README.md",
      "app.json",
      "assets/icon.png",
      "node_modules/",
      "package.json",
      "src/components/Button.tsx",
      "src/screens/Home.tsx",
      "src/screens/Profile.tsx",
    ],
    ignored: ["node_modules/"],
  },
  "design-system": {
    entries: [
      "README.md",
      "node_modules/",
      "package.json",
      "src/Button.tsx",
      "src/Card.tsx",
      "src/index.ts",
      "stories/Button.stories.tsx",
      "tokens/colors.json",
      "tokens/spacing.json",
    ],
    ignored: ["node_modules/"],
  },
  infra: {
    entries: [
      ".terraform/",
      "README.md",
      "envs/prod.tfvars",
      "envs/staging.tfvars",
      "main.tf",
      "modules/cluster/main.tf",
      "modules/network/main.tf",
      "modules/network/variables.tf",
      "variables.tf",
    ],
    ignored: [".terraform/"],
  },
  dotfiles: {
    entries: [
      ".config/git/ignore",
      ".config/nvim/init.lua",
      ".gitconfig",
      ".zshrc",
      "README.md",
      "bin/setup.sh",
    ],
    ignored: [],
  },
}

const plain: Tree = {
  entries: [".gitignore", "README.md", "package.json", "src/index.ts"],
  ignored: [],
}

const treeOf = (id: string): Tree => (id === projectId ? storefront : (trees[id] ?? plain))

// What a tree holds at `path`: a file, a folder (empty, or holding paths below), or nothing.
const holds = (tree: Tree, path: string): "file" | "folder" | undefined => {
  for (const entry of tree.entries) {
    const each = trimmed(entry)
    if (each === path) return entry.endsWith("/") ? "folder" : "file"
    if (each.startsWith(`${path}/`)) return "folder"
  }
  return undefined
}

// A tree with `path` and what is below it gone, its folder kept, empty, where nothing else is in
// it.
const without = (tree: Tree, path: string): Tree => {
  const left = tree.entries.filter((entry) => !atOrBelow(trimmed(entry), path))
  const folder = path.slice(0, Math.max(0, path.lastIndexOf("/")))
  const kept =
    folder === "" || holds({ ...tree, entries: left }, folder) ? left : [...left, `${folder}/`]
  return { entries: kept, ignored: tree.ignored.filter((each) => !atOrBelow(trimmed(each), path)) }
}

// Why the runner refuses to change `path`: the project's folder itself, and Git's own `.git`.
const untouchable = (path: string): string | undefined =>
  path === ""
    ? "Novadeck doesn't change the project's folder itself."
    : path.split("/").some((name) => name.toLowerCase() === ".git")
      ? "Novadeck doesn't change Git's own .git."
      : undefined

// Throws as the runner would for `path`.
const refuse = (path: string): void => {
  const why = untouchable(path)
  if (why) throw new Error(why)
}

// The runner's words for a name taken in `folder`.
const takenIn = (folder: string, name: string): string =>
  `There's already something named ${name} in ${folder === "" ? "the project's folder" : folder}.`

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")))

const childOf = (folder: string, name: string): string =>
  folder === "" ? name : `${folder}/${name}`

// The name to try after `name` for a copy of a file or, with `folder`, a folder, as the runner
// names copies (`copyName` in backend/runner/src/workspaces/copy.ts), as VS Code does: `cart.ts`,
// `cart copy.ts`, `cart copy 2.ts`; a folder's whole name, and a dotfile's, take it at their end.
const copyName = (name: string, folder: boolean): string => {
  const dot = folder ? -1 : name.lastIndexOf(".")
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  const counted = /^(.+ copy)(?: (\d+))?$/.exec(stem)
  return counted
    ? `${counted[1]} ${Number(counted[2] ?? 1) + 1}${extension}`
    : `${stem} copy${extension}`
}

// What `folder` of a tree lists: its files, and the folders that hold the paths below. Ignored
// folders hold only ignored files, which the panel carries down.
const listFixture = (tree: Tree, folder: string): readonly FolderEntry[] => {
  const found = new Map<string, FolderEntry>()
  const ignoredPaths = new Set(tree.ignored.map(trimmed))
  for (const entry of tree.entries) {
    const path = trimmed(entry)
    const prefix = folder === "" ? "" : `${folder}/`
    if (!path.startsWith(prefix) || path === folder) continue
    const [name = ""] = path.slice(prefix.length).split("/")
    const full = `${prefix}${name}`
    const isFolder = full !== path || entry.endsWith("/")
    found.set(name, { name, folder: isFolder, ignored: ignoredPaths.has(full) })
  }
  return [...found.values()]
}

// How the debug panel has a folder read: it fails, lists only some of what it holds, or (the
// root) holds nothing. "" is the project's root; the faults apply to every project.
export type FilesFault = "fail" | "truncate" | "empty"

// What a truncated folder still lists.
const truncatedTo = 2

// What an agent writes: the files it keeps coming back to, and ones it creates, each the
// first time only.
type Pool = { readonly files: readonly string[]; readonly fresh: readonly string[] }

const pools: Readonly<Record<string, Pool>> = {
  [moth]: {
    files: [
      "src/cart/CartSummary.tsx",
      "src/cart/useCart.ts",
      "src/checkout/OrderSummary.tsx",
      "src/checkout/OrderSummary.test.tsx",
    ],
    fresh: [],
  },
  [crow]: {
    files: [
      demoPaths.checkoutTest,
      demoPaths.checkout,
      "src/checkout/PaymentStep.tsx",
      "src/checkout/AddressForm.tsx",
    ],
    fresh: ["src/checkout/PaymentForm.tsx", demoPaths.payments],
  },
}

// Any other agent writes as Crow's pool.
const poolOf = (handle: string): Pool => pools[handle] ?? pools[crow]!

// The file an agent writes next, by a roll of `random`: mostly the one it is on, sometimes
// another of its pool, and now and then one it creates, if it has not yet.
export const nextFile = (
  project: FilesProject,
  handle: string,
  random: number,
  pick: number,
): string => {
  const { files, fresh } = poolOf(handle)
  const current = project.writing[handle] ?? files[0]!
  const created = fresh.find((path) => !project.changes[path])
  if (created && random < 0.12) return created
  const others = files.filter((path) => path !== current)
  if (random < 0.35 && others.length > 0) return others[Math.floor(pick * others.length)]!
  return current
}

// When the demo's time and scheduling come from, which a test replaces.
export type FilesClock = {
  readonly now: () => number
  readonly random: () => number
  // Runs `run` after `ms`, until the returned function is called.
  readonly after: (ms: number, run: () => void) => () => void
  readonly hidden: () => boolean
}

const realClock: FilesClock = {
  now: Date.now,
  random: Math.random,
  after: (ms, run) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
  hidden: () => typeof document !== "undefined" && document.hidden,
}

// The time between an agent's writes, how many it makes in a turn, and how long it rests
// between turns, in milliseconds.
const writeMs = { min: 3000, max: 7000 }
const turnWrites = { min: 4, max: 8 }
const restMs = { min: 10_000, max: 20_000 }

const between = (range: { min: number; max: number }, roll: number): number =>
  range.min + Math.floor(roll * (range.max - range.min + 1))

export type DemoFiles = ProjectFiles & {
  readonly exclude: NonNullable<ProjectFiles["exclude"]>
  readonly create: NonNullable<ProjectFiles["create"]>
  readonly move: NonNullable<ProjectFiles["move"]>
  readonly copy: NonNullable<ProjectFiles["copy"]>
  readonly remove: NonNullable<ProjectFiles["remove"]>
  // Has the next reads of `folder` go as `fault` says, or normally for none. The panel reads
  // a folder again when it is shown again or an agent's turn ends.
  readonly degrade: (folder: string, fault: FilesFault | undefined) => void
  // Has the next save of a project's patterns for hiding files fail, or, with false, go through
  // again.
  readonly failNextExcludeSave: (fails?: boolean) => void
  // Has every read of a project's patterns for hiding files fail, or, with false, answer again.
  readonly failExcludeReads: (fails?: boolean) => void
  // Has the next file made, renamed or deleted fail, once, or, with false, go through again.
  readonly failNextChange: (fails?: boolean) => void
  // Has the next paste, a copy or a move into another folder, fail, once, or, with false, go
  // through again.
  readonly failNextPaste: (fails?: boolean) => void
  // Has the next paste take `ms` before it is made or fails, once, or, with none, take no time.
  readonly slowNextPaste: (ms?: number) => void
  // Has the next move, copy or delete made answer as one the connection dropped under before the
  // answer came (`ChangeUnanswered`), once, or, with false, answer again.
  readonly loseNextAnswer: (loses?: boolean) => void
  // Whether the person deleted the file at `path` of a project, or a folder it was in, or moved
  // it away, and it isn't there again.
  readonly gone: (projectId: string, path: string) => boolean
  // Calls `on` whenever the person makes, moves or deletes a file or folder, until stopped.
  readonly watchGone: (on: () => void) => () => void
  // Has `handle` write a file now, `path` or else the one it would next, as its turn goes on.
  readonly write: (handle: string, path?: string) => void
  // Has `handle` change `path` as `kind` without writing it now, or no longer change it.
  readonly mark: (handle: string, path: string, kind: TouchedFile["kind"] | undefined) => void
  // Drops `handle`'s cursor: it is writing nothing until it writes again. Its agent's turn
  // is not touched.
  readonly endTurn: (handle: string) => void
  // Has Moth and Crow write on their own while their agents work, as `turns` reports them,
  // until stopped; stopping drops every cursor. Where the visitor asked for less motion, or
  // held the page still, nothing moves, though an agent that stops working still loses its
  // cursor.
  // Starts the agents that work writing: those `works` says work now, else the ones it was
  // made with, as the seed opens them.
  readonly start: (turns?: DemoTurns, works?: (terminalId: string) => boolean) => () => void
  // Stops the agent in a terminal writing for good: its terminal closed, or its project went.
  readonly close: (terminalId: string) => void
  // Stops the agent in a terminal writing because its terminal no longer shows it working,
  // however that came about; it writes again when its agent is reported working.
  readonly halt: (terminalId: string) => void
}

// Whether a backend's files are the demo's, which the debug panel writes to.
export const isDemoFiles = (files: ProjectFiles | undefined): files is DemoFiles =>
  files !== undefined && "write" in files && "endTurn" in files

export const createDemoFiles = (
  now: number = Date.now(),
  clock: FilesClock = realClock,
  working: readonly string[] = [crow],
): DemoFiles => {
  // Held still, the page shows no agent writing at all: a cursor would blink.
  const state = createStore<FilesState>({
    projects: { [projectId]: storefrontFiles(now, stillRequested() ? [] : working) },
  })
  // A change that leaves the project as it was leaves the store as it was, so the per-commit
  // check on idle agents tells nobody anything.
  const change = (apply: (project: FilesProject) => FilesProject): void => {
    state.update((was) => {
      const project = was.projects[projectId]
      const next = project && apply(project)
      return next && next !== project ? { projects: { ...was.projects, [projectId]: next } } : was
    })
  }
  // Each project's tree as the person changed it; the fixtures' until they do.
  const changed = new Map<string, Tree>()
  const treeNow = (id: string): Tree => changed.get(id) ?? treeOf(id)
  const write = (handle: string, path?: string): void =>
    change((project) =>
      writeTo(
        project,
        handle,
        path ?? nextFile(project, handle, clock.random(), clock.random()),
        clock.now(),
        treeNow(projectId).entries,
      ),
    )
  const endTurn = (handle: string): void => change((project) => endTurnIn(project, handle))
  const mark = (handle: string, path: string, kind: TouchedFile["kind"] | undefined): void =>
    change((project) =>
      markIn(project, handle, path, kind, clock.now(), treeNow(projectId).entries),
    )

  const faults = new Map<string, FilesFault>()
  const degrade = (folder: string, fault: FilesFault | undefined): void => {
    if (fault) faults.set(folder, fault)
    else faults.delete(folder)
  }
  // Each project's own patterns, as the runner keeps them: a save of more than a project keeps is
  // refused as the runner refuses it.
  const excludes = new Map<string, FilesExclude>()
  let excludeSaveFails = false
  const failNextExcludeSave = (fails = true): void => {
    excludeSaveFails = fails
  }
  let excludeReadsFail = false
  const failExcludeReads = (fails = true): void => {
    excludeReadsFail = fails
  }
  const exclude: DemoFiles["exclude"] = {
    read: async (id) => {
      if (excludeReadsFail) throw new Error("The demo was told to fail this read.")
      return excludes.get(id) ?? {}
    },
    save: async (id, patterns) => {
      if (excludeSaveFails) {
        excludeSaveFails = false
        throw new Error("The demo was told to fail this save.")
      }
      if (Object.keys(patterns).length > filesExcludeLimits.patterns)
        throw new Error(
          `A project keeps at most ${filesExcludeLimits.patterns} patterns for hiding files. Remove some to add more.`,
        )
      excludes.set(id, patterns)
    },
  }

  const list = async (id: string, folder: string): Promise<FolderListing> => {
    const fault = faults.get(folder)
    if (fault === "fail") throw new Error("This folder can't be read")
    if (fault === "empty") return { entries: [], truncated: false }
    const tree = treeNow(id)
    const known = tree.entries.some(
      (path) => trimmed(path) === folder || path.startsWith(`${folder}/`),
    )
    if (folder !== "" && !known) throw new Error("There is no such folder")
    const all = listFixture(tree, folder)
    return fault === "truncate"
      ? { entries: all.slice(0, truncatedTo), truncated: true }
      : { entries: all, truncated: false }
  }

  // The person's changes, refused as the runner refuses them, in its words. Each project's paths
  // the person deleted or moved away, until made there again.
  const away = new Map<string, readonly string[]>()
  const goneWatchers = new Set<() => void>()
  let changeFails = false
  const failNextChange = (fails = true): void => {
    changeFails = fails
  }
  // A paste, a copy or a move into another folder, as the debug panel has the next one go.
  let pasteFails = false
  const failNextPaste = (fails = true): void => {
    pasteFails = fails
  }
  let pasteDelay = 0
  const slowNextPaste = (ms = 0): void => {
    pasteDelay = ms
  }
  // Throws as the debug panel asked for the next change, a paste or not, once; a paste after the
  // time it was told to take.
  const fault = async (pasting: boolean): Promise<void> => {
    if (pasting) {
      const delay = pasteDelay
      pasteDelay = 0
      if (delay > 0) await new Promise<void>((resolve) => void clock.after(delay, resolve))
      if (!pasteFails) return
      pasteFails = false
      throw new Error("The demo was told to fail this paste.")
    }
    if (!changeFails) return
    changeFails = false
    throw new Error("The demo was told to fail this change.")
  }
  // The next move, copy or delete, once made, answers as unanswered, as the debug panel asks.
  let answerLost = false
  const loseNextAnswer = (loses = true): void => {
    answerLost = loses
  }
  const answered = <T>(made: T): T => {
    if (!answerLost) return made
    answerLost = false
    throw new ChangeUnanswered()
  }
  // The project's tree is now `tree`; `left` went from it, `arrived` came.
  const settle = (id: string, tree: Tree, left: string | undefined, arrived: string): void => {
    changed.set(id, tree)
    const before = (away.get(id) ?? []).filter((each) => !atOrBelow(each, arrived))
    away.set(id, left === undefined ? before : [...before, left])
    goneWatchers.forEach((on) => on())
  }
  const create: DemoFiles["create"] = async (id, path, folder) => {
    await fault(false)
    refuse(path)
    const tree = treeNow(id)
    const names = path.split("/")
    for (const at of names.keys()) {
      const way = names.slice(0, at + 1).join("/")
      const there = holds(tree, way)
      if (at === names.length - 1 && there)
        throw new Error(takenIn(names.slice(0, -1).join("/"), names.at(-1)!))
      if (there === "file") throw new Error(`${way} isn't a folder.`)
    }
    // A folder that held nothing holds it now.
    const kept = tree.entries.filter((entry) => !(entry.endsWith("/") && path.startsWith(entry)))
    settle(id, { ...tree, entries: [...kept, folder ? `${path}/` : path] }, undefined, path)
    return path
  }
  // A move into another folder is a paste after a cut; one in its own folder, a rename.
  const move: DemoFiles["move"] = async (id, from, to) => {
    await fault(parentOf(from) !== parentOf(to))
    refuse(from)
    refuse(to)
    const tree = treeNow(id)
    if (!holds(tree, from)) throw new Error(`${from} isn't there any more.`)
    const folder = to.slice(0, Math.max(0, to.lastIndexOf("/")))
    if (folder !== "" && holds(tree, folder) !== "folder")
      throw new Error(`${folder} isn't there any more.`)
    if (holds(tree, from) === "folder" && atOrBelow(to, from))
      throw new Error("A folder can't move into itself.")
    if (holds(tree, to)) throw new Error(takenIn(folder, to.slice(to.lastIndexOf("/") + 1)))
    const left = without(tree, from)
    settle(
      id,
      {
        entries: [
          ...left.entries.filter((entry) => !(entry.endsWith("/") && to.startsWith(entry))),
          ...tree.entries
            .filter((entry) => atOrBelow(trimmed(entry), from))
            .map((entry) => movedTo(entry, from, to)),
        ],
        ignored: [
          ...left.ignored,
          ...tree.ignored
            .filter((each) => atOrBelow(trimmed(each), from))
            .map((each) => movedTo(each, from, to)),
        ],
      },
      from,
      to,
    )
    if (id === projectId) change((project) => movedIn(project, from, to))
    return answered(to)
  }
  // A copy into the folder `into` under the name the runner would give it, with no agent's work on
  // it: the agents' work stays where it was.
  const copy: DemoFiles["copy"] = async (id, from, into) => {
    await fault(true)
    refuse(from)
    if (into !== "") refuse(into)
    const tree = treeNow(id)
    const kind = holds(tree, from)
    if (!kind) throw new Error(`${from} isn't there any more.`)
    const there = into === "" ? "folder" : holds(tree, into)
    if (there !== "folder")
      throw new Error(there ? `${into} isn't a folder.` : `${into} isn't there any more.`)
    const folder = kind === "folder"
    if (folder && atOrBelow(into, from)) throw new Error("A folder can't be copied into itself.")
    const name = from.slice(from.lastIndexOf("/") + 1)
    let made = parentOf(from) === into ? copyName(name, folder) : name
    while (holds(tree, childOf(into, made))) made = copyName(made, folder)
    const to = childOf(into, made)
    const copied = (each: string): boolean => atOrBelow(trimmed(each), from)
    settle(
      id,
      {
        entries: [
          ...tree.entries.filter((entry) => !(entry.endsWith("/") && to.startsWith(entry))),
          ...tree.entries.filter(copied).map((entry) => movedTo(entry, from, to)),
        ],
        ignored: [
          ...tree.ignored,
          ...tree.ignored.filter(copied).map((each) => movedTo(each, from, to)),
        ],
      },
      undefined,
      to,
    )
    return answered(to)
  }
  const remove: DemoFiles["remove"] = async (id, path) => {
    await fault(false)
    refuse(path)
    const tree = treeNow(id)
    if (!holds(tree, path)) throw new Error(`${path} isn't there any more.`)
    settle(id, without(tree, path), path, path)
    if (id === projectId) change((project) => removedIn(project, path))
    answered(undefined)
  }
  const gone = (id: string, path: string): boolean =>
    (away.get(id) ?? []).some((each) => atOrBelow(path, each)) && !holds(treeNow(id), path)
  const watchGone = (on: () => void): (() => void) => {
    goneWatchers.add(on)
    return () => goneWatchers.delete(on)
  }

  // One agent's turns, a write every few seconds and a rest between them, until stopped.
  const work = (handle: string): (() => void) => {
    let cancel: (() => void) | undefined
    const turn = (left: number): void => {
      if (left === 0) {
        endTurn(handle)
        cancel = clock.after(between(restMs, clock.random()), () =>
          turn(between(turnWrites, clock.random())),
        )
        return
      }
      cancel = clock.after(between(writeMs, clock.random()), () => {
        // Nothing is written while the page is out of view, so there is no catching up.
        if (clock.hidden()) return turn(left)
        write(handle)
        turn(left - 1)
      })
    }
    turn(between(turnWrites, clock.random()))
    return () => cancel?.()
  }

  // Agents whose terminal closed, which never write again.
  const closed = new Set<string>()
  // How a started simulation stops one agent; before it starts, dropping the cursor is all.
  let stopWriting = (handle: string): void => endTurn(handle)
  const close = (terminalId: string): void => {
    const slot = slots.find((each) => each.terminalId === terminalId)
    if (!slot) return
    closed.add(slot.handle)
    stopWriting(slot.handle)
  }

  const halt = (terminalId: string): void => {
    const slot = slots.find((each) => each.terminalId === terminalId)
    if (slot) stopWriting(slot.handle)
  }

  const start = (turns?: DemoTurns, works?: (terminalId: string) => boolean): (() => void) => {
    // Held still or with less motion, no agent writes; the statuses are still followed, so an
    // agent that stops working loses the cursor it started with.
    const moving = !lessMotion() && !stillRequested()
    // Each writing agent's turns, while its agent works.
    const running = new Map<string, () => void>()
    const setWorking = (handle: string, on: boolean): void => {
      if (on && moving && !closed.has(handle) && !running.has(handle))
        running.set(handle, work(handle))
      if (on) return
      running.get(handle)?.()
      running.delete(handle)
      endTurn(handle)
    }
    stopWriting = (handle) => setWorking(handle, false)
    // Started again, an agent writes only if it still works: it may wait on the person now.
    slots.forEach(({ handle, terminalId }) => {
      if (works ? works(terminalId) : working.includes(handle)) setWorking(handle, true)
    })
    const unwatch = turns?.watchStatus((key, agent) => {
      if (key.projectId !== projectId || key.workspaceSessionId !== session.workspaceSessionId)
        return
      const slot = slots.find((each) => each.terminalId === key.terminalId)
      if (slot) setWorking(slot.handle, agent.working && !agent.attention)
    })
    return () => {
      unwatch?.()
      running.forEach((stop) => stop())
      stopWriting = (handle) => endTurn(handle)
      // No cursor is left blinking.
      change((project) => ({ ...project, writing: {} }))
    }
  }

  return {
    state,
    list,
    exclude,
    degrade,
    failNextExcludeSave,
    failExcludeReads,
    create,
    move,
    copy,
    remove,
    failNextChange,
    failNextPaste,
    slowNextPaste,
    loseNextAnswer,
    gone,
    watchGone,
    write,
    mark,
    endTurn,
    start,
    close,
    halt,
  }
}

// What a window shows of a file the person deleted, or moved away, as the runner's watch reports it.
const missing: ItemContent = { state: "unavailable", reason: "missing", size: null }

// A backend with the demo's files for the storefront project.
export const withFiles = (
  backend: Backend,
  turns?: DemoTurns,
  files = createDemoFiles(Date.now(), undefined, workingInSeed(backend.seed)),
): Backend => {
  let latest: Workspace | undefined
  // Whether the agent in that storefront terminal works now, asking nothing.
  const works = (terminalId: string): boolean => {
    const terminal = terminalOf(latest, { ...session, terminalId })
    const agent = terminal?.state === "running" ? terminal.agent : undefined
    return agent?.working === true && !agent.attention
  }
  // Whether the item shows a file of its project the person deleted, or moved away.
  const showsGone = (target: WorkspaceTarget, itemId: ItemId): boolean => {
    const project = latest?.projects.find((each) => each.id === target.projectId)
    const shown = project?.history.find((each) => each.id === target.workspaceSessionId)
    const path = shown?.state.items.find((each) => each.id === itemId)?.path
    const inside = project && `${project.directory}/`
    return (
      inside !== undefined &&
      path?.startsWith(inside) === true &&
      files.gone(target.projectId, path.slice(inside.length))
    )
  }
  const { companions } = backend
  return {
    ...backend,
    files,
    ...(companions && {
      companions: {
        ...companions,
        // A window that shows a file the person deleted, or moved away, says it is gone, until
        // it shows another file or the file is there again.
        follow: (target, itemId, options, on) => {
          let last: ItemContent | undefined
          let wasGone = false
          const tell = (fresh: boolean): void => {
            const isGone = showsGone(target, itemId)
            if (!last || (!fresh && isGone === wasGone)) return
            wasGone = isGone
            on(isGone ? missing : last)
          }
          const unwatch = files.watchGone(() => tell(false))
          const stop = companions.follow(target, itemId, options, (content) => {
            last = content
            tell(true)
          })
          return () => {
            stop()
            unwatch()
          }
        },
      },
    }),
    commit: (workspace, actions) => {
      latest = workspace
      backend.commit(workspace, actions)
      // A closed terminal's agent writes no more, nor those of a storefront the workspace no
      // longer has (the reducer keeps the last project).
      for (const action of actions) {
        if (action.type === "terminal/close" && action.target.projectId === projectId)
          files.close(action.terminalId)
        if (
          action.type === "project/remove" &&
          action.projectId === projectId &&
          !workspace.projects.some((project) => project.id === projectId)
        )
          slots.forEach((slot) => files.close(slot.terminalId))
        if (
          action.type === "session/remove" &&
          action.projectId === projectId &&
          action.workspaceSessionId === session.workspaceSessionId &&
          workspace.projects.some(
            (project) =>
              project.id === projectId &&
              !project.history.some((each) => each.id === session.workspaceSessionId),
          )
        )
          slots.forEach((slot) => files.close(slot.terminalId))
      }
      // Whatever stopped an agent, a verb or a status dispatched directly (the debug panel's
      // terminal states, a crash), a terminal that no longer shows it working has it write no more.
      slots.forEach((slot) => {
        const terminal = terminalOf(workspace, { ...session, terminalId: slot.terminalId })
        const agent = terminal?.state === "running" ? terminal.agent : undefined
        if (!agent?.working || agent.attention) files.halt(slot.terminalId)
      })
    },
    start: (sink) => {
      const stop = backend.start?.(sink)
      // Before the first commit, the seed says who works.
      const stopSource = files.start(turns, latest ? works : undefined)
      return () => {
        stop?.()
        stopSource()
      }
    },
  }
}
