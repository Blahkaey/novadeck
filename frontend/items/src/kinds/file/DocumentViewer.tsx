import { itemIdOf, type FileContent } from "@novadeck/core/items"
import { createKept, type Kept, type ViewerState } from "@novadeck/viewers"
import type { ClassedRange } from "@novadeck/viewers/markdown"
import { outline } from "@novadeck/viewers/text"
import { useMemo, useRef } from "react"

import type { MarkdownEditorHandle } from "../../document/editor/MarkdownEditor"
import { MarkdownDocument } from "../../document/MarkdownDocument"
import { fileKey } from "./file-doc"

// Where each file's editor was left, by the item showing it and the file it showed: the same
// item shown another file, as the project window's is when the person opens one, opens that
// one at its top, and each file shown again opens where it was left. Apart from the plans',
// so browsing files never pushes a plan's history out.
const savedFiles = createKept<ViewerState>(12)

// The files' store as an editor showing `path` keeps it.
const keptFor = (path: string): Kept<ViewerState> => ({
  get: (id) => savedFiles.get(fileKey(itemIdOf(id), path)),
  keep: (id, state) => savedFiles.keep(fileKey(itemIdOf(id), path), state),
})

const none: readonly ClassedRange[] = []

// A Markdown file as a document, formatted, with its outline beside it: read-only, or edited
// where it's read, its edits going to `onEdit` with `ranges` as the person's edits moved them,
// the lines in `ranges` carrying their class.
export const MarkdownFile = ({
  id,
  name,
  path,
  text,
  readOnly,
  onEdit,
  ranges = none,
}: {
  // The item showing it, whose editor opens again as it was left, while it shows this file.
  id: string
  // The item's name, which labels the document: it reads as the file.
  name: string
  path: string
  text: string
  readOnly: boolean
  onEdit?: ((text: string, ranges: readonly ClassedRange[]) => void) | undefined
  ranges?: readonly ClassedRange[]
}): React.JSX.Element => {
  const editor = useRef<MarkdownEditorHandle | null>(null)
  const kept = useMemo(() => keptFor(path), [path])
  const headings = outline(text)
  return (
    <div className="pane-reader-body" data-outline={headings.length > 0}>
      {headings.length > 0 && (
        <nav className="spine" aria-label="Document outline">
          <p className="spine-label">Contents</p>
          <ul className="spine-context">
            {headings.map((heading) => (
              <li key={heading.at}>
                <button onClick={() => editor.current?.jumpTo(heading.at)}>
                  <span>{heading.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="pane-document-scroll">
        <MarkdownDocument
          id={id}
          kept={kept}
          readOnly={readOnly}
          text={text}
          label={name}
          ranges={ranges}
          {...(onEdit && { onEdit })}
          onReady={(handle) => {
            editor.current = handle
          }}
        />
      </div>
    </div>
  )
}

// A Markdown file the agent showed, as a document, read-only: formatted, with its outline.
// It's the agent's file, not something to edit or note. One the project window couldn't
// have whole to edit says why.
export const DocumentViewer = ({
  id,
  name,
  content,
}: {
  id: string
  name: string
  content: FileContent
}): React.JSX.Element => (
  <div className="pane-reader artifact-document">
    <MarkdownFile
      id={id}
      name={name}
      path={content.path}
      text={content.lines.join("\n")}
      readOnly
    />
    {content.truncated && <p className="artifact-cut">It's long, so only its start is shown.</p>}
  </div>
)
