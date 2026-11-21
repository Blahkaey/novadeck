import { noteLimits, type NoteAuthor } from "@novadeck/core/notes"

import { agentName } from "./history-rows"

// What the Notes panel and the Todo board say, apart from their markup.

export const doneCount = (count: number): string =>
  `${count} done ${count === 1 ? "todo" : "todos"}`

// What Clear done's question says before it is answered: how many go, and that they don't
// come back.
export const clearDoneWords = (count: number): string =>
  `${doneCount(count)} ${count === 1 ? "is" : "are"} deleted for good. You can’t bring ${count === 1 ? "it" : "them"} back.`

// What the mark on a note an agent added says: the agent, and its terminal's handle when it
// did.
export const addedByWords = ({ agent, handle }: NoteAuthor): string =>
  `Added by ${agentName(agent)} · @${handle}`

// Where a plain note went among the others, for assistive technology.
export const movedWords = (text: string, index: number, count: number): string =>
  `${text}, ${index + 1} of ${count}`

// Whether a project holds as many notes as it keeps, so the add field takes no more.
export const notesFull = (count: number): boolean => count >= noteLimits.perProject

export const fullWords = `This project has ${noteLimits.perProject} notes and todos, the most it keeps. Delete some to add more.`

// What the Notes panel says above its list once a change didn't take, and the Todo board above
// its columns.
export const unsavedWords = "Your last change wasn’t saved. The notes are as they were."
export const boardUnsavedWords = "Your last change wasn’t saved. The board is as it was."
