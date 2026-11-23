import type { Store } from "./store"

// Files: a project's files, for the sidebar's Files panel. The panel reads the project's
// folder one folder at a time (`list`), as the person opens them. On a demo backend, the
// files its agents change come on top (`state`): who changed each file, how, and which
// file each agent is writing in its current turn. Each agent there works in its own
// worktree, so every write in that worktree is that agent's. A runner tells none of its
// own: its state stays empty, and while agent worktrees are on the app lays each tracked
// worktree's work (`works`) over the files in its place.

// How an agent changed a file, against the branch its worktree came from.
export type FileChange = "modified" | "added" | "deleted"

// A file one or more agents changed this session.
export type TouchedFile = {
  readonly kind: FileChange
  // When each agent last wrote it, by bare handle (`moth`), in milliseconds since the epoch.
  // A write moves its agent's time on, which is how the panel knows to show it.
  readonly touched: Readonly<Record<string, number>>
}

// What a project's live agents did to its files.
export type FilesProject = {
  // What they changed, by path from the project's root (`src/cart/useCart.ts`). A file an
  // agent added or deleted shows in its folder whether or not the folder lists it.
  readonly changes: Readonly<Record<string, TouchedFile>>
  // The file each agent is writing in its current turn, by handle. An agent between turns,
  // or one that has written nothing this turn, has no entry.
  readonly writing: Readonly<Record<string, string>>
}

export type FilesState = {
  // By project id; a project with nothing here has no changes to show.
  readonly projects: Readonly<Record<string, FilesProject>>
}

// One entry of a folder, by its own name.
export type FolderEntry = {
  readonly name: string
  readonly folder: boolean
  // The project's VCS ignores it (`node_modules`), so it shows faded.
  readonly ignored: boolean
}

export type FolderListing = {
  readonly entries: readonly FolderEntry[]
  // The folder holds more than the backend lists, and the rest aren't among `entries`.
  readonly truncated: boolean
}

// Patterns that hide files and folders from the Files panel, as VS Code's `files.exclude`
// writes them: a glob matched against the path from the project's root (`*.log` only at the
// top, `**/*.log` anywhere), on for `true` and switched off for `false`. A hidden folder hides
// everything in it. The person keeps one list for every project, in Preferences, and a project
// may keep its own over it, whose `false` lifts a pattern of theirs there.
export type FilesExclude = Readonly<Record<string, boolean>>

// How many patterns a project's own list holds at most, and how long each runs, in UTF-16 code
// units: the runner's own limits (`filesExcludeLimits` in the protocol). A pattern of the
// person's list for every project runs as long at most.
export const filesExcludeLimits = { patterns: 200, pattern: 1024 } as const

// What hides files everywhere until the person changes it: the folders' notes macOS and
// Windows leave behind.
export const defaultFilesExclude: FilesExclude = { "**/.DS_Store": true, "**/Thumbs.db": true }

// How a project's own checkout stands against its remote's main. `behind` is set where the
// checkout is on main and main is ahead of it, which the backend moves by itself where nothing is
// in the way: the branch, the remote's name for it, and how many commits it lacks. `moved` counts
// the times the backend moved the checkout to main, and `head` is the commit it is at (null
// where there is none): when either changes, the files on disk may have.
export type CheckoutState = {
  readonly behind: {
    readonly branch: string
    readonly remote: string
    readonly count: number
  } | null
  readonly moved: number
  readonly head: string | null
}

// What an update of the checkout did: it moved (or had nothing to move), or git's reason.
export type CheckoutUpdate = { readonly ok: true } | { readonly ok: false; readonly said: string }

export type PastedEntry = { readonly path: string; readonly folder: boolean }
export type FilePasteProgress = (sent: number, total: number) => void
export type FilePasteResult = "ours" | "empty" | readonly PastedEntry[]

/** The desktop clipboard, where Files can copy local entries to the project's runner. */
export type ProjectFilesClipboard = {
  /** A simulated clipboard can report when its fixture is loaded. */
  readonly available?: Store<boolean>
  readonly mark: (marker: string) => Promise<void>
  readonly paste: (
    projectId: string,
    into: string,
    marker: string | undefined,
    progress: FilePasteProgress,
  ) => Promise<FilePasteResult>
}

