import { harnesses, type AgentName } from "@novadeck/core/harnesses"
import type { ClosedTerminal } from "@novadeck/core/history"
import type { AgentConnection } from "@novadeck/core/port"
import { findQuery, matchesQuery } from "@novadeck/core/terminals/find"

// What History's rows say, apart from how they draw it: when a terminal closed, why it
// can't come back, which rows a search finds, and what removing them says.

export const agentName = (agent: AgentName | null): string =>
  harnesses.find(({ id }) => id === agent)?.name ?? "The agent"

// The last folder of a path, as a row names where a plain terminal ran.
export const folderOf = (cwd: string): string => {
  const trimmed = cwd.replace(/[\\/]+$/, "")
  return trimmed.split(/[\\/]/).at(-1) || cwd
}

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
const dayAndYear = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
})
const full = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})
const fullWithYear = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

// The time of day for a terminal closed today, the date for an earlier one.
export const closedShort = (closedAt: number, now: number): string => {
  const at = new Date(closedAt)
  const today = new Date(now)
  if (sameDay(at, today)) return clock.format(at)
  return (at.getFullYear() === today.getFullYear() ? day : dayAndYear).format(at)
}

// The whole date and time, for a tooltip.
export const closedFull = (closedAt: number, now: number): string => {
  const at = new Date(closedAt)
  return (at.getFullYear() === new Date(now).getFullYear() ? full : fullWithYear).format(at)
}

// How a row stands, as the person is told it. `inert` rows take no click: one restoring, or
// one that can't be. `end` is what stands at the end of its title's line: the day or time it
// closed, or what stands where that does. `reason` says why a row can't
// be restored, or what its click does instead, for assistive technology and the tooltip.
// `connect` is the agent whose connection the row offers to open Preferences for.
export type RowView = {
  readonly state: ClosedTerminal["availability"]["state"]
  readonly inert: boolean
  readonly end:
    | { readonly kind: "time"; readonly text: string }
    | { readonly kind: "restoring" }
    | { readonly kind: "handle"; readonly text: string }
    | { readonly kind: "word"; readonly text: string }
  readonly reason: string | undefined
  readonly connect: AgentName | undefined
}

// A disconnected agent as the backend's agents say it stands now: being changed, not
// installed, its last change failed, or ready to connect.
const disconnectedReason = (
  agent: AgentName,
  connection: AgentConnection | undefined,
): Pick<RowView, "reason" | "connect"> => {
  const name = agentName(agent)
  if (connection?.busy) return { reason: `${name} is changing its connection`, connect: undefined }
  if (connection && !connection.available)
    return { reason: `${name} isn't installed on this computer`, connect: undefined }
  if (connection?.error)
    return { reason: `Connecting ${name} didn't work: ${connection.error}`, connect: agent }
  return { reason: `Connect ${name} to restore this`, connect: agent }
}

export const rowView = (
  row: ClosedTerminal,
  now: number,
  connections: readonly AgentConnection[] | undefined,
): RowView => {
  const { availability } = row
  const time = { kind: "time", text: closedShort(row.closedAt, now) } as const
  const ready: RowView = {
    state: "ready",
    inert: false,
    end: time,
    reason: undefined,
    connect: undefined,
  }
  switch (availability.state) {
    case "ready":
      return ready
    case "restoring":
      return {
        state: "restoring",
        inert: true,
        end: { kind: "restoring" },
        reason: "Restoring",
        connect: undefined,
      }
    case "open":
      return {
        state: "open",
        inert: false,
        end: { kind: "handle", text: `@${availability.handle}` },
        reason: `Open as @${availability.handle}`,
        connect: undefined,
      }
    case "gone":
      return {
        state: "gone",
        inert: true,
        end: { kind: "word", text: "Unavailable" },
        reason:
          availability.reason === "conversation"
            ? `${agentName(row.agent)} no longer has this conversation`
            : "The folder it ran in is gone",
        connect: undefined,
      }
    case "disconnected": {
      const connection = connections?.find(({ agent }) => agent === availability.agent)
      // Connected since the runner last looked; it checks again when the row is restored.
      if (connection?.connected && !connection.busy) return ready
      return {
        state: "disconnected",
        inert: true,
        end: { kind: "word", text: "Not connected" },
        ...disconnectedReason(availability.agent, connection),
      }
    }
  }
}

// Whether the person can remove the row: not one being restored, which its restore settles
// and the backend leaves.
export const removable = (row: ClosedTerminal): boolean => row.availability.state !== "restoring"

