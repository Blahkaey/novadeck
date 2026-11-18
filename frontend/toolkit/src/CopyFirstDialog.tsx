import { useRef, useState, type ReactNode } from "react"

import { ConfirmDialog } from "./ConfirmDialog"

export type CopyFirstDialogProps<Subject> = {
  // What the dialog asks about, as `ConfirmDialog`'s subject: open while set.
  readonly subject: Subject | null
  readonly bar: (subject: Subject) => ReactNode
  readonly title: (subject: Subject) => string
  // The words under the title: what going on loses.
  readonly description: (subject: Subject) => ReactNode
  // The words once the copy failed: nothing was done, and the ways on.
  readonly uncopied: (subject: Subject) => ReactNode
  // The main answer, which copies first, then goes on.
  readonly confirmLabel: (subject: Subject) => string
  // Going on without the copy, offered once a copy failed.
  readonly discardLabel: (subject: Subject) => string
  readonly cancelLabel: string
  // What to copy; undefined where nothing is left to copy, which goes on at once.
  readonly text: (subject: Subject) => string | undefined
  // Whether going on waits on something that answers by itself, as a save under way: only
  // Cancel shows. The subject that follows it is the same question turned, not another.
  readonly waiting?: (subject: Subject) => boolean
  // The person goes on: copied, or without the copy, as they chose.
  readonly onGo: (subject: Subject) => void
  // The person stays: Cancel, Escape or a click outside.
  readonly onStay: (subject: Subject) => void
  readonly widthClassName: string
}

const neverWaiting = (): boolean => false

// Words a screen reader says as they change: what a question that turned in place now asks.
const spoken = (words: ReactNode): React.JSX.Element => <span aria-live="polite">{words}</span>

// A question whose main answer copies something to the clipboard before going on, as before
// letting go of edits that can't be saved: a copy that fails goes nowhere and says so, and
// then offers going on without it. Cancel, focused first, stays.
export const CopyFirstDialog = <Subject,>({
  subject,
  bar,
  title,
  description,
  uncopied: uncopiedText,
  confirmLabel,
  discardLabel,
  cancelLabel,
  text,
  waiting = neverWaiting,
  onGo,
  onStay,
  widthClassName,
}: CopyFirstDialogProps<Subject>): React.JSX.Element => {
  // The subject up, kept while the dialog animates out, and how many it has asked about: the
  // dialog is built again for each subject and each failed copy, so a confirm it stayed open
  // after doesn't keep it from cancelling. One that waited, with nothing to confirm, turns in
  // place, focus kept, so its words are a live region while it may turn or has (`turning`): a
  // screen reader is told what it now asks.
  const [asked, setAsked] = useState({
    subject,
    count: 0,
    turning: subject !== null && waiting(subject),
  })
  if (subject !== null && subject !== asked.subject) {
    const turned = asked.subject !== null && waiting(asked.subject)
    setAsked({
      subject,
      count: turned ? asked.count : asked.count + 1,
      turning: turned || waiting(subject),
    })
  }
  const kept = asked.subject
  // The subject whose text is being copied: a second confirm meanwhile starts no second
  // copy, and the answer of one the person cancelled meanwhile is let go.
  const copying = useRef<Subject | null>(null)
  // The subject whose text couldn't be copied, and how many tries failed.
  const [uncopied, setUncopied] = useState<{ readonly subject: Subject; readonly tries: number }>()
  // The copy of the subject up failed.
  const failed = uncopied?.subject === kept ? uncopied : undefined
  const stay = (): void => {
    copying.current = null
    setUncopied(undefined)
    if (subject !== null) onStay(subject)
  }
  return (
    <ConfirmDialog
      key={`${asked.count}:${failed?.tries ?? 0}`}
      subject={subject}
      bar={bar}
      title={title}
      description={(shown) => {
        const words = failed ? uncopiedText(shown) : description(shown)
        return asked.turning ? spoken(words) : words
      }}
      confirmLabel={kept === null || waiting(kept) ? null : confirmLabel(kept)}
      {...(failed && {
        alternative: {
          label: discardLabel(failed.subject),
          onSelect: () => {
            setUncopied(undefined)
            onGo(failed.subject)
          },
        },
      })}
      cancelLabel={cancelLabel}
      onCancel={stay}
      onConfirm={() => {
        const shown = subject
        if (shown === null || copying.current !== null) return
        copying.current = shown
        // Whether this copy's answer still counts: the person didn't cancel meanwhile.
        const answered = (): boolean => {
          if (copying.current !== shown) return false
          copying.current = null
          return true
        }
        const copied = (): void => {
          if (!answered()) return
          setUncopied(undefined)
          onGo(shown)
        }
        const notCopied = (): void => {
          if (!answered()) return
          setUncopied((last) => ({
            subject: shown,
            tries: last?.subject === shown ? last.tries + 1 : 1,
          }))
        }
        const copy = text(shown)
        if (copy === undefined) return copied()
        const written = navigator.clipboard?.writeText(copy)
        if (!written) return notCopied()
        written.then(copied, notCopied)
      }}
      widthClassName={widthClassName}
    />
  )
}
