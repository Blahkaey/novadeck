import { File, Folder } from "lucide-react"
import { useId, useLayoutEffect, useRef, useState } from "react"

import { nameOf, nameSelection, type NameCheck } from "./files-edit"
import { indent, type FilesNaming } from "./files-tree"

// The field a name is typed in. Enter makes the change a name that will do asks for, and keeps
// the field open on one that won't; Escape ends it. Leaving it makes the change a name that will do
// asks for, and ends it otherwise; the window losing focus, as to another app, leaves it as it is,
// to come back to. A line under it says what is wrong with the name. Keys an input method composes
// with are its own.
const NameInput = ({
  label,
  initial,
  selection,
  check,
  onCommit,
  onEnd,
}: {
  label: string
  initial: string
  // What starts selected, from and to.
  selection: readonly [number, number]
  check: (typed: string) => NameCheck
  // `keyboard` where a key ended it, so the tree takes the focus back.
  onCommit: (path: string, keyboard: boolean) => void
  onEnd: (keyboard: boolean) => void
}): React.JSX.Element => {
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  // A key already answered for the field, so its blur as it goes says nothing more.
  const ended = useRef(false)
  const problemId = useId()
  useLayoutEffect(() => {
    input.current?.focus()
    input.current?.setSelectionRange(...selection)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Only as it opens.
  }, [])
  const result = check(value)
  const problem = result.outcome === "invalid" ? result.problem : undefined
  return (
    <span className="files-naming-field">
      <input
        ref={input}
        aria-label={label}
        aria-invalid={problem !== undefined}
        aria-describedby={problem === undefined ? undefined : problemId}
        value={value}
        autoComplete="off"
        spellCheck={false}
        className="field files-naming-input text-body"
        onChange={(event) => setValue(event.target.value)}
        // The text field's own menu, to cut and paste, not the tree's.
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          if (event.key !== "Enter" && event.key !== "Escape") return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === "Enter" && result.outcome === "invalid") return
          ended.current = true
          if (event.key === "Enter" && result.outcome === "commit") onCommit(result.path, true)
          else onEnd(true)
        }}
        onBlur={() => {
          if (ended.current || !document.hasFocus()) return
          ended.current = true
          if (result.outcome === "commit") onCommit(result.path, false)
          else onEnd(false)
        }}
      />
      {problem !== undefined && (
        <span id={problemId} className="files-naming-problem text-caption" aria-live="polite">
          {problem}
        </span>
      )}
    </span>
  )
}

// The line a name is typed in: a new file's or folder's, first in the folder it goes in, or a
// row's new name, in that row's place.
export const NameRow = ({
  line,
  check,
  onCommit,
  onEnd,
}: {
  line: FilesNaming
  check: (typed: string) => NameCheck
  onCommit: (path: string, keyboard: boolean) => void
  onEnd: (keyboard: boolean) => void
}): React.JSX.Element => {
  const { naming, depth } = line
  const Icon = naming.folder ? Folder : File
  const name = naming.kind === "rename" ? nameOf(naming.path) : ""
  const what = naming.folder ? "folder" : "file"
  return (
    <div role="none" className="files-naming-row" data-folder={naming.folder}>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          className="files-guide"
          aria-hidden="true"
          style={{ left: 12 + indent * level }}
        />
      ))}
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-label={naming.kind === "rename" ? `Renaming ${name}` : `New ${what}`}
        className="files-naming-line"
        style={{ paddingLeft: 6 + indent * depth }}
      >
        <span className="files-twisty" aria-hidden="true" />
        <span className="files-icon" aria-hidden="true">
          <Icon size={14} strokeWidth={1.5} />
        </span>
        <NameInput
          label={naming.kind === "rename" ? `New name for ${name}` : `Name of the new ${what}`}
          initial={name}
          selection={nameSelection(name, naming.folder)}
          check={check}
          onCommit={onCommit}
          onEnd={onEnd}
        />
      </div>
    </div>
  )
}
