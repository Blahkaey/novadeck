import { notePattern, notesIn, type Item, type PlanUnwritableReason } from "@novadeck/core/items"
import type { WorkspaceTarget } from "@novadeck/core/types"
import { outline } from "@novadeck/viewers/text"
import { Diff } from "lucide-react"
import { useRef } from "react"

import { Unavailable } from "../../ArtifactViewer"
import type { MarkdownEditorHandle } from "../../document/editor/MarkdownEditor"
import {
  blockedText,
  SaveNotice,
  stalledText,
  transcriptText,
  unreadableText,
} from "../../document/SaveNotice"
import { lazyView } from "../../lazy-view"
import { PaneTools, usePaneNote } from "../../pane-row"
import type { PlanActions, ItemStore } from "../../store/item-store"
import { fileText, unreadableNow } from "../../store/text-doc"
import { useContent, usePlan } from "../../store/use-item-store"
import { blockOf, currentMarks, type PlanDoc } from "./plan-doc"

// The editor loads when a plan first opens, so the workspace never pays for it: a
// Markdown document's, with the plan's notes, which load with it.
const PlanEditor = lazyView(
  () => import("./plan-editor/PlanEditor").then((module) => module.PlanEditor),
  null,
)

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`

// The headings in the file, with what the latest revision changed and where notes are.
const PlanOutline = ({
  plan,
  jump,
}: {
  plan: PlanDoc
  jump: (at: number) => void
}): React.JSX.Element | null => {
  const headings = outline(plan.text)
  if (!headings.length) return null
  const marks = plan.showChanges ? currentMarks(plan) : []
  const notes = [...plan.text.matchAll(notePattern)].map((match) => match.index)
  // Each heading's section runs to the next heading.
  const sections = headings.map((heading, index) => ({
    ...heading,
    end: headings[index + 1]?.at ?? plan.text.length,
  }))
  return (
    <nav className="spine" aria-label="Plan outline">
      <p className="spine-label">Contents</p>
      <ul className="spine-context">
        {sections.map((section) => {
          const count = notes.filter((at) => at >= section.at && at < section.end).length
          const changed = marks.some((mark) => mark.from < section.end && mark.to > section.at)
          return (
            <li key={section.at}>
              <button onClick={() => jump(section.at)} data-changed={changed}>
                <span>{section.text}</span>
                {count > 0 && <em aria-label={plural(count, "note")}>{count}</em>}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

const PlanBody = ({
  item,
  plan,
  block,
  unreadable,
  pane,
}: {
  item: Item
  plan: PlanDoc
  // Why saving can't work, if it can't.
  block: PlanUnwritableReason | null
  // The file can't be read for now, which may pass.
  unreadable: boolean
  pane: PlanActions
}): React.JSX.Element => {
  const editor = useRef<MarkdownEditorHandle | null>(null)
  const marks = currentMarks(plan)
  const agent = item.plan?.agent ?? "The agent"
  // A plan the runner says lives in messages reads as one that was read-only from the start.
  const readOnly = !plan.writable || block === "transcript"
  // The edits as the file would hold them, with its line breaks.
  const copyable = fileText(plan)
  const resolved =
    plan.resolved > 0 && plan.marked === plan.text
      ? [`${agent} resolved ${plural(plan.resolved, "note")}`]
      : []
  usePaneNote(resolved)
  const changes = `${plural(plan.changes, "change")} since you last read`
  // The one line of words: what keeps the edits from the file, else what keeps the plan from
  // being edited or read whole. Each is its own notice, so one that gives way to another is gone
  // before it comes back.
  const notice =
    !readOnly && block ? (
      <SaveNotice
        key="blocked"
        text={blockedText(block, { kind: "plan", agent })}
        edits={copyable}
        retry={pane.retry}
        retryLabel="Try saving again"
      />
    ) : !readOnly && unreadable ? (
      <SaveNotice
        key="unreadable"
        text={unreadableText("plan")}
        edits={copyable}
        retry={pane.retry}
        retryLabel="Retry"
      />
    ) : !readOnly && plan.stalled ? (
      <SaveNotice
        key="stalled"
        text={stalledText}
        edits={copyable}
        retry={pane.retry}
        retryLabel="Retry"
      />
    ) : !readOnly && plan.unsaved ? (
      <SaveNotice key="unsaved" text="Not saved yet. Trying again." />
    ) : readOnly ? (
      <SaveNotice
        key="read-only"
        text={
          !plan.writable && plan.truncated && item.plan?.source === "file"
            ? "Read-only: it's too long to edit here."
            : transcriptText(agent)
        }
      />
    ) : plan.truncated ? (
      <SaveNotice key="long" text="It's long, so only its start is shown." />
    ) : // Without Novadeck's skill, notes wait for the person to point the agent at them.
    !plan.skill && notesIn(plan.text) > 0 ? (
      <SaveNotice
        key="skill"
        text={`${agent} doesn't have Novadeck's skill. Ask it to re-read the plan.`}
      />
    ) : null
  return (
    <>
      <PaneTools
        tools={
          marks.length > 0
            ? [
                {
                  key: "changes",
                  icon: Diff,
                  label: `${plan.showChanges ? "Hide" : "Show"} the ${changes}`,
                  pressed: plan.showChanges,
                  badge: plan.changes,
                  onClick: pane.toggleChanges,
                },
              ]
            : []
        }
      />
      {notice}
      <div className="pane-reader-body" data-outline={outline(plan.text).length > 0}>
        <PlanOutline plan={plan} jump={(at) => editor.current?.jumpTo(at)} />
        <div className="pane-document-scroll" data-changes={plan.showChanges}>
          <PlanEditor
            id={item.id}
            readOnly={readOnly}
            text={plan.text}
            marks={marks}
            onChange={pane.edit}
            onReady={(handle) => {
              editor.current = handle
            }}
            onClose={pane.closeEditor}
          />
        </div>
      </div>
    </>
  )
}

// One plan, edited where it's read, with its outline: in the pane, or in a window of its
// own once undocked. Or why it can't show, once its plan is gone.
export const PlanTab = ({
  itemStore,
  target,
  item,
}: {
  itemStore: ItemStore
  target: WorkspaceTarget
  item: Item
}): React.JSX.Element => {
  const plan = usePlan(itemStore, item.id)
  const content = useContent(itemStore, target, item)
  // A plan whose file is gone or can't be read still shows the person's edits, which have
  // nowhere to go.
  const kept =
    plan !== undefined &&
    plan.text !== plan.base &&
    (blockOf(plan, content) === "gone" || unreadableNow(content))
  if (content?.state === "unavailable" && !kept)
    return <Unavailable item={item} reason={content.reason} size={content.size} />
  return plan ? (
    // A plan that becomes writable, or stops being so, keeps its editor, history and place.
    <PlanBody
      item={item}
      plan={plan}
      block={blockOf(plan, content)}
      unreadable={unreadableNow(content)}
      pane={itemStore.plan(target, item.id)}
    />
  ) : (
    <div className="artifact-status" />
  )
}
