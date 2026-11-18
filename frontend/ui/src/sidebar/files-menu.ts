import { absolutePath, relativePath } from "@novadeck/core/files"
import { Chord } from "@novadeck/toolkit/Chord"
import type { ContextMenuAction } from "@novadeck/toolkit/ContextMenu"
import { createElement } from "react"

import { filesShortcutBindings, type Platform, type Shortcut } from "../interaction/shortcuts"
import { changeable } from "./files-edit"
import type { FilesRow } from "./files-tree"

const keys = (shortcut: Shortcut) => createElement(Chord, { keys: shortcut.display })

// The groups as one list, a hairline above each group that follows another; empty groups go.
const grouped = (groups: readonly (readonly ContextMenuAction[])[]): ContextMenuAction[] =>
  groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      group.map((item, at) => (index > 0 && at === 0 ? { ...item, separated: true } : item)),
    )

// The Files panel's menu, on a row or off one, on the tree's empty space or the line in its
// place, which stand for the project's folder. Where the backend makes them, a row offers a new
// file or folder (inside a folder, beside a file); where it moves and copies them, to cut it, copy
// it, and paste what was cut or copied (inside a folder, beside a file), Paste shown but not
// chosen while there is nothing to paste; and to rename or delete it, each with its shortcut. Then its path on the backend's
// machine, which its shortcut copies too, and its path from the project's root. A row only an
// agent's work has, or one an agent deleted, isn't in the project's folder to change: it offers
// the copies of its paths alone. Where the backend keeps the project's own patterns for hiding
// files, a row also offers to hide itself in the project. Off a row it offers a new file or folder
// in the root, Paste into it, the folder's own path, and Refresh, which reads the root and the
// open folders again; the root's path from itself would be empty, and the root can't be hidden.
export const filesMenu = ({
  row,
  directory,
  platform,
  onCopy,
  onRefresh,
  onHide,
  onNew,
  clipboard,
  onRename,
  onDelete,
}: {
  // The row the menu was asked on; undefined for the tree's empty space.
  row: FilesRow | undefined
  // The project's directory, as the backend's machine writes it.
  directory: string
  // The platform whose key names the shortcuts are shown in.
  platform: Platform
  onCopy: (text: string) => void
  onRefresh: () => void
  // Hides the row in the project; absent where the backend keeps no patterns of the project's.
  onHide?: ((row: FilesRow) => void) | undefined
  // Starts naming a new file, or a folder, where the menu was asked; absent where the backend
  // makes none.
  onNew?: ((row: FilesRow | undefined, folder: boolean) => void) | undefined
  // Cuts the row, to move it where the person pastes, copies it, to copy it there, and pastes
  // what was cut or copied where the menu was asked, `ready` while there is something to paste;
  // absent where the backend doesn't both move and copy files.
  clipboard?:
    | {
        readonly onCut: (row: FilesRow) => void
        readonly onCopy: (row: FilesRow) => void
        readonly ready: boolean
        readonly onPaste: (row: FilesRow | undefined) => void
      }
    | undefined
  // Starts naming the row anew; absent where the backend renames nothing.
  onRename?: ((row: FilesRow) => void) | undefined
  // Asks whether to delete the row; absent where the backend deletes nothing.
  onDelete?: ((row: FilesRow) => void) | undefined
}): ContextMenuAction[] => {
  const bindings = filesShortcutBindings(platform)
  const ours = row === undefined || changeable(row.node)
  const making =
    onNew && ours
      ? [
          { value: "new-file", label: "New File…", onSelect: () => onNew(row, false) },
          { value: "new-folder", label: "New Folder…", onSelect: () => onNew(row, true) },
        ]
      : []
  const pasting =
    clipboard && ours
      ? [
          {
            value: "paste",
            label: "Paste",
            disabled: !clipboard.ready,
            ...(row && { detail: keys(bindings.paste) }),
            onSelect: () => clipboard.onPaste(row),
          },
        ]
      : []
  if (!row)
    return grouped([
      making,
      pasting,
      [
        { value: "copy-path", label: "Copy Path", onSelect: () => onCopy(directory) },
        { value: "refresh", label: "Refresh", onSelect: onRefresh },
      ],
    ])
  return grouped([
    making,
    [
      ...(clipboard && ours
        ? [
            {
              value: "cut",
              label: "Cut",
              detail: keys(bindings.cut),
              onSelect: () => clipboard.onCut(row),
            },
            {
              value: "copy",
              label: "Copy",
              detail: keys(bindings.copy),
              onSelect: () => clipboard.onCopy(row),
            },
          ]
        : []),
      ...pasting,
    ],
    [
      {
        value: "copy-path",
        label: "Copy Path",
        detail: keys(bindings.copyPath),
        onSelect: () => onCopy(absolutePath(directory, row.node.path)),
      },
      {
        value: "copy-relative-path",
        label: "Copy Relative Path",
        onSelect: () => onCopy(relativePath(directory, row.node.path)),
      },
    ],
    [
      ...(onRename && ours
        ? [
            {
              value: "rename",
              label: "Rename…",
              detail: keys(bindings.rename),
              onSelect: () => onRename(row),
            },
          ]
        : []),
      ...(onDelete && ours
        ? [
            {
              value: "delete",
              label: "Delete",
              detail: keys(bindings.delete),
              onSelect: () => onDelete(row),
            },
          ]
        : []),
    ],
    onHide ? [{ value: "hide", label: "Hide in This Project", onSelect: () => onHide(row) }] : [],
  ])
}