// "1 closed terminal", "14 closed terminals".
export const closedCount = (count: number): string =>
  `${count} closed ${count === 1 ? "terminal" : "terminals"}`

// What Clear's question says before it is answered: how many rows go, that they don't come
// back, and how many stay because they are being restored.
export const clearWords = (count: number, staying: number): string => {
  const one = count === 1
  const goes = `${closedCount(count)} ${one ? "is" : "are"} removed from History for good. You can’t restore ${one ? "it" : "them"} after.`
  if (staying === 0) return goes
  return `${goes} ${staying === 1 ? "The one being restored stays." : `The ${staying} being restored stay.`}`
}

// A removal that failed, as the panel says it above the list: one row's by its title, or
// Clear's. The rows are still there.
export type Unremoved =
  | { readonly kind: "row"; readonly id: string; readonly title: string }
  | { readonly kind: "clear" }

export const unremovedWords = (failed: Unremoved): string =>
  failed.kind === "row"
    ? `Couldn’t remove ${failed.title}. It’s still in History.`
    : "Couldn’t clear History. What’s listed is still here."

// What a plain terminal's row adds after its title.
export const rowFolder = (row: ClosedTerminal): string | undefined =>
  row.agent === null ? folderOf(row.cwd) : undefined

// Whether a search finds the row: by handle, title or the folder it ran in (an agent's
// row doesn't show it), as Find a terminal does, or by its summary.
export const rowMatches = (row: ClosedTerminal, typed: string): boolean =>
  matchesQuery([row.handle, row.title, folderOf(row.cwd), row.summary], typed)

// Where what is typed first matches in a text, in the text's own offsets. Lowercasing can
// change a text's length (as "İ" does), so the match is found in the lowered text and its
// offsets are mapped back.
const matchRange = (
  text: string,
  typed: string,
): { readonly start: number; readonly end: number } | undefined => {
  const query = findQuery(typed)
  if (!query) return undefined
  let lowered = ""
  // For each unit of `lowered`, where its character starts and ends in `text`.
  const starts: number[] = []
  const ends: number[] = []
  let at = 0
  for (const char of text) {
    const low = char.toLowerCase()
    for (let unit = 0; unit < low.length; unit++) {
      starts.push(at)
      ends.push(at + char.length)
    }
    lowered += low
    at += char.length
  }
  const found = lowered.indexOf(query)
  if (found < 0) return undefined
  return { start: starts[found]!, end: ends[found + query.length - 1]! }
}

// How far into a summary a match can end and still show within the two lines a row has for
// it, after a plain terminal's folder and at the sidebar's narrowest; and how far before a match an excerpt
// starts, past that.
const shown = 48
const lead = 20

// A summary cut to start a little before the match, with an ellipsis, when the match ends
// further in than the row's two lines show; the whole summary otherwise.
export const summaryExcerpt = (text: string, typed: string): string => {
  const range = matchRange(text, typed)
  if (!range || range.end <= shown) return text
  // A match that starts within the lead of the summary's start, though it ends past what shows
  // (a long phrase), leaves nothing before it to cut.
  const begin = range.start - lead
  if (begin <= 0) return text
  const from = text.lastIndexOf(" ", begin)
  return `…${text.slice(from < 0 ? begin : from + 1)}`
}

// A text cut around its first match of what is typed, for the match to be lit; one piece
// when nothing matches.
export const litPieces = (
  text: string,
  typed: string,
): readonly { readonly text: string; readonly lit: boolean; readonly at: number }[] => {
  const range = matchRange(text, typed)
  if (!range) return [{ text, lit: false, at: 0 }]
  return [
    { text: text.slice(0, range.start), lit: false, at: 0 },
    { text: text.slice(range.start, range.end), lit: true, at: range.start },
    { text: text.slice(range.end), lit: false, at: range.end },
  ].filter((piece) => piece.text !== "")
}

// A row's tooltip: why it can't come back, its title (with who closed it, where an agent
// did), when, and its summary.
export const rowTooltip = (row: ClosedTerminal, view: RowView, now: number): string =>
  [
    ...(view.reason && view.state !== "ready" ? [view.reason] : []),
    row.closedBy ? `${row.title}, closed by @${row.closedBy}` : row.title,
    `Closed ${closedFull(row.closedAt, now)}`,
    ...(row.summary ? [row.summary] : []),
  ].join("\n")