export type ProjectFiles = {
  readonly state: Store<FilesState>
  // A folder of the project's directory as it is now, by its path from the project's root
  // with `/` between names (`src/cart`; "" for the root). The VCS's own folder (`.git`) is
  // never listed. Rejects when the project or the folder has gone, or the path leads out
  // of the project's directory.
  readonly list: (projectId: string, folder: string) => Promise<FolderListing>
  // A project's own patterns over the person's list for every project, where the backend keeps
  // them: as last saved (none until then), and replaced whole. Both reject when the project has
  // gone, and a save of more than `filesExcludeLimits.patterns` with the reason.
  readonly exclude?: {
    readonly read: (projectId: string) => Promise<FilesExclude>
    readonly save: (projectId: string, patterns: FilesExclude) => Promise<void>
  }
  // The person's changes to the project's files, each by a path from the project's root with
  // `/` between names, where the backend can make them; each absent where it can't. `create`
  // makes an empty file, or with `folder` an empty folder, and the folders on the way that are
  // missing; `move` renames an entry, or moves it into another folder, another disk too; `copy`
  // copies one into the folder `into` ("" for the root), a folder with everything in it, under
  // its own name where that is free, else `name copy.ext`, `name copy 2.ext`, …; `remove` deletes
  // one for good, a folder with everything in it. `create`, `move` and `copy` answer the path of
  // the entry they made, moved or copied. A copy, or a move to another disk, runs as long as it
  // takes. Each rejects with the backend's reason: a name taken, which is never overwritten, the
  // root or the VCS's own folder, a folder into itself, a path gone or leading out of the
  // project, or the system refusing, as for want of permission. Where the link to the backend
  // drops before it answers, a move, a copy or a delete rejects with `ChangeUnanswered` only once
  // the link is back, or is given up on, as the backend may have finished it meanwhile.
  readonly create?: (projectId: string, path: string, folder: boolean) => Promise<string>
  readonly move?: (projectId: string, from: string, to: string) => Promise<string>
  readonly copy?: (projectId: string, from: string, into: string) => Promise<string>
  readonly remove?: (projectId: string, path: string) => Promise<void>
  readonly clipboard?: ProjectFilesClipboard
  // How the project's own checkout stands as it is now. Rejects when the project has gone.
  // Absent where a backend has no checkout to move.
  readonly checkout?: (projectId: string) => Promise<CheckoutState>
  // Fast-forwards the checkout to the remote's main on the person's say, tracked changes
  // allowed; `ok: false` says why not. Absent where `checkout` is.
  readonly update?: (projectId: string) => Promise<CheckoutUpdate>
}

// What a change of a project's files rejects with where the link to the backend dropped before it
// answered: the backend may have made the change, or may still be making it.
export class ChangeUnanswered extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "The connection dropped before an answer came, so it may have been done, or may still be under way.",
      options,
    )
    this.name = "ChangeUnanswered"
  }
}

// A project's directory is written as the backend's machine writes it: a Windows one with
// backslashes and no slash.
const windowsDirectory = (directory: string): boolean =>
  directory.includes("\\") && !directory.includes("/")

// A path from a project's root (`src/cart/useCart.ts`) in the separator its directory is
// written in.
export const relativePath = (directory: string, path: string): string =>
  windowsDirectory(directory) ? path.replaceAll("/", "\\") : path

// The path of a file from a project's directory, on the backend's machine, in the separator
// the directory is written in.
export const absolutePath = (directory: string, path: string): string =>
  `${directory.replace(/[\\/]+$/, "")}${windowsDirectory(directory) ? "\\" : "/"}${relativePath(directory, path)}`

// How an agent's trail fades once it stops writing a file: from this opacity, by this much every
// `trailTimeMs`, gone below `trailGone`. The panel's CSS keyframes (files.css) follow the same
// curve, in the Files tree and the file preview alike.
const trailStart = 0.7
const trailTimeMs = 150_000
export const trailGone = 0.04
export const trailLifeMs = trailTimeMs * Math.log(trailStart / trailGone)

export const trailOpacity = (ageMs: number): number =>
  trailStart * Math.exp(-Math.max(0, ageMs) / trailTimeMs)
