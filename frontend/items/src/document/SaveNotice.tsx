import type { PlanUnwritableReason } from "@novadeck/core/items"

import { CopyText } from "../ArtifactViewer"

// What the person edits where it's read, and saving it says it can't: a plan, or a file the
// project window shows.
export type SavedKind = "plan" | "file"

// A plan that lives in its agent's messages, which no file holds: it reads, and takes no
// edits or notes.
export const transcriptText = (agent: string): string =>
  `Read-only: this plan lives in ${agent}'s messages, not a file, so notes can't go in it.`

// What the edits are to, as a notice names it: a plan, by the agent whose it is, or a file the
// project window shows.
export type Saved = { readonly kind: "plan"; readonly agent: string } | { readonly kind: "file" }

// Why the person's edits can't be saved, and what's left to them, for a plan or a file. A
// plan in an agent's messages reads as it does when it's read-only from the start.
export const blockedText = (reason: PlanUnwritableReason, saved: Saved): string => {
  const { kind } = saved
  const kept = `Your edits are kept here until you close this ${kind}.`
  const plan = kind === "plan"
  switch (reason) {
    case "gone":
      return `${plan ? "This plan's file" : "This file"} was deleted, so your edits can't be saved. ${kept}`
    case "folder":
      return `Novadeck can't write to this ${plan ? "plan's folder" : "file or its folder"}, so your edits can't be saved. ${kept}`
    case "too-large":
      return `This ${kind} is too large for Novadeck to save your edits. ${kept}`
    case "not-a-plan":
      return plan
        ? `Novadeck can't write to this, since it isn't a plan file, so your edits can't be saved. ${kept}`
        : `Novadeck saves only the file the project window shows, so your edits can't be saved. ${kept}`
    case "outside":
      return plan
        ? `Novadeck saves plans only in the project's folder or the agent's own plans folder, and this one is elsewhere, so your edits can't be saved. ${kept}`
        : `Novadeck saves only the project's own files, and this one is outside its folder, in Git's own folder or an agent's copy, so your edits can't be saved. ${kept}`
    case "moved":
      return plan
        ? `This plan now points at another file, so your edits can't be saved into it. ${kept}`
        : `The window shows another file now, so your edits can't be saved into this one. ${kept}`
    case "not-text":
      return `${plan ? "This plan's file" : "This file"} is no longer text Novadeck can edit, so your edits can't be saved. ${kept}`
    case "transcript":
      return saved.kind === "plan"
        ? transcriptText(saved.agent)
        : `Novadeck can't write to this file, so your edits can't be saved. ${kept}`
  }
}

// The person's edits can't be read back from the file for now, which may pass.
export const unreadableText = (kind: SavedKind): string =>
  `Novadeck can't read this ${kind} right now, so your edits can't be saved. Your edits are kept here until you close this ${kind}.`

// Saves stopped after failing too many times in a row.
export const stalledText = "Novadeck couldn't save your edits after 5 tries."

// The edits that can't reach the file, with the ways out: copy them, or try again where
// trying again can help.
export const SaveNotice = ({
  text,
  edits,
  retry,
  retryLabel,
}: {
  text: string
  edits: string
  retry?: (() => void) | undefined
  retryLabel: string
}): React.JSX.Element => (
  <div className="plan-notice" role="status">
    <p>{text}</p>
    <div className="plan-notice-actions">
      <CopyText text={edits} label="Copy my edits" />
      {retry && (
        <button type="button" className="artifact-open" onClick={retry}>
          {retryLabel}
        </button>
      )}
    </div>
  </div>
)
