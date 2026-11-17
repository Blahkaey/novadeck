import { absolutePath, relativePath } from "@novadeck/core/files"
import { Chord } from "@novadeck/toolkit/Chord"
import type { ContextMenuItem } from "@novadeck/toolkit/ContextMenu"
import { createElement } from "react"

import { filesShortcutBindings, type Platform } from "../interaction/shortcuts"
import type { FilesRow } from "./files-tree"

// The Files panel's menu, on a row or off one, on the tree's empty space or the line in its
// place, which stand for the project's folder. A row offers its path on the backend's machine,
// which its shortcut copies too, and its path from the project's root; a row only an agent's work
// has, which its folder doesn't list, offers the same. Where the backend keeps the project's own
// patterns for hiding files, a row also offers to hide itself in the project. Off a row it offers
// the folder's own path, and Refresh, which reads the root and the open folders again; the root's
// path from itself would be empty, and the root can't be hidden.
export const filesMenu = ({
  row,
  directory,
  platform,
  onCopy,
  onRefresh,
  onHide,
}: {
  // The row the menu was asked on; undefined for the tree's empty space.
  row: FilesRow | undefined
  // The project's directory, as the backend's machine writes it.
  directory: string
  // The platform whose key names the shortcut is shown in.
  platform: Platform
  onCopy: (text: string) => void
  onRefresh: () => void
  // Hides the row in the project; absent where the backend keeps no patterns of the project's.
  onHide?: ((row: FilesRow) => void) | undefined
}): ContextMenuItem[] =>
  row
    ? [
        {
          value: "copy-path",
          label: "Copy Path",
          detail: createElement(Chord, { keys: filesShortcutBindings(platform).copyPath.display }),
          onSelect: () => onCopy(absolutePath(directory, row.node.path)),
        },
        {
          value: "copy-relative-path",
          label: "Copy Relative Path",
          onSelect: () => onCopy(relativePath(directory, row.node.path)),
        },
        ...(onHide
          ? [
              {
                value: "hide",
                label: "Hide in This Project",
                separated: true,
                onSelect: () => onHide(row),
              },
            ]
          : []),
      ]
    : [
        { value: "copy-path", label: "Copy Path", onSelect: () => onCopy(directory) },
        { value: "refresh", label: "Refresh", separated: true, onSelect: onRefresh },
      ]
