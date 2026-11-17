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
// file or folder (inside a folder, beside a file), and to rename or delete it, each with its
// shortcut; then its path on the backend's machine, which its shortcut copies too, and its path
// from the project's root. A row only an agent's work has, or one an agent deleted, isn't in the
// project's folder to change: it offers the copies alone. Where the backend keeps the project's
// own patterns for hiding files, a row also offers to hide itself in the project. Off a row it
// offers a new file or folder in the root, the folder's own path, and Refresh, which reads the
// root and the open folders again; the root's path from itself would be empty, and the root can't
// be hidden.
export const filesMenu = ({
  row,
  directory,
  platform,
  onCopy,
  onRefresh,
  onHide,
  onNew,
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
  if (!row)
    return grouped([
      making,
      [
        { value: "copy-path", label: "Copy Path", onSelect: () => onCopy(directory) },
        { value: "refresh", label: "Refresh", onSelect: onRefresh },
      ],
    ])
  return grouped([
    making,
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
