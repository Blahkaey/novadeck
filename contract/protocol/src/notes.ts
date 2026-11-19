import { z } from "zod"

import { agentName } from "./agents.js"
import { id } from "./fields.js"
import { handle } from "./terminals.js"
import { singleLine } from "./text.js"

/**
 * How long a note's line and body run at most, in UTF-16 code units, how many notes a
 * project keeps, and how many an agent adds in one call of its `note` tool.
 */
export const noteLimits = {
  text: 500,
  body: 8000,
  perProject: 200,
  perCall: 20,
} as const

// A note's line: what it says, on one line with no white space around it, without what one
// line may not hold (`singleLine`).
export const noteText = z
  .string()
  .trim()
  .min(1)
  .max(noteLimits.text)
  .regex(singleLine, "A note's line must be one line, without control characters.")
// More under the line, as Markdown; empty for none.
export const noteBody = z.string().max(noteLimits.body)

// The agent that added a note, as the person asked it to with its `note` tool: its harness
// and its terminal's handle when it did, as a feedback draft names its author.
export const noteAuthor = z.strictObject({ agent: agentName, handle })

// The columns of a project's Todo board, in the order it shows them: To do, In progress
// (`doing`) and Done. A plain note is on no board.
export const boardColumn = z.enum(["todo", "doing", "done"])

// One of the person's own notes on a project (`notes`): its line, a longer `body`, whether it
// is a todo (it has a checkbox) and, once the person checked it off, when (`doneAt`, in
// milliseconds since the epoch; null while it is open, and always on a plain note). `doing`
// is true on an open todo the person has in progress, and absent on every other note. `by` names the agent that added it, and is absent on a note the person
// wrote; no change of the person's alters it.
export const note = z.strictObject({
  id,
  projectId: id,
  text: noteText,
  body: noteBody,
  todo: z.boolean(),
  doing: z.boolean().optional(),
  doneAt: z.number().nullable(),
  createdAt: z.number(),
  by: noteAuthor.optional(),
})

// `notes.watch` events: each project's notes, whole and in the person's order, for every
// project that has any, then `synced`, then a project's notes again each time they change
// (none once its last is removed, or the project is).
export const notesChange = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("changed"), projectId: id, notes: z.array(note) }),
  // Follows the initial `changed` events: a project not reported by now has no notes.
  z.strictObject({ type: z.literal("synced") }),
])

export type BoardColumn = z.infer<typeof boardColumn>
export type Note = z.infer<typeof note>
export type NoteAuthor = z.infer<typeof noteAuthor>
export type NotesChange = z.infer<typeof notesChange>
