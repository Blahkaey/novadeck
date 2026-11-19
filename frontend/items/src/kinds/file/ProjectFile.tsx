import type { FileContent, Item, ItemContent } from "@novadeck/core/items"
import type { Lines } from "@novadeck/viewers/editor"
import type { ClassedRange } from "@novadeck/viewers/markdown"
import { lazy, Suspense, useMemo, type ReactNode } from "react"

import { Unavailable } from "../../ArtifactViewer"
import { blockedText, SaveNotice, stalledText, unreadableText } from "../../document/SaveNotice"
import type { ViewProps } from "../../registration"
import { linesOf } from "../../store/file-rewrite"
import type { FileActions } from "../../store/item-store"
import { fileText, unreadableNow } from "../../store/text-doc"
import { useContent, useFileDoc } from "../../store/use-item-store"
import { MarkdownFile } from "./DocumentViewer"
import { fileBlockOf, fileKey, type FileDoc } from "./file-doc"
import { FileViewer } from "./FileViewer"
import { isMarkdown } from "./markdown"
import { previewFor } from "./previews"
import { readOnlyText } from "./uneditable"

// The editor loads when a file is first edited, CodeMirror with it, so the workspace never
// pays for it.
const CodeEditor = lazy(() =>
  import("./editor/CodeEditor").then((module) => ({ default: module.CodeEditor })),
)

// The class on a Markdown file's lines another writer changed (see prose.css).
const changedClass = "cm-file-changed"

// Lines as the stretches of `text` they span, for the Markdown editor, which carries classes
// by offset. A line past the end spans nothing.
export const rangesOf = (text: string, marks: readonly Lines[]): ClassedRange[] => {
  const starts = [0]
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1)
  return marks.flatMap(({ from, to }) => {
    const start = starts[from - 1]
    if (start === undefined) return []
    // The line's end, before its break; the text's end for its last line.
    const end = to < starts.length ? starts[to]! - 1 : text.length
    return [{ from: start, to: end, className: changedClass }]
  })
}

// Ctrl or ⌘ with S: save now, as the code editor does on its own.
const savesNow = (event: React.KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "s"

const listingOf = (path: string, text: string): FileContent => {
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > 1 && lines.at(-1) === "") lines.pop()
  return {
    kind: "file",
    path,
    lines,
    firstLine: 1,
    from: 1,
    to: lines.length,
    total: lines.length,
    clamped: false,
    truncated: false,
  }
}

// A file the project window has whole, edited where it's read: in the code editor, or a
// Markdown file in its document; read-only, with why, where a save would be refused. Above
// it, how saving stands, and where the edits can't reach the file, why, with the ways out.
const TextFile = ({
  item,
  doc,
  content,
  file,
}: {
  item: Item
  doc: FileDoc
  // What the item holds now: this file whole, or, while the person's edits can't reach it,
  // what it holds instead.
  content: ItemContent
  file: FileActions
}): React.JSX.Element => {
  const whole =
    content.state === "ready" && content.content.kind === "text" ? content.content : null
  const reason = whole?.writable === false ? whole.reason : undefined
  const readOnly = !doc.writable
  const edited = doc.text !== doc.base
  const unreadable = unreadableNow(content)
  // A file turned read-only under the person's edits holds them as a refused save would.
  const block = fileBlockOf(doc, content) ?? (reason !== undefined && edited ? reason : null)
  const edits = fileText(doc)
  const ranges = useMemo(() => rangesOf(doc.text, doc.marks), [doc.text, doc.marks])
  const listing = useMemo(
    () => (whole && previewFor(doc.path) ? listingOf(doc.path, doc.text) : undefined),
    [whole, doc.path, doc.text],
  )
  const documentEditor = isMarkdown(doc.path) ? (
    <div className="pane-reader artifact-document">
      <MarkdownFile
        id={item.id}
        name={item.name}
        path={doc.path}
        text={doc.text}
        readOnly={readOnly}
        onEdit={(text, moved) =>
          file.edit(
            text,
            linesOf(
              text,
              moved.filter(({ className }) => className === changedClass),
            ),
          )
        }
        ranges={ranges}
      />
    </div>
  ) : undefined
  const sourceEditor = (at?: number): React.JSX.Element => (
    <Suspense fallback={<div className="artifact-code" />}>
      <CodeEditor
        id={item.id}
        path={doc.path}
        text={doc.text}
        readOnly={readOnly}
        marks={doc.marks}
        label={item.name}
        onEdit={file.edit}
        onSave={file.flush}
        at={at}
      />
    </Suspense>
  )
  return (
    <>
      {reason !== undefined && !edited && <SaveNotice text={readOnlyText[reason]} />}
      {doc.unsaved && !doc.stalled && !block && !unreadable && (
        <SaveNotice text="Not saved yet. Trying again." />
      )}
      {doc.marks.length > 0 && <SaveNotice text="The marked lines changed while you edited." />}
      {block && (
        <SaveNotice
          text={blockedText(block, { kind: "file" })}
          edits={edits}
          retry={readOnly ? undefined : file.retry}
          retryLabel="Try saving again"
        />
      )}
      {!block && unreadable && (
        <SaveNotice
          text={unreadableText("file")}
          edits={edits}
          retry={file.retry}
          retryLabel="Retry"
        />
      )}
      {!block && !unreadable && doc.stalled && (
        <SaveNotice text={stalledText} edits={edits} retry={file.retry} retryLabel="Retry" />
      )}
      {listing ? (
        <FileViewer item={item} content={listing} editors={{ sourceEditor, documentEditor }} />
      ) : (
        (documentEditor ?? sourceEditor())
      )}
    </>
  )
}

