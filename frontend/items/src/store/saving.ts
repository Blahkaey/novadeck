import {
  PlanUnwritableError,
  type Companions,
  type ItemId,
  type PlanUnwritableReason,
  type PlanVersion,
} from "@novadeck/core/items"
import type { MutableStore } from "@novadeck/core/store"
import type { WorkspaceTarget } from "@novadeck/core/types"

import type { TextDoc } from "./text-doc"

// How the person's edits to a document reach its file, whatever the document is: a plan, or
// a file they opened in the project window. Saved once typing pauses, or at once, one save
// at a time; a save the file refused, having changed since, merges like any other writer's
// version, and what's left of the edits goes again; one that failed is tried again, less
// often each time, until `failureCap` fail in a row. One the backend says can never work, and
// one made while the file is gone, stop at once. Either waits for the person to retry. The
// merge code loads only when a document changes, like the editors it shares.

type Sync = typeof import("@novadeck/viewers/sync")

// What a kind of document's saves keep while they're under way, by document.
export type Saves = {
  // The text of the save under way.
  readonly saving: Map<string, string>
  // What lets the save under way go: its answer, or its timing out, then changes nothing, as
  // for a document that's gone.
  readonly dropping: Map<string, () => void>
  // The save waiting for typing to pause, or for the wait after a failure to end.
  readonly waiting: Map<string, ReturnType<typeof setTimeout>>
  // A version that came while a save was under way, applied once it answers: until then the
  // base it was written over isn't known.
  readonly pending: Map<string, PlanVersion>
  // How many saves in a row failed, which spaces out the next try.
  readonly failures: Map<string, number>
  // Whether the wait before the next try of a failed save is running: edits and focus
  // changes leave it alone, so only tries it spaced out count toward the cap.
  readonly backingOff: Set<string>
  // Texts sent in saves whose answer never came: the file may hold any of them.
  readonly unconfirmed: Map<string, readonly string[]>
  // Told, by the document's key, each time a save has settled: answered, refused, failed or
  // timed out, and what that answer brought done. A save under way isn't in the documents'
  // store, so its settling may change nothing there.
  readonly settled: Set<(key: string) => void>
}

export const createSaves = (): Saves => ({
  saving: new Map(),
  dropping: new Map(),
  waiting: new Map(),
  pending: new Map(),
  failures: new Map(),
  backingOff: new Set(),
  unconfirmed: new Map(),
  settled: new Set(),
})

// Tells who listens that a save of the document settled.
const told = (saves: Saves, key: string): void => {
  for (const listener of saves.settled) listener(key)
}

// One document the person edits: where the store holds it, where its saves go, and how a
// version of its file is taken in.
export type Place<State, Doc extends TextDoc> = {
  // Where its saves are kept in `saves`.
  readonly key: string
  readonly target: WorkspaceTarget
  readonly itemId: ItemId
  // The path its edits were made on, which its saves name, so one file's text never lands in
  // another; none for a plan.
  readonly path: string | undefined
  readonly companions: Companions
  readonly store: MutableStore<State>
  readonly saves: Saves
  readonly read: (state: State) => Doc | undefined
  readonly write: (state: State, doc: Doc) => State
  // What the item holds says the file is gone now: saves wait for it to come back.
  readonly gone: (state: State) => boolean
  // What the item holds shows this document's file now.
  readonly shown: (state: State) => boolean
  // A version's text as the editor holds it.
  readonly edited: (text: string) => string
  // The document with a version of its file taken in (see ./plan-rewrite.ts).
  readonly rewritten: (
    doc: Doc,
    version: PlanVersion,
    echo: boolean,
    unconfirmed: readonly string[],
    sync: Sync,
  ) => Doc
}

