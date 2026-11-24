import { CopyFirstDialog } from "@novadeck/toolkit/CopyFirstDialog"
import { SubjectBar, SubjectName, SubjectSide } from "@novadeck/toolkit/SubjectBar"

import {
  leaveConfirm,
  leaveDescription,
  leaveDiscard,
  leaveTitle,
  leaveUncopied,
  type LeaveAsk,
} from "./leave-edits"
import { windowProfile } from "./processes/profiles"

const leaveBar = (ask: LeaveAsk): React.JSX.Element => {
  const { icon: Icon } = windowProfile({ kind: "file", name: ask.name, path: ask.path })
  return (
    <SubjectBar>
      <SubjectSide>
        <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
        <SubjectName>{ask.name}</SubjectName>
      </SubjectSide>
    </SubjectBar>
  )
}

// Asks before the person leaves edits to the project window's file that can't be saved: the
// main answer copies them to the clipboard, then goes on; one whose copy fails stays, says so
// and offers going on without them. Cancel, focused first, stays with the file. While the
// edits are still being saved it says so, with Cancel alone, and turns into that question
// in place once they can't be.
export const LeaveEditsDialog = ({
  question,
  edits,
  onAnswer,
}: {
  // What asks, or null when nothing does.
  readonly question: LeaveAsk | null
  // The edits to copy, as the file would hold them; undefined once none are left to copy.
  readonly edits: (ask: LeaveAsk) => string | undefined
  // The answer to the question asked: go on, or stay.
  readonly onAnswer: (ask: LeaveAsk, go: boolean) => void
}): React.JSX.Element => (
  <CopyFirstDialog
    subject={question}
    bar={leaveBar}
    title={leaveTitle}
    description={leaveDescription}
    uncopied={leaveUncopied}
    confirmLabel={(ask) => leaveConfirm(ask.action)}
    discardLabel={(ask) => leaveDiscard(ask.action)}
    cancelLabel="Cancel"
    text={edits}
    waiting={(ask) => ask.waiting}
    onGo={(ask) => onAnswer(ask, true)}
    onStay={(ask) => onAnswer(ask, false)}
    widthClassName="w-[min(400px,calc(100vw-32px))]"
  />
)
