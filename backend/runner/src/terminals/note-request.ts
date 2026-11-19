import { randomUUID } from "node:crypto"

import { noteBody, noteLimits, noteText } from "@novadeck/protocol"
import { z } from "zod"

import { DomainError } from "../errors.js"
import { allowSend, recentSends } from "../messaging/messages.js"
import type { Messaging } from "../messaging/messaging.js"
import type { Call } from "../shell/reports.js"
import type { Notes } from "../workspaces/notes.js"
import { callerOf } from "./callers.js"
import { promptIn } from "./commands.js"
import type { Record } from "./record.js"

/**
 * What an agent asks to add to the person's Notes for its project, through Novadeck's MCP
 * server: one to `perCall` notes, each a line, a todo unless it says not, and more under it.
 */
const noteRequest = z.strictObject({
  notes: z
    .array(
      z.strictObject({ text: noteText, todo: z.boolean().optional(), body: noteBody.optional() }),
    )
    .min(1)
    .max(noteLimits.perCall),
})

/** The MCP server's answer: how many todos and plain notes were added. */
export type NoteAnswer =
  | { readonly ok: true; readonly todos: number; readonly notes: number }
  | { readonly ok: false; readonly reason: string }

/** The request, read strictly, so a refusal names what's wrong. */
export const readNoteRequest = (
  value: unknown,
):
  | { readonly ok: true; readonly request: z.infer<typeof noteRequest> }
  | { readonly ok: false; readonly reason: string } => {
  const parsed = noteRequest.safeParse(value)
  if (parsed.success) return { ok: true, request: parsed.data }
  const [issue] = parsed.error.issues
  const field = issue?.path.at(-1)
  const reason =
    issue?.path.length === 1 && issue.code === "too_big"
      ? `Add at most ${noteLimits.perCall} notes in one call.`
      : issue?.path.length === 1 || issue?.path.length === 0
        ? issue?.code === "unrecognized_keys"
          ? "A call takes only `notes`."
          : `Give \`notes\`: a list of 1 to ${noteLimits.perCall} notes, each with its \`text\`.`
        : field === "text"
          ? `A note's \`text\` is one line of 1 to ${noteLimits.text} characters; put more in its \`body\`.`
          : field === "body"
            ? `A note's \`body\` is Markdown of at most ${noteLimits.body.toLocaleString("en-US")} characters.`
            : field === "todo"
              ? "A note's `todo` is true or false."
              : "A note takes only `text`, `todo` and `body`."
  return { ok: false, reason }
}

/** How many notes one terminal's agents may add in a minute. */
export const notesPerMinute = 20

/** Why a call adds nothing, said to the agent, which is told to say the note in its reply. */
export const noteRefusal = {
  notTheirs:
    "Notes are the user's own, so Novadeck takes one only in a turn their own message " +
    "started. Say in your reply what you would have noted.",
  others:
    "Notes are the user's own, and another agent's message reached this turn, so Novadeck " +
    "takes none in it. Say in your reply what you would have noted.",
  spent: `An agent may add ${notesPerMinute} notes a minute. Say in your reply what you would have noted.`,
  full:
    `The user's Todo board and Notes for this project are full: a project keeps at most ` +
    `${noteLimits.perProject} todos and notes together. Say in your reply what you would have noted.`,
}

/** What the `note` call needs of the runner. */
export type NoteCallsHost = {
  readonly records: () => ReadonlyMap<string, Record>
  readonly stopping: () => boolean
  readonly messaging: () => Pick<Messaging, "personTurn" | "personPrompt">
  /** The person's notes; none where the runner keeps no notes (some tests). */
  readonly notes: () => Pick<Notes, "add"> | undefined
  /** The project a session belongs to. */
  readonly projectOf: (sessionId: string) => string
}

/**
 * Whether the prompt that started the turn is the command the agent that opened the
 * terminal started its first session with, never the person's whatever Enter came before
 * (as `Reports.byCommand` tells of the first prompt).
 */
const openersPrompt = (record: Record, prompt: string | undefined): boolean =>
  record.work?.opened === true &&
  record.openerCommand !== null &&
  prompt !== undefined &&
  promptIn(record.openerCommand, prompt)

/**
 * The `note` tool's calls: an agent adds to the person's Notes for its terminal's project,
 * only as the person asked, in a turn their own message started that no other agent's words
 * reached (`Messaging.personTurn`). It can't read, change or remove a note. Each note it adds
 * says which agent added it, and goes first in the list, in the order given. A terminal's
 * agents add `notesPerMinute` at most a minute.
 */
export class NoteCalls {
  /** When each terminal's agents added notes lately, one time per note. */
  private readonly added = new Map<string, readonly number[]>()

  constructor(private readonly host: NoteCallsHost) {}

  /** A call without the shell's own token learns nothing more. */
  call(call: Call): NoteAnswer | undefined {
    const record = callerOf(this.host.records(), call)
    if (!record || this.host.stopping()) return undefined
    const notes = this.host.notes()
    if (!notes) return undefined
    const read = readNoteRequest(call.request)
    if (!read.ok) return read
    const id = record.summary.id
    const turn = this.host.messaging().personTurn(id)
    const prompt = this.host.messaging().personPrompt(id)
    const agent = record.root?.agent
    if (turn === "others") return { ok: false, reason: noteRefusal.others }
    if (turn !== "person" || agent === undefined || openersPrompt(record, prompt))
      return { ok: false, reason: noteRefusal.notTheirs }
    const at = Date.now()
    const added = read.request.notes
    let times: readonly number[] | undefined = this.recent(id, at)
    for (let each = 0; each < added.length && times; each += 1)
      times = allowSend(times, at, notesPerMinute)
    if (!times) return { ok: false, reason: noteRefusal.spent }
    try {
      notes.add({
        projectId: this.host.projectOf(record.summary.sessionId),
        by: { agent, handle: record.summary.handle },
        notes: added.map(({ text, todo = true, body }) => ({
          id: randomUUID(),
          text,
          todo,
          ...(body !== undefined && { body }),
        })),
      })
    } catch (error) {
      // More than the project keeps; else it went, or the runner is closing: unanswered.
      if (!(error instanceof DomainError)) throw error
      return error.code === "CONFLICT" ? { ok: false, reason: noteRefusal.full } : undefined
    }
    this.added.set(id, times)
    const todos = added.filter(({ todo = true }) => todo).length
    return { ok: true, todos, notes: added.length - todos }
  }

  /** The terminal's recent times, and none of terminals that closed or went quiet. */
  private recent(terminalId: string, at: number): readonly number[] {
    const records = this.host.records()
    for (const [each, times] of this.added) {
      const recent = recentSends(times, at)
      if (recent.length > 0 && records.has(each)) this.added.set(each, recent)
      else this.added.delete(each)
    }
    return this.added.get(terminalId) ?? []
  }
}
