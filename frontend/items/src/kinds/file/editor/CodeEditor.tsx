import type { ItemId } from "@novadeck/core/items"
import { createKept, type ViewerState } from "@novadeck/viewers"
import { mountEditor, type EditorContent, type Lines } from "@novadeck/viewers/editor"
import { useViewer } from "@novadeck/viewers/react"
import { useCallback, useLayoutEffect, useMemo, useRef } from "react"

import { fileKey } from "../file-doc"

// Where each file's editor was left, by the item showing it and the file's path, so each file
// the project window shows again opens at its place, with its undo history.
const savedEditors = createKept<ViewerState>(24)

// A file edited in place, in the editor `@novadeck/viewers/editor` mounts: CodeMirror, which
// loads with it, lazily (see ../ProjectFile.tsx). `text` breaks its lines with `\n`; the
// person's edits go out through `onEdit`, and Ctrl/⌘+S through `onSave`.
export const CodeEditor = ({
  id,
  path,
  text,
  readOnly,
  marks,
  label,
  onEdit,
  onSave,
  at,
}: {
  // The item showing it.
  id: ItemId
  path: string
  text: string
  readOnly: boolean
  // Lines another writer changed, which the editor marks and moves along with the edits.
  marks: readonly Lines[]
  label: string
  onEdit: (text: string) => void
  onSave: () => void
  at?: number | undefined
}): React.JSX.Element => {
  // The latest callbacks, for the editor's own, which it reads once as it mounts.
  const latest = useRef({ onEdit, onSave })
  useLayoutEffect(() => {
    latest.current = { onEdit, onSave }
  })
  const edited = useCallback((next: string) => latest.current.onEdit(next), [])
  const saved = useCallback(() => latest.current.onSave(), [])
  const content = useMemo(
    (): EditorContent => ({ text, path, readOnly, marks }),
    [text, path, readOnly, marks],
  )
  const { ref, viewer } = useViewer(mountEditor, {
    id: fileKey(id, path),
    content,
    label,
    kept: savedEditors,
    onEdit: edited,
    onSave: saved,
  })
  useLayoutEffect(() => {
    if (at !== undefined) viewer?.jumpTo({ line: at })
  }, [viewer, at])
  return (
    <div
      ref={ref}
      className="artifact-code artifact-editor nodrag nopan nowheel"
      data-readonly={readOnly || undefined}
    />
  )
}
