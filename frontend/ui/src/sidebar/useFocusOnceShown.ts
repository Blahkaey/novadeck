import { useCallback, useLayoutEffect, useRef } from "react"

import type { FilesRow } from "./files-tree"

// Whether the panel may still move the page's focus, to a row it wants focused: focus is on
// nothing, on a row of the tree `tree`, or left in the closing question whose answer deleted a
// row (a dialog gives back no focus a page placed meanwhile). Never out of the field a name is
// typed in, nor from anywhere else the person put it.
export const focusMovable = (tree: HTMLElement | null): boolean => {
  const focused = document.activeElement
  if (focused === null || focused === document.body) return true
  if (focused.closest('[role="alertdialog"][data-state="closed"]')) return true
  return tree?.contains(focused) === true && !focused.closest(".files-naming-row")
}

// Gives the focus to the row of the tree `tree` at a path once it shows, as a row made or renamed
// with the keyboard, unless the panel may no longer move the focus by then (`focusMovable`); a
// change of `rows` comes with every one. Asked again before then, the last row asked for has it;
// null asks for none.
export const useFocusOnceShown = (
  rows: readonly FilesRow[],
  tree: HTMLElement | null,
  focusRow: (row: FilesRow) => void,
): ((path: string | null) => void) => {
  const focusing = useRef<string | null>(null)
  useLayoutEffect(() => {
    const path = focusing.current
    const row = path !== null && rows.find((each) => each.node.path === path)
    if (!row) return
    focusing.current = null
    if (!focusMovable(tree)) return
    focusRow(row)
  }, [rows, tree, focusRow])
  return useCallback((path: string | null) => {
    focusing.current = path
  }, [])
}
