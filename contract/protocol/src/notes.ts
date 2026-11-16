import { z } from "zod"

import { id } from "./fields.js"
import { singleLine } from "./text.js"

/**
 * How long a note's line and body run at most, in UTF-16 code units, and how many notes a
 * project keeps.
 */
export const noteLimits = { text: 500, body: 8000, perProject: 200 } as const

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

// One of the person's own notes on a project (`notes`): its line, a longer `body`, whether it
// is a todo (it has a checkbox) and, once the person checked it off, when (`doneAt`, in
// milliseconds since the epoch; null while it is open, and always on a plain note).
export const note = z.strictObject({
  id,
  projectId: id,
  text: noteText,
  body: noteBody,
  todo: z.boolean(),
  doneAt: z.number().nullable(),
  createdAt: z.number(),
})

// `notes.watch` events: each project's notes, whole and in the person's order, for every
// project that has any, then `synced`, then a project's notes again each time they change
// (none once its last is removed, or the project is).
export const notesChange = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("changed"), projectId: id, notes: z.array(note) }),
  // Follows the initial `changed` events: a project not reported by now has no notes.
  z.strictObject({ type: z.literal("synced") }),
])

export type Note = z.infer<typeof note>
export type NotesChange = z.infer<typeof notesChange>
