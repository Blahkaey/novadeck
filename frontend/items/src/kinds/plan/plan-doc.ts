import type { ItemContent, PlanUnwritableReason, PlanVersion } from "@novadeck/core/items"

import { unreadableNow, type TextDoc } from "../../store/text-doc"

// A stretch of the text the agent's latest revision wrote.
export type Mark = { readonly from: number; readonly to: number }

// A plan as the pane holds it, by its item: the text the person edits and how it stands
// against the file, with what only a plan has: its skill, and what the agent's latest
// rewrite changed and resolved.
export type PlanDoc = TextDoc & {
  readonly skill: boolean
  // What the latest rewrite wrote, valid for `marked` (the text it produced).
  readonly marks: readonly Mark[]
  readonly marked: string
  readonly changes: number
  readonly showChanges: boolean
  // Notes the agent removed in its latest rewrite, having applied them.
  readonly resolved: number
}

export const lf = (text: string): string => text.replace(/\r\n?/g, "\n")

// The file's line break: CRLF when every line ends so, LF otherwise.
export const eolOf = (text: string): "\n" | "\r\n" => {
  const breaks = text.split("\n").length - 1
  return breaks > 0 && text.split("\r\n").length - 1 === breaks ? "\r\n" : "\n"
}

export const docOf = ({ stamp, plan }: PlanVersion): PlanDoc => ({
  writable: plan.writable,
  skill: plan.skill,
  truncated: plan.truncated,
  base: lf(plan.text),
  revision: stamp,
  eol: eolOf(plan.text),
  text: lf(plan.text),
  marks: [],
  marked: "",
  changes: 0,
  showChanges: false,
  resolved: 0,
  unsaved: false,
  blocked: null,
  stalled: false,
})

// Edits the file doesn't hold and can't take for now: they live only in the pane, so
// closing the plan loses them.
export const stuckEdits = (plan: PlanDoc, content: ItemContent | undefined): boolean =>
  plan.writable &&
  plan.text !== plan.base &&
  (plan.blocked !== null ||
    plan.stalled ||
    blockOf(plan, content) === "gone" ||
    unreadableNow(content))

// Why the person's edits can't reach the plan's file, if they can't: its content says it
// is gone, the backend can't write it, or a save said so. Saving can't work then until
// something changes.
export const blockOf = (
  plan: PlanDoc,
  content: ItemContent | undefined,
): PlanUnwritableReason | null =>
  content?.state === "unavailable" && content.reason === "gone"
    ? "gone"
    : !plan.writable
      ? "transcript"
      : plan.blocked

// The latest rewrite's marks, while the text is still the one they describe.
export const currentMarks = (plan: PlanDoc): readonly Mark[] =>
  plan.marked === plan.text ? plan.marks : []