// Changes the document, if the store holds it. The changed document, or undefined when nothing
// changed.
export const withDoc = <State, Doc extends TextDoc>(
  place: Place<State, Doc>,
  change: (doc: Doc) => Doc,
): Doc | undefined => {
  let changed: Doc | undefined
  place.store.update((state) => {
    const doc = place.read(state)
    if (!doc) return state
    const next = change(doc)
    if (next === doc) return state
    changed = next
    return place.write(state, next)
  })
  return changed
}

// Typing reaches the file once it pauses, not on every keystroke.
const typingPause = 400

export const saveSoon = <State, Doc extends TextDoc>(place: Place<State, Doc>): void => {
  const { saves, key } = place
  if (saves.backingOff.has(key)) return
  clearTimeout(saves.waiting.get(key))
  saves.waiting.set(
    key,
    setTimeout(() => {
      saves.waiting.delete(key)
      persist(place)
    }, typingPause),
  )
}

// Saves what's waiting at once, as when the editor closes.
export const saveNow = <State, Doc extends TextDoc>(place: Place<State, Doc>): void => {
  const { saves, key } = place
  // While a failed save waits to be tried again, only the wait's end tries it.
  if (!saves.backingOff.has(key)) {
    clearTimeout(saves.waiting.get(key))
    saves.waiting.delete(key)
  }
  persist(place)
}

// How long a save may go unanswered before it counts as failed and is tried again.
export const saveTimeout = 20_000

// How many saves in a row may fail before they stop until the person retries.
const failureCap = 5

// Sends the person's edits, if there are any and nothing stops them; `manual` when the
// person asked, which tries past what stopped saves.
const persist = <State, Doc extends TextDoc>(place: Place<State, Doc>, manual = false): void => {
  const { saves, key, store } = place
  const doc = place.read(store.getSnapshot())
  // A document the backend can't write is never saved.
  if (saves.saving.has(key) || !doc?.writable) return
  // Says how saving stands, changing the document only if that's new.
  const stand = (flags: Pick<TextDoc, "unsaved" | "blocked" | "stalled">): void => {
    withDoc(place, (current) =>
      current.unsaved === flags.unsaved &&
      current.blocked === flags.blocked &&
      current.stalled === flags.stalled
        ? current
        : { ...current, ...flags },
    )
  }
  // Nothing left to save, as when the person undid the edit or the other writer wrote the same.
  if (doc.text === doc.base) {
    saves.failures.delete(key)
    stand({ unsaved: false, blocked: null, stalled: false })
    return
  }
  const gone = place.gone(store.getSnapshot())
  if (!manual && (doc.blocked || doc.stalled || gone || saves.backingOff.has(key))) return
  const sent = doc.text
  const basedOn = doc.revision
  saves.saving.set(key, sent)
  const text = doc.eol === "\n" ? sent : sent.replaceAll("\n", doc.eol)
  // Only this attempt's answer counts: one that comes after it timed out is ignored.
  let answered = false
  const settleAttempt = (): boolean => {
    if (answered) return false
    answered = true
    clearTimeout(timer)
    saves.saving.delete(key)
    saves.dropping.delete(key)
    return true
  }
  // A version that came meanwhile applies now, over the base the file still has.
  const applyPending = (): void => {
    const pending = saves.pending.get(key)
    saves.pending.delete(key)
    if (pending) void revise(place, pending)
  }
  // The backend said why it never will: nothing was written, and saves stop.
  const refused = (reason: PlanUnwritableReason): void => {
    // A file that is gone while the stream shows it, or a version of it waiting, was put
    // back meanwhile: that's a failure that may pass, not a verdict.
    if (reason === "gone" && (place.shown(store.getSnapshot()) || saves.pending.has(key)))
      return failed()
    if (!settleAttempt()) return
    saves.failures.delete(key)
    clearTimeout(saves.waiting.get(key))
    saves.waiting.delete(key)
    stand({ unsaved: true, blocked: reason, stalled: false })
    applyPending()
    told(saves, key)
  }
  const failed = (): void => {
    if (!settleAttempt()) return
    // It may have been written all the same: the next version of the file tells.
    saves.unconfirmed.set(key, [...(saves.unconfirmed.get(key) ?? []), sent])
    const failures = (saves.failures.get(key) ?? 0) + 1
    saves.failures.set(key, failures)
    const stalled = failures >= failureCap
    stand({ unsaved: true, blocked: null, stalled })
    applyPending()
    clearTimeout(saves.waiting.get(key))
    if (stalled) {
      saves.waiting.delete(key)
      saves.backingOff.delete(key)
    } else {
      saves.backingOff.add(key)
      saves.waiting.set(
        key,
        setTimeout(
          () => {
            saves.waiting.delete(key)
            saves.backingOff.delete(key)
            persist(place)
          },
          Math.min(30_000, 1000 * 2 ** failures),
        ),
      )
    }
    told(saves, key)
  }
  const timer = setTimeout(failed, saveTimeout)
  saves.dropping.set(key, () => {
    answered = true
    clearTimeout(timer)
  })
  place.companions.save(place.target, place.itemId, text, basedOn, place.path).then(
    async (result) => {
      if (!settleAttempt()) return
      if (result.saved) saves.unconfirmed.delete(key)
      saves.failures.delete(key)
      stand({ unsaved: false, blocked: null, stalled: false })
      const pending = saves.pending.get(key)
      saves.pending.delete(key)
      if (result.saved) {
        withDoc(place, (current) =>
          current.revision === basedOn
            ? { ...current, base: sent, revision: result.stamp }
            : current,
        )
        // A version that came meanwhile was written over this save.
        if (pending) await revise(place, pending)
      } else await revise(place, result.current)
      persist(place)
      told(saves, key)
    },
    (error: unknown) => (error instanceof PlanUnwritableError ? refused(error.reason) : failed()),
  )
}

