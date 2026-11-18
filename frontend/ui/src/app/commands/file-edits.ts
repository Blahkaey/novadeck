import type { WorkspaceTarget } from "@novadeck/core/types"

import type { LeaveAction, LeaveAsk } from "../../terminals/leave-edits"
import { projectWindowFile, stateAt, type ProjectFile } from "../selectors"
import type { CommandContext } from "./context"

// The person's edits to the file a project window shows reach that file before the window
// shows another, closes or goes with its session or project, or the file moves or goes. A save
// that takes a while is waited for in sight (`ui.leaving`, waiting), and the person may stay
// meanwhile. Where the edits can't reach the file, the person is asked first: the dialog copies
// them, or lets them go once a copy failed, and the person goes on; or they stay.

export type EditCommands = {
  // The person answered the question `ask` about leaving edits that can't be saved: go on,
  // their edits let go, or stay with the file. An answer to a question no longer up counts for
  // nothing.
  readonly answerLeave: (ask: LeaveAsk, go: boolean) => void
}

// Saves the edits to `file`, the file the project window of the session `target` shows,
// before `action` leaves it. Undefined where nothing is left to save; else whether to go on:
// once the edits are in the file, or once the person answered, the edits let go where they
// chose to go on. A save that takes longer than `quietMs` puts the question up waiting on it.
export type Leave = (
  target: WorkspaceTarget,
  file: ProjectFile,
  action: LeaveAction,
) => Promise<boolean> | undefined

// As `Leave`, for the files the project windows of the sessions `targets` show, those `which`
// picks by their path, one at a time: whether to go on, false at the first the person stays
// for. Undefined where nothing is left to save in any of them.
export type LeaveAll = (
  targets: readonly WorkspaceTarget[],
  action: LeaveAction,
  which?: (path: string) => boolean,
) => Promise<boolean> | undefined

// How long a save may take before the question shows it being waited for.
export const quietMs = 2000

export const createEditCommands = ({
  ui,
  workspace,
  itemStore,
}: Pick<CommandContext, "ui" | "workspace" | "itemStore">): EditCommands & {
  readonly leave: Leave
  readonly leaveAll: LeaveAll
} => {
  // The question up, and the leave's own answer to it, while one is.
  let up: { readonly question: LeaveAsk; readonly answered: (go: boolean) => void } | undefined
  // Takes the question of the leave `answered` answers down, while it's up.
  const takeDown = (answered: (go: boolean) => void): void => {
    if (up?.answered !== answered) return
    const { question } = up
    up = undefined
    ui.update((state) => (state.leaving === question ? { ...state, leaving: null } : state))
  }
  // Puts `question` up for the leave `answered` answers: in place of its own waiting one, or of
  // another leave's, which stays where the person was for it.
  const putUp = (question: LeaveAsk, answered: (go: boolean) => void): void => {
    const replaced = up
    up = { question, answered }
    ui.update((state) => ({ ...state, leaving: question }))
    if (replaced && replaced.answered !== answered) replaced.answered(false)
  }
  const leave: Leave = (target, file, action) => {
    const saving = itemStore?.saveFile(target, file.id, file.path)
    if (!itemStore || !saving) return undefined
    const asking = (waiting: boolean): LeaveAsk => ({
      itemId: file.id,
      path: file.path,
      name: file.name,
      action,
      waiting,
    })
    return new Promise((resolve) => {
      // The person answered (or another leave's question took the place of this one's) before
      // the save settled: a save that can't go through then asks nothing.
      let answeredFirst = false
      // The person's answer: going on lets the edits go.
      const answered = (go: boolean): void => {
        answeredFirst = true
        clearTimeout(quiet)
        if (go) itemStore.dropFile(file.id, file.path)
        resolve(go)
      }
      const quiet = setTimeout(() => putUp(asking(true), answered), quietMs)
      void saving.then((left) => {
        clearTimeout(quiet)
        if (answeredFirst) return
        if (left === "stuck") return putUp(asking(false), answered)
        takeDown(answered)
        resolve(true)
      })
    })
  }
  const leaveAll: LeaveAll = (targets, action, which = () => true) => {
    const snapshot = workspace.getSnapshot()
    const shown = targets.flatMap((target) => {
      const file = projectWindowFile(stateAt(snapshot, target))
      return file && which(file.path) ? [{ target, file }] : []
    })
    // From the `at`th on: the first with edits left to save, then the rest once it goes on.
    const from = (at: number): Promise<boolean> | undefined => {
      for (let index = at; index < shown.length; index += 1) {
        const { target, file } = shown[index]!
        const leaving = leave(target, file, action)
        if (leaving) return leaving.then((go) => go && (from(index + 1) ?? true))
      }
      return undefined
    }
    return from(0)
  }
  return {
    leave,
    leaveAll,
    answerLeave: (question, go) => {
      const asked = up
      if (!asked || ui.getSnapshot().leaving !== question) return
      takeDown(asked.answered)
      asked.answered(go)
    },
  }
}
