import type { TerminalKey } from "@novadeck/core/port"
import { isAgentProgram } from "@novadeck/core/terminals/process"
import type { Workspace } from "@novadeck/core/types"
import { demoPaths, filesThird, type DemoFiles } from "@novadeck/demo/files"
import { terminalOf } from "@novadeck/demo/workspace"

import { refuseClipboard, restoreClipboard } from "./clipboard"
import type { DemoLaunch } from "./debug-demo"
import type { DemoActionGroup } from "./types"

// Files exist for the storefront project only.
const project = "storefront"
const fallback = "crow"

// The handle of the selected terminal's agent, as the Files panel names it; Crow's where
// the selected terminal isn't an agent of the storefront project.
const handleOf = (key: TerminalKey | undefined, workspace: Workspace | undefined): string => {
  const terminal = key?.projectId === project ? terminalOf(workspace, key) : undefined
  return terminal?.handle && terminal.state === "running" && isAgentProgram(terminal.process)
    ? terminal.handle
    : fallback
}

// The panel's group for the Files panel's states, which need the demo's files: the
// storefront project's tree, where the agents change files by themselves too, and the person
// makes, renames and deletes them where the launch offers it.
export const filesGroups = (
  files: DemoFiles | undefined,
  launch: Pick<DemoLaunch, "setFileOperations">,
): readonly DemoActionGroup[] =>
  files
    ? [
        {
          section: "Agents",
          title: "Files",
          actions: [
            {
              label: "Agent writes a file",
              hint: "Open Files: the selected storefront agent's row pulses and its cursor moves to the file, back on one after it stopped (Crow if the selection isn't a storefront agent); an agent that isn't working loses the cursor again at the workspace's next change",
              run: ({ selected, workspace }) => files.write(handleOf(selected(), workspace())),
            },
            {
              label: "Agent writes Checkout.tsx",
              hint: "Open Files and double-click src/checkout/Checkout.tsx (agents demo): the file preview's change of the selected storefront agent (Crow's if none) grows by a line, pulsing cyan, with its cursor at the end of it, and the Files row pulses the same; an agent that isn't working loses the cursor again at the workspace's next change",
              run: ({ selected, workspace }) =>
                files.write(handleOf(selected(), workspace()), demoPaths.checkout),
            },
            {
              label: "Agent stops writing (Files only)",
              hint: "Open Files: the selected storefront agent's cursor goes, its changes stay; only the Files cursor changes, the agent's turn is not (use the Agent group to end or rest it; Crow if none)",
              run: ({ selected, workspace }) => files.endTurn(handleOf(selected(), workspace())),
            },
            {
              label: "Third agent edits Checkout.tsx",
              hint: `Open Files: src/checkout/Checkout.tsx shows moth, crow and ${filesThird} (storefront's third terminal, Claude Code in the agents demos), the chips folding into +1; the row pulses once and ${filesThird} leaves no cursor`,
              // One write and done: the simulation never runs this agent, so nothing else
              // would take its cursor away.
              run: () => {
                files.write(filesThird, demoPaths.checkout)
                files.endTurn(filesThird)
              },
            },
            {
              label: "A folder can't be read",
              hint: "Open Files, then show the panel again (switch panels and back) or end an agent's turn: src/cart, once open, shows a muted \"Can't read this folder\" row",
              run: () => files.degrade("src/cart", "fail"),
            },
            {
              label: "A folder lists only part",
              hint: 'Open Files, then show the panel again or end an agent\'s turn: src/components, once open, lists two files and a muted "More not shown" row',
              run: () => files.degrade("src/components", "truncate"),
            },
            {
              label: "The project's files can't be read",
              hint: "Open Files, then show the panel again or end an agent's turn: the tree gives way to a line saying the files can't be read",
              run: () => files.degrade("", "fail"),
            },
            {
              label: "The project's folder is empty",
              hint: "Open Files, then show the panel again or end an agent's turn: the tree gives way to \"This project's folder is empty.\"",
              run: () => files.degrade("", "empty"),
            },
            {
              label: "The project lists only part",
              hint: 'Open Files, then show the panel again or end an agent\'s turn: the root lists two entries and ends with a muted "More not shown" row',
              run: () => files.degrade("", "truncate"),
            },
            {
              label: "Next hide-list save fails",
              hint: "In Files, the next save of the open project's hidden files fails, once: Save in the Hidden files dialog (the crossed-out eye at the top of the panel) keeps the dialog open with a red line under the lists saying why, and Hide in This Project on a row's right-click puts a red-edged line above the tree saying it couldn't hide that path, with Dismiss; Files read normally again lifts it before then",
              run: () => files.failNextExcludeSave(),
            },
            {
              label: "Hidden files can't be read",
              hint: "Every read of a project's hidden files fails until Files read normally again. Switch to another project and open Files: there is no Hidden files button (the crossed-out eye) at the top of the panel and no Hide in This Project on a row's right-click, and only the patterns for every project hide anything. A panel that read them already keeps them, and Hide in This Project there puts a red-edged line above the tree saying it couldn't hide that path",
              run: () => files.failExcludeReads(),
            },
            {
              label: "Next file operation fails",
              hint: "In Files, the next New File…, New Folder…, Rename… or Delete fails, once: a red-edged line above the tree says it couldn't make, rename or delete that path, and why, with Dismiss, and the tree is as it was; Files read normally again lifts it before then",
              run: () => files.failNextChange(),
            },
            {
              label: "File operations not offered",
              hint: "Files' right-click menus have no New File…, New Folder…, Rename… or Delete, and F2 and Delete on a row do nothing, as on a runner without them; the copies, Refresh and Hide in This Project stay",
              reboots: true,
              run: () => launch.setFileOperations(false),
            },
            {
              label: "File operations offered",
              hint: "Files' right-click menus offer New File… and New Folder…, and Rename… and Delete on a row of the project's folder, with F2 and Delete on a focused row, as the demo starts",
              reboots: true,
              run: () => launch.setFileOperations(true),
            },
            {
              label: "Copying a path fails",
              hint: "Every copy in the page fails until Files read normally again or a reboot: in Files, Copy Path or Copy Relative Path on a row's right-click, Copy Path on the empty space's, or Shift+Alt+C on a focused row shows a red-edged line above the tree saying it couldn't copy that path, with a Dismiss button; hiding the panel clears it",
              run: refuseClipboard,
            },
            {
              label: "Files read normally again",
              hint: "Open Files, then show the panel again or end an agent's turn: every folder lists in full again, and hidden files read again; paths copy, hidden files save, and files are made, renamed and deleted again at once",
              run: () => {
                restoreClipboard()
                files.failNextChange(false)
                files.failNextExcludeSave(false)
                files.failExcludeReads(false)
                for (const folder of ["", "src/cart", "src/components"])
                  files.degrade(folder, undefined)
              },
            },
            {
              label: "Agent creates a file in a folder",
              hint: "Open Files with src/api folded: the folder pulses and shows Crow's chip, and payments.ts is added inside",
              run: () => files.write(fallback, demoPaths.payments),
            },
          ],
        },
      ]
    : []