// The file changed: another writer wrote it over the file as the person left it, or a save
// is reported back. Its changes merge into the person's latest edits, as the kind of
// document has it.
export const revise = async <State, Doc extends TextDoc>(
  place: Place<State, Doc>,
  version: PlanVersion,
): Promise<void> => {
  const { saves, key } = place
  const theirs = place.edited(version.plan.text)
  const inFlight = saves.saving.get(key)
  // A version that isn't the save under way waits for its answer: it may have been
  // written over that save, which the document's base doesn't hold yet.
  if (inFlight !== undefined && inFlight !== theirs) {
    saves.pending.set(key, version)
    return
  }
  const sync = await import("@novadeck/viewers/sync")
  const unconfirmed = saves.unconfirmed.get(key) ?? []
  const echo = inFlight === theirs || unconfirmed.includes(theirs)
  withDoc(place, (doc) => place.rewritten(doc, version, echo, unconfirmed, sync))
  // This version settles what the file holds; saves still unanswered no longer matter.
  saves.unconfirmed.delete(key)
  persist(place)
}

// The person asked to try saving again after saves stopped: they go on, and a document that
// can be written again is cleared of what stopped them.
export const retry = <State, Doc extends TextDoc>(place: Place<State, Doc>): void => {
  const { saves, key } = place
  saves.failures.delete(key)
  saves.backingOff.delete(key)
  withDoc(place, (current) =>
    current.blocked || current.stalled ? { ...current, blocked: null, stalled: false } : current,
  )
  clearTimeout(saves.waiting.get(key))
  saves.waiting.delete(key)
  persist(place, true)
}

// A document that's gone: its saves stop, and what they kept goes. A save under way is let
// go, so neither its answer nor its timing out brings any of it back.
export const forget = (saves: Saves, key: string): void => {
  saves.dropping.get(key)?.()
  saves.dropping.delete(key)
  clearTimeout(saves.waiting.get(key))
  for (const each of [
    saves.saving,
    saves.waiting,
    saves.pending,
    saves.failures,
    saves.unconfirmed,
  ])
    each.delete(key)
  saves.backingOff.delete(key)
}