// The file the person opened in the project window, followed whole to edit: edited where it's
// read once it comes whole; one the window can't have whole read-only, saying why; and what
// can't show, or hasn't yet, as for any file. Edits not in the file stay in their editor
// whatever the item holds meanwhile, with the ways out, but behind a secret's gate.
export const ProjectFile = ({
  item,
  itemStore,
  target,
  diff,
  worktreeCopy,
  notice,
}: ViewProps & {
  diff?: ReactNode
  worktreeCopy: boolean
  notice?: string | undefined
}): React.JSX.Element => {
  const load = useContent(itemStore, target, item, { edit: !worktreeCopy })
  const whole = load?.state === "ready" && load.content.kind === "text" ? load.content : undefined
  const listing = useMemo(() => {
    if (worktreeCopy && whole) return listingOf(whole.path, whole.text)
    return load?.state === "ready" && load.content.kind === "file" ? load.content : undefined
  }, [load, whole, worktreeCopy])
  // The file the edits are to: the one the item reports whole, else the one it points at.
  const path = whole?.path ?? item.path ?? ""
  const doc = useFileDoc(itemStore, fileKey(item.id, path))
  const file = itemStore.file(target, item.id, path)
  const secret = load?.state === "unavailable" && load.reason === "secret"
  const kept = doc !== undefined && doc.text !== doc.base && !secret
  const editing =
    !worktreeCopy && load !== undefined && doc !== undefined && (whole !== undefined || kept)
  if (diff && !secret) return <>{diff}</>
  return (
    <div
      className="artifact-viewer"
      aria-busy={!editing && !listing && load?.state !== "unavailable"}
      data-document={isMarkdown(path) || undefined}
      onKeyDown={(event) => {
        if (!editing || event.defaultPrevented || !savesNow(event)) return
        event.preventDefault()
        file.flush()
      }}
    >
      {notice && (
        <p className="pane-notice" role="status">
          {notice}
        </p>
      )}
      {worktreeCopy && <p className="pane-notice">Read-only copy from an agent worktree.</p>}
      {editing ? (
        <TextFile item={item} doc={doc} content={load} file={file} />
      ) : load?.state === "unavailable" ? (
        <Unavailable
          item={item}
          reason={load.reason}
          size={load.size}
          onReveal={() => itemStore.reveal(item.id, item.path)}
        />
      ) : listing ? (
        <FileViewer item={item} content={listing} />
      ) : (
        <div className="artifact-status" />
      )}
    </div>
  )
}
