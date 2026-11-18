import { activeProject } from "@novadeck/core/state"
import type { Workspace } from "@novadeck/core/types"
import type { FileFault } from "@novadeck/demo/file-edits"
import type { DemoFiles } from "@novadeck/demo/files"
import { windowFileOf, type WindowFile } from "@novadeck/demo/workspace"

import { refuseClipboard, restoreClipboard } from "./clipboard"
import type { DemoAction, DemoActionGroup } from "./types"

// The panel's group for what can go wrong with a file the person edits in the project window,
// on the file the window of the session on screen shows. Edits that can't be saved are kept,
// and leaving them (another file, closing the window, renaming, moving or deleting the file in
// Files) asks first: the faults below that stop saves reach that question.

// How edits come to wait to be saved, with nothing saying why yet: typing while saves fail. A
// refusal would say its own reason over what a fault below says.
const waiting = "Saves keep failing, then type"

// What appears once an action that leaves edits waiting has, and the question before leaving
// them.
const leaving =
  "while the notice is up, opening another file, the window's Close, or Rename…, a cut's Paste or Delete on the file in Files asks first, with Copy my edits and …, and Cancel, which on a rename, move or delete puts a red-edged line above the tree saying you kept the edits"

const faults: readonly {
  readonly label: string
  readonly fault: FileFault
  readonly hint: string
}[] = [
  {
    label: "Too large to edit",
    fault: "too-large",
    hint: `The project window shows the file as read-only lines, its header saying it's too large to edit here. Edits waiting to be saved (${waiting}, first) stay in the editor over it, with a notice that the file is too large to save them, Copy my edits and Try saving again`,
  },
  {
    label: "Not UTF-8 text",
    fault: "not-text",
    hint: `The project window shows the file as read-only lines, its header saying it isn't UTF-8 text, so it can't be edited here. Edits waiting to be saved (${waiting}, first) stay over it, with a notice that it's no longer text Novadeck can edit`,
  },
  {
    label: "Binary file",
    fault: "binary",
    hint: `The project window says the file isn't text, so it can't be previewed. Edits waiting to be saved (${waiting}, first) stay in the editor, with a notice that it's no longer text Novadeck can edit`,
  },
  {
    label: "An agent's copy",
    fault: "outside",
    hint: `The project window's editor turns read-only, its header saying the file isn't one of the project's own but outside its folder, in Git's own folder or an agent's copy. Edits waiting to be saved (${waiting}, first) stay, with a notice that Novadeck saves only the project's own files`,
  },
  {
    label: "Folder can't be written",
    fault: "folder",
    hint: `The project window's editor turns read-only, its header saying Novadeck can't write to this file or its folder. Edits waiting to be saved (${waiting}, first) stay, with a notice saying so`,
  },
  {
    label: "Can't be edited here",
    fault: "not-a-plan",
    hint: `The project window's editor turns read-only, its header saying it can't be edited here, as a runner says of a file it can't place in its project. Edits waiting to be saved (${waiting}, first) stay, with a notice that Novadeck saves only the file the project window shows`,
  },
  {
    label: "File deleted",
    fault: "gone",
    hint: `The project window says the file isn't there any more, as when something other than Files deletes it (Files' Delete saves the edits first, or asks). Edits waiting to be saved (${waiting}, first) stay, with a notice that the file was deleted, Copy my edits and Try saving again, refused until File editing back to normal`,
  },
  {
    label: "File can't be read",
    fault: "unreadable",
    hint: `The project window says Novadeck can't read the file. Edits waiting to be saved (${waiting}, first) stay, with a notice that it can't be read right now, Copy my edits and Retry, whose saves fail until File editing back to normal`,
  },
  {
    label: "Next save refused: can't write",
    fault: "refuse-folder",
    hint: `Type in the project window's file: its next save is refused, and a notice says Novadeck can't write to the file or its folder, with Copy my edits and Try saving again, which then saves; ${leaving}`,
  },
  {
    label: "Next save refused: too large",
    fault: "refuse-too-large",
    hint: `Type in the project window's file: its next save is refused, and a notice says the file is too large for Novadeck to save the edits, with Copy my edits and Try saving again, which then saves (as does typing on); ${leaving}`,
  },
  {
    label: "Next save refused: not text",
    fault: "refuse-not-text",
    hint: `Type in the project window's file: its next save is refused, and a notice says it's no longer text Novadeck can edit, with Copy my edits and Try saving again, which then saves; ${leaving}`,
  },
  {
    label: "Next save refused: file moved",
    fault: "refuse-moved",
    hint: `Type in the project window's file: its next save is refused, and a notice says the window shows another file now, so the edits can't be saved into this one, with Copy my edits and Try saving again, which then saves; ${leaving}`,
  },
  {
    label: "Saves keep failing",
    fault: "failing",
    hint: `Type in the project window's file: its header says Not saved yet. Trying again., and after 5 failures in a row (about 30 s) a notice says Novadeck couldn't save the edits after 5 tries, with Copy my edits and Retry. Opening another file, the window's Close, or Rename…, a cut's Paste or Delete on the file in Files shows Saving your edits to the file… with Cancel alone after 2 s, and the question before leaving them once its saves have tried for 20 s (Next save refused asks at once)`,
  },
]

// The file the project window of the session on screen shows, while it shows one.
const shownIn = (workspace: Workspace | undefined): WindowFile | undefined => {
  const project = workspace && activeProject(workspace)
  return project
    ? windowFileOf(workspace, {
        projectId: project.id,
        workspaceSessionId: project.activeSessionId,
      })
    : undefined
}

const openFirst = "Open a text file from Files in the project window first (double-click it)."

// `files` keeps the edits once the project window has read a file whole, or the person made one.
export const fileEditingGroups = (
  files: Pick<DemoFiles, "edits"> | undefined,
): readonly DemoActionGroup[] =>
  files
    ? [
        {
          section: "Agents",
          title: "File editing",
          actions: [
            ...faults.map(({ label, fault, hint }): DemoAction => ({
              label,
              hint,
              run: ({ workspace, note }) => {
                const file = shownIn(workspace())
                if (!file || !files.edits()?.fault(file, fault)) note(openFirst)
              },
            })),
            {
              label: "An agent rewrites the open file",
              hint: `Two lines appear in the middle of the project window's file, as an agent wrote them. With nothing waiting to be saved the editor just shows them; over edits waiting to be saved (${waiting}, first) they merge into the edits, marked, and the header says The marked lines changed while you edited.; the merge is saved once saves go through`,
              run: ({ workspace, note }) => {
                const file = shownIn(workspace())
                if (!file || !files.edits()?.rewrite(file)) note(openFirst)
              },
            },
            {
              label: "Copying edits fails",
              hint: "Every copy in the page fails until File editing back to normal or a reboot: with edits that can't be saved, Copy my edits says Couldn't copy, and in the question before leaving them Copy my edits and … keeps it up, saying they couldn't be copied and nothing was done, and offering … without my edits",
              run: refuseClipboard,
            },
            {
              label: "File editing back to normal",
              hint: "Every file reads and saves again and edits copy: a read-only or unavailable file is edited again, and edits waiting to be saved are saved, at once or on Try saving again",
              run: () => {
                restoreClipboard()
                files.edits()?.normal()
              },
            },
          ],
        },
      ]
    : []
