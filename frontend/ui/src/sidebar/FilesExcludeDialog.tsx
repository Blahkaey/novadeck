import type { FilesExclude } from "@novadeck/core/files"
import { Dialog, DialogDescription, DialogTitle } from "@novadeck/toolkit/Dialog"
import { useId, useState } from "react"

import { FilesExcludeList } from "./FilesExcludeList"

// Where a save stands: being made, or refused and why; null while nothing is under way.
type Saving = { readonly state: "saving" } | { readonly state: "failed"; readonly why: string }

// Whether two lists hold the same patterns, each switched the same, in whatever order.
const samePatterns = (a: FilesExclude, b: FilesExclude): boolean =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([pattern, on]) => b[pattern] === on)

// The Files panel's dialog for the project's own patterns for hiding files, editable, over the
// person's list for every project, which it shows as it is, with a way to it in Preferences.
// What is changed here is the dialog's own until Save, which adds a pattern typed and not added
// first: a save that is refused keeps the dialog open saying why, and Cancel, Escape or a click
// outside leave the project's patterns as they were. Edit in Preferences saves what changed here
// the same way before it goes, and stays to say why if the save is refused. Each time it opens it
// starts from the project's patterns as the panel last read them.
export const FilesExcludeDialog = ({
  open,
  patterns,
  everywhere,
  onSave,
  onClose,
  onSettings,
}: {
  readonly open: boolean
  // The project's own patterns.
  readonly patterns: FilesExclude
  // The person's patterns for every project.
  readonly everywhere: FilesExclude
  // Replaces the project's patterns whole; rejects with the reason when it can't.
  readonly onSave: (patterns: FilesExclude) => Promise<void>
  readonly onClose: () => void
  // Opens Preferences where the patterns for every project are edited.
  readonly onSettings: () => void
}): React.JSX.Element => {
  const id = useId()
  const [draft, setDraft] = useState(patterns)
  // What is typed in the field that adds a pattern.
  const [typed, setTyped] = useState("")
  const [saving, setSaving] = useState<Saving | null>(null)
  // Opening again starts over from the project's patterns.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setDraft(patterns)
      setTyped("")
      setSaving(null)
    }
  }
  const busy = saving?.state === "saving"
  // The patterns as changed here, with the one typed and not added among them.
  const pending = (): FilesExclude => {
    const text = typed.trim()
    return text === "" ? draft : { ...draft, [text]: true }
  }
  // Saves the patterns as changed here, the typed one added to the list, then does `after`.
  const save = (after: () => void): void => {
    const next = pending()
    setDraft(next)
    setTyped("")
    setSaving({ state: "saving" })
    onSave(next).then(
      () => {
        setSaving(null)
        after()
      },
      (error: unknown) =>
        setSaving({
          state: "failed",
          why: error instanceof Error ? error.message : "Novadeck could not save them.",
        }),
    )
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      label="Hidden files"
      initialFocusEl={() => document.getElementById(`${id}-add`)}
      backdropClassName="overlay fixed inset-0 z-50"
      positionerClassName="fixed inset-0 z-50 flex items-center justify-center px-5"
      className="modal files-exclude-dialog flex max-h-[calc(100dvh-48px)] w-[min(480px,calc(100vw-32px))] flex-col gap-3 overflow-y-auto p-5"
    >
      <DialogTitle className="modal-title m-0 text-heading font-medium">Hidden files</DialogTitle>
      <DialogDescription className="modal-description m-0 text-body">
        Files and folders that match a pattern leave the Files panel. A pattern is matched against
        the path from the project&apos;s folder: <code>*.log</code> hides only the logs at the top,{" "}
        <code>**/*.log</code> every one.
      </DialogDescription>
      <section className="flex flex-col gap-2" aria-labelledby={`${id}-project`}>
        <h3 id={`${id}-project`} className="section-label m-0 text-label font-medium">
          This project
        </h3>
        <FilesExcludeList
          patterns={draft}
          label="This project's patterns"
          inputId={`${id}-add`}
          field={{ text: typed, onText: setTyped }}
          {...(busy ? {} : { onChange: setDraft })}
        />
        <p className="settings-description m-0 text-control leading-5">
          Uncheck a pattern to keep it without hiding anything. Add one of the patterns for every
          project and uncheck it to show what it hides, here only.
        </p>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby={`${id}-everywhere`}>
        <h3 id={`${id}-everywhere`} className="section-label m-0 text-label font-medium">
          Every project
        </h3>
        <FilesExcludeList patterns={everywhere} label="Patterns for every project" />
        <button
          type="button"
          className="button min-h-8 self-start px-3 text-control"
          disabled={busy}
          onClick={() => (samePatterns(pending(), patterns) ? onSettings() : save(onSettings))}
        >
          Edit in Preferences
        </button>
      </section>
      {saving?.state === "failed" && (
        <p className="settings-note m-0 text-control leading-5" data-tone="danger" role="alert">
          Couldn&apos;t save this project&apos;s hidden files: {saving.why}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" className="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => save(() => {})}
        >
          Save
        </button>
      </div>
    </Dialog>
  )
}
