import {
  kindRules,
  planVersionOf,
  type Companions,
  type ItemContent,
  type ItemId,
  type PageTrouble,
  type PlanVersion,
} from "@novadeck/core/items"
import {
  createStore,
  type MutableStore,
  type Store,
  type WorkspaceStore,
} from "@novadeck/core/store"
import type { Workspace, WorkspaceTarget } from "@novadeck/core/types"
import type { Lines } from "@novadeck/viewers/editor"

import {
  editedText,
  fileBlockOf,
  fileDocOf,
  fileGone,
  fileKey,
  fileVersionOf,
  type FileDoc,
} from "../kinds/file/file-doc"
import { currentMarks, docOf, lf, type Mark, type PlanDoc } from "../kinds/plan/plan-doc"
import { blobs } from "../parts/blobs"
import { fileRewritten } from "./file-rewrite"
import { rewritten } from "./plan-rewrite"
import { itemIn, itemsOf, pointedAt, pointedIn, targetOf } from "./pointing"
import {
  createSaves,
  forget,
  retry,
  revise,
  saveNow,
  saveSoon,
  saveTimeout,
  withDoc,
  type Place,
  type Saves,
} from "./saving"
import { fileText, unreadableNow } from "./text-doc"

// What the items package holds while the app runs, apart from the items themselves and
// how bars are arranged, which the workspace store keeps: each plan as the person edits
// it, each file the person edits in the project window, what each item last loaded, and
// which items that may hold secrets the person chose to see. Every plan is followed for as
// long as it exists; anything else only while something shows it. Components read it
// through ./use-item-store.ts.

export type ItemStoreState = {
  // Each plan once its first version came, by its item.
  readonly plans: Readonly<Record<ItemId, PlanDoc>>
  // Each file the project window shows whole to edit, once its text first came, by its item
  // and path (`fileKey`): it goes with what the item held, unless edits to it haven't reached
  // the file yet, which stay, and keep being saved, until they do, when it goes unless the item
  // still shows it, or until the item goes.
  readonly files: Readonly<Record<string, FileDoc>>
  // What each item held when it last reported, a plan's too.
  readonly content: Readonly<Record<ItemId, ItemContent>>
  // Items that may hold secrets, which the person asked to see, each with what it pointed at
  // then. Pointed elsewhere since, the yes is no longer there: see `isRevealed`.
  readonly revealed: Readonly<Record<ItemId, string>>
  // The shell each shells item has unfolded to its whole tail, by the shell's id: what the
  // person unfolded, or the chat's shell line they opened it from.
  readonly unfolded: Readonly<Record<ItemId, string>>
}

const emptyState: ItemStoreState = {
  plans: {},
  files: {},
  content: {},
  revealed: {},
  unfolded: {},
}

// What can be done with a plan, apart from showing it.
export type PlanActions = {
  // The person edited it: the file changes, for the agent to read. `marks` are the latest
  // rewrite's highlights, moved along with the edit.
  readonly edit: (text: string, marks: readonly Mark[]) => void
  // The editor closed: notes left empty in the plan go, from the plan as it now stands,
  // and edits waiting for a pause in typing are saved.
  readonly closeEditor: () => void
  // Focus left the plan: what's waiting for a pause in typing is saved now, so an agent
  // told to re-read it finds it.
  readonly flush: () => void
  // The person asked to try saving again after saves stopped: they go on, and a plan
  // that can be written again is cleared of what stopped them.
  readonly retry: () => void
  readonly toggleChanges: () => void
}

// What can be done with a file the person edits in the project window, apart from showing it.
export type FileActions = {
  // The person edited it: it's saved once typing pauses. `marks`, where the editor tells them,
  // are the lines another writer changed, moved along with the edit.
  readonly edit: (text: string, marks?: readonly Lines[]) => void
  // Focus left it, or the person asked to save: what's waiting for a pause in typing is
  // saved now.
  readonly flush: () => void
  // The person asked to try saving again after saves stopped, as for a plan.
  readonly retry: () => void
}

// How the edits to a file stood once a save of them was asked for: in the file, or kept in
// Novadeck alone, since they can't get there now.
export type FileLeft = "saved" | "stuck"

export type ItemStore = {
  readonly store: Store<ItemStoreState>
  // Follows an item while something shows it; returns the release. With `edit`, a file
  // that can be edited is followed whole, as the project window shows its file, for every
  // place that shows the item: one followed without it, as an image the window showed
  // before, is followed again whole.
  readonly watch: (
    target: WorkspaceTarget,
    itemId: ItemId,
    options?: { readonly edit?: boolean },
  ) => () => void
  // The person asked to see an item that may hold secrets, as the file at `shown` they saw
  // its gate for: an item pointed elsewhere since stays held.
  readonly reveal: (itemId: ItemId, shown: string | null) => void
  // Unfolds one shell of a shells item to its whole tail, folding the one that was, or
  // folds it all with null. The pane shows it that way, whoever opens it.
  readonly unfold: (itemId: ItemId, shellId: string | null) => void
  readonly plan: (target: WorkspaceTarget, itemId: ItemId) => PlanActions
  // The file the item showed at `path` as the person edits it.
  readonly file: (target: WorkspaceTarget, itemId: ItemId, path: string) => FileActions
  // Saves the person's edits to the file the item showed at `path` at once, as before the
  // window shows another, closes, or the file moves or goes. Undefined when nothing is left
  // to save; else answers once the edits are in the file, or once they can't get there: a
  // save refused, saves stopped, the file gone, unreadable, no longer one the window edits
  // whole or no longer writable, or nothing settled within a save's own time (20 s). A save
  // that failed and is tried again is waited out.
  readonly saveFile: (
    target: WorkspaceTarget,
    itemId: ItemId,
    path: string,
  ) => Promise<FileLeft> | undefined
  // The person's edits to the file the item showed at `path`, as the file would hold them, to
  // copy before they're let go; undefined where the store holds no document of it.
  readonly fileEdits: (itemId: ItemId, path: string) => string | undefined
  // Lets go of the person's edits to the file the item showed at `path`, unsaved, as once they
  // copied them to leave it: it is the file as last read, while the item still shows it and
  // has read it, and nothing otherwise.
  readonly dropFile: (itemId: ItemId, path: string) => void
  // Tells what went wrong on a live page that shows `shown` of the item loaded.
  readonly trouble: (
    target: WorkspaceTarget,
    itemId: ItemId,
    shown: number,
    troubles: readonly PageTrouble[],
  ) => void
  // One file of a changes item as a selection of its layers changed it: the backend's
  // answer, read when asked for.
  readonly changeFile: NonNullable<Companions["changeFile"]>
  // The person read a file of a changes item. Best effort: it never fails, and a backend that
  // can't keep it does nothing.
  readonly changeRead: (target: WorkspaceTarget, itemId: ItemId, path: string) => void
  // Follows every plan in the workspace from here on; returns the stop.
  readonly connect: () => () => void
  // An item's file in parts, for a kind read so: the backend's, where it has one.
  readonly part?: Companions["part"]
  // Takes a picture of a live page for it to rest as: the backend's, where it has one.
  readonly picture?: Companions["picture"]
  // Makes a live page's view a phone's, or not: the backend's, where it has one.
  readonly phone?: Companions["phone"]
}

type Followed = {
  readonly target: WorkspaceTarget
  // The file the person asked to see, as its path, while it's what the item points at.
  reveal: string | undefined
  // What the item pointed at when it was followed, which following again follows when it
  // changes; undefined until the workspace shows the item.
  pointed?: string | undefined
  stop: () => void
  // How many places show it, and whether it's a plan, which is followed regardless.
  watchers: number
  plan: boolean
  // Whether a file that can be edited is followed whole, to edit.
  edit: boolean
  // Once nothing shows it, the wait before it's let go.
  lingering?: ReturnType<typeof setTimeout> | undefined
}

type Session = {
  readonly companions: Companions
  readonly workspace: WorkspaceStore
  readonly store: MutableStore<ItemStoreState>
  readonly followed: Map<ItemId, Followed>
  // What the plans' saves keep under way, by item, and the files', by `fileKey`.
  readonly planSaves: Saves
  readonly fileSaves: Saves
  // The items in the workspace when it was last looked at: one gone since was closed, and the
  // bytes loaded for it go with it.
  readonly items: Set<ItemId>
}

// The file the person's yes to seeing an item was for, if it still holds: it was to the file
// the item pointed at then, so another file, whenever it came, is held back again.
const revealedFor = (session: Session, id: ItemId): string | undefined => {
  const asked = session.store.getSnapshot().revealed[id]
  const item = itemIn(session.workspace.getSnapshot(), id)
  return asked !== undefined && item && asked === pointedAt(item)
    ? (item.path ?? undefined)
    : undefined
}

// A plan where the store holds it and the engine saves it (./saving.ts).
const planPlace = (
  session: Session,
  target: WorkspaceTarget,
  id: ItemId,
): Place<ItemStoreState, PlanDoc> => ({
  key: id,
  target,
  itemId: id,
  path: undefined,
  companions: session.companions,
  store: session.store,
  saves: session.planSaves,
  read: (state) => state.plans[id],
  write: (state, doc) => ({ ...state, plans: { ...state.plans, [id]: doc } }),
  gone: (state) => {
    const content = state.content[id]
    return content?.state === "unavailable" && content.reason === "gone"
  },
  shown: (state) => state.content[id]?.state === "ready",
  edited: lf,
  rewritten,
})

// What the item holds, while it points at `path`: that file's, and nothing of it otherwise.
const heldAt = (
  session: Session,
  id: ItemId,
  path: string,
  state: ItemStoreState,
): ItemContent | undefined =>
  itemIn(session.workspace.getSnapshot(), id)?.path === path ? state.content[id] : undefined

// A file the item showed at `path`, where the store holds it and the engine saves it.
const filePlace = (
  session: Session,
  target: WorkspaceTarget,
  id: ItemId,
  path: string,
): Place<ItemStoreState, FileDoc> => {
  const key = fileKey(id, path)
  const held = (state: ItemStoreState): ItemContent | undefined => heldAt(session, id, path, state)
  return {
    key,
    target,
    itemId: id,
    path,
    companions: session.companions,
    store: session.store,
    saves: session.fileSaves,
    read: (state) => state.files[key],
    write: (state, doc) => ({ ...state, files: { ...state.files, [key]: doc } }),
    gone: (state) => fileGone(held(state)),
    shown: (state) => held(state)?.state === "ready",
    edited: (text) => editedText(text).text,
    rewritten: fileRewritten,
  }
}

// How long what an item held stays once nothing shows it.
const lingerMs = 30_000

// A plan's version came again: the file is back, or can be written again, and what stopped
// saves no longer holds. A fresh version also means the link is healthy: saves that gave up
// try again. Then it merges into the plan.
const plannedAgain = (place: Place<ItemStoreState, PlanDoc>, version: PlanVersion): void => {
  if (place.read(place.store.getSnapshot())?.stalled) place.saves.failures.delete(place.key)
  withDoc(place, (plan) =>
    plan.blocked === "gone" || (plan.blocked === "transcript" && version.plan.writable)
      ? { ...plan, blocked: null, stalled: false }
      : plan.stalled
        ? { ...plan, stalled: false }
        : plan,
  )
  void revise(place, version)
}

// A file's text came again: it is there, the item points at it, and it is text, so saves
// refused for its being gone, elsewhere or no text go on, as do saves that gave up. Then it
// merges into the person's edits.
const fileAgain = (place: Place<ItemStoreState, FileDoc>, version: PlanVersion): void => {
  if (place.read(place.store.getSnapshot())?.stalled) place.saves.failures.delete(place.key)
  withDoc(place, (doc) =>
    doc.blocked === "gone" || doc.blocked === "moved" || doc.blocked === "not-text"
      ? { ...doc, blocked: null, stalled: false }
      : doc.stalled
        ? { ...doc, stalled: false }
        : doc,
  )
  void revise(place, version)
}

// The item reported what it holds: a plan's first version becomes its document, as does a
// file's first whole text, and later ones merge into them.
const received = (
  session: Session,
  target: WorkspaceTarget,
  id: ItemId,
  content: ItemContent,
): void => {
  const version = planVersionOf(content)
  const file = fileVersionOf(content)
  const state = session.store.getSnapshot()
  const known = state.plans[id] !== undefined
  const fileKnown = file !== undefined && state.files[fileKey(id, file.path)] !== undefined
  session.store.update((current) => {
    const first = version && !known
    const firstFile = file && !fileKnown
    if (current.content[id] === content && !first && !firstFile) return current
    return {
      ...current,
      content: { ...current.content, [id]: content },
      ...(first ? { plans: { ...current.plans, [id]: docOf(version) } } : {}),
      ...(firstFile
        ? {
            files: {
              ...current.files,
              [fileKey(id, file.path)]: fileDocOf(id, file.path, file.version),
            },
          }
        : {}),
    }
  })
  if (version && known) plannedAgain(planPlace(session, target, id), version)
  if (file && fileKnown) fileAgain(filePlace(session, target, id, file.path), file.version)
}

const follow = (
  session: Session,
  target: WorkspaceTarget,
  id: ItemId,
  from: Pick<Followed, "watchers" | "plan" | "edit">,
): Followed => {
  const reveal = revealedFor(session, id)
  const entry: Followed = {
    target,
    reveal,
    pointed: pointedIn(session.workspace.getSnapshot(), id),
    stop: () => {},
    watchers: from.watchers,
    plan: from.plan,
    edit: from.edit,
  }
  // Known before following starts: the backend may report at once.
  session.followed.set(id, entry)
  listen(session, id, entry)
  return entry
}

// Starts what the backend reports for an item, as it's followed now. A report that
// comes after it stops, as one held back before the item was revealed, is let go.
const listen = (session: Session, id: ItemId, entry: Followed): void => {
  const { target, reveal, edit } = entry
  let live = true
  const options = { reveal, ...(edit && { edit }) }
  const stop = session.companions.follow(target, id, options, (content) => {
    if (live && session.followed.get(id) === entry) received(session, target, id, content)
  })
  entry.stop = () => {
    live = false
    stop()
  }
}

// Whether a file's edits are all in the file, none on their way.
const settledFile = (session: Session, key: string, doc: FileDoc): boolean =>
  doc.text === doc.base && !session.fileSaves.saving.has(key)

// The item's file documents go but the one at `kept`, each that holds nothing unsaved.
const dropSettled = (session: Session, id: ItemId, kept?: string): void => {
  const going = Object.entries(session.store.getSnapshot().files).filter(
    ([key, doc]) => doc.item === id && doc.path !== kept && settledFile(session, key, doc),
  )
  if (going.length === 0) return
  for (const [key] of going) forget(session.fileSaves, key)
  session.store.update((state) => ({
    ...state,
    files: Object.fromEntries(
      Object.entries(state.files).filter(([key]) => !going.some(([gone]) => gone === key)),
    ),
  }))
}

// A file's document whose edits all reached the file goes once nothing shows it there: the
// item is let go, or points at another file now.
const letGoUnseen = (session: Session, key: string): void => {
  const doc = session.store.getSnapshot().files[key]
  if (!doc || !settledFile(session, key, doc)) return
  const item = itemIn(session.workspace.getSnapshot(), doc.item)
  if (session.followed.has(doc.item) && item?.path === doc.path) return
  forget(session.fileSaves, key)
  session.store.update((state) => {
    const { [key]: _gone, ...files } = state.files
    return { ...state, files }
  })
}

// An item pointed elsewhere is followed again: what it held is dropped, and so is the
// person's yes to seeing it, which was to the file it pointed at then. A file it showed goes
// too, unless edits to it haven't reached it yet.
const refollow = (session: Session, id: ItemId, entry: Followed, pointed: string): void => {
  entry.stop()
  entry.reveal = undefined
  entry.pointed = pointed
  session.store.update((state) => {
    if (!(id in state.content) && !state.revealed[id]) return state
    const { [id]: _content, ...content } = state.content
    const { [id]: _revealed, ...revealed } = state.revealed
    return { ...state, content, revealed }
  })
  dropSettled(session, id, itemIn(session.workspace.getSnapshot(), id)?.path ?? undefined)
  listen(session, id, entry)
}

// A place that edits shows an item followed without editing: it's followed again, whole,
// what it held dropped, as it isn't what an editor reads.
const followToEdit = (session: Session, id: ItemId, entry: Followed): void => {
  entry.stop()
  entry.edit = true
  session.store.update((state) => {
    if (!(id in state.content)) return state
    const { [id]: _content, ...content } = state.content
    return { ...state, content }
  })
  listen(session, id, entry)
}

const unfollow = (session: Session, id: ItemId): void => {
  const entry = session.followed.get(id)
  if (!entry) return
  session.followed.delete(id)
  clearTimeout(entry.lingering)
  entry.stop()
}

// Nothing shows it any more: what it last held goes, so a large image doesn't stay in
// memory, and so does a file it showed whose edits are all saved. It loads again when
// something shows it.
const release = (session: Session, id: ItemId): void => {
  unfollow(session, id)
  session.store.update((state) => {
    if (!(id in state.content)) return state
    const { [id]: _gone, ...content } = state.content
    return { ...state, content }
  })
  dropSettled(session, id)
}

// Nothing shows it now: it goes after a while, so switching back to a terminal soon after
// finds it as it was, without loading it again.
const linger = (session: Session, id: ItemId, entry: Followed): void => {
  if (entry.watchers > 0 || entry.plan) return
  clearTimeout(entry.lingering)
  entry.lingering = setTimeout(() => {
    entry.lingering = undefined
    if (entry.watchers === 0 && !entry.plan && session.followed.get(id) === entry)
      release(session, id)
  }, lingerMs)
}

// A record without the items that are gone.
const keep = <Value>(
  present: ReadonlyMap<ItemId, unknown>,
  record: Readonly<Record<ItemId, Value>>,
): Readonly<Record<ItemId, Value>> => {
  const kept = Object.entries(record).filter(([id]) => present.has(id as ItemId))
  return kept.length === Object.keys(record).length
    ? record
    : (Object.fromEntries(kept) as Record<ItemId, Value>)
}

// The file documents of the items still there.
const keepFiles = (
  present: ReadonlyMap<ItemId, unknown>,
  files: Readonly<Record<string, FileDoc>>,
): Readonly<Record<string, FileDoc>> => {
  const kept = Object.entries(files).filter(([, doc]) => present.has(doc.item))
  return kept.length === Object.keys(files).length ? files : Object.fromEntries(kept)
}

// Follows every plan in the workspace, stops following what's gone, and forgets it.
const reconcile = (session: Session, workspace: Workspace): void => {
  const present = new Map<
    ItemId,
    { readonly target: WorkspaceTarget; readonly plan: boolean; readonly pointed: string }
  >()
  for (const project of workspace.projects)
    for (const each of project.history)
      for (const item of each.state.items)
        present.set(item.id, {
          target: { projectId: project.id, workspaceSessionId: each.id },
          plan: kindRules[item.kind].follow === "always",
          pointed: pointedAt(item),
        })
  for (const id of session.items) if (!present.has(id)) blobs.drop(id)
  session.items.clear()
  for (const id of present.keys()) session.items.add(id)
  for (const [id, entry] of session.followed) {
    const found = present.get(id)
    if (!found) {
      unfollow(session, id)
      continue
    }
    if (entry.pointed === undefined) entry.pointed = found.pointed
    else if (entry.pointed !== found.pointed) refollow(session, id, entry, found.pointed)
    if (entry.plan && !found.plan) {
      entry.plan = false
      linger(session, id, entry)
    }
  }
  const { planSaves, fileSaves } = session
  const planned = new Set([
    ...planSaves.saving.keys(),
    ...planSaves.waiting.keys(),
    ...planSaves.pending.keys(),
    ...planSaves.failures.keys(),
    ...planSaves.unconfirmed.keys(),
  ])
  for (const id of planned) if (!present.has(id as ItemId)) forget(planSaves, id)
  for (const [key, doc] of Object.entries(session.store.getSnapshot().files))
    if (!present.has(doc.item)) forget(fileSaves, key)
  for (const [id, { target, plan }] of present) {
    if (!plan) continue
    const entry = session.followed.get(id)
    if (entry) entry.plan = true
    else follow(session, target, id, { watchers: 0, plan: true, edit: false })
  }
  session.store.update((state) => {
    const next = {
      plans: keep(present, state.plans),
      files: keepFiles(present, state.files),
      content: keep(present, state.content),
      revealed: keep(present, state.revealed),
      unfolded: keep(present, state.unfolded),
    }
    return next.plans === state.plans &&
      next.files === state.files &&
      next.content === state.content &&
      next.revealed === state.revealed &&
      next.unfolded === state.unfolded
      ? state
      : next
  })
}

export const createItemStore = ({
  companions,
  workspace,
}: {
  readonly companions: Companions
  readonly workspace: WorkspaceStore
}): ItemStore => {
  const session: Session = {
    companions,
    workspace,
    store: createStore<ItemStoreState>(emptyState),
    followed: new Map(),
    planSaves: createSaves(),
    fileSaves: createSaves(),
    items: new Set(),
  }
  session.fileSaves.settled.add((key) => letGoUnseen(session, key))
  const watch: ItemStore["watch"] = (target, id, options = {}) => {
    const entry =
      session.followed.get(id) ??
      follow(session, target, id, { watchers: 0, plan: false, edit: options.edit === true })
    clearTimeout(entry.lingering)
    entry.lingering = undefined
    if (options.edit === true && !entry.edit) followToEdit(session, id, entry)
    entry.watchers += 1
    let released = false
    return () => {
      if (released) return
      released = true
      entry.watchers -= 1
      linger(session, id, entry)
    }
  }
  const reveal = (id: ItemId, shown: string | null): void => {
    const item = itemIn(session.workspace.getSnapshot(), id)
    // An item that's gone has nothing to show, and one pointed at another file since the
    // person saw it isn't the one they asked for.
    if (!item || item.path !== shown) return
    const pointed = pointedAt(item)
    session.store.update((state) =>
      state.revealed[id] === pointed
        ? state
        : { ...state, revealed: { ...state.revealed, [id]: pointed } },
    )
    // The same entry follows it again, revealed, so the places showing it still let go
    // of it, and one waiting to be let go still is.
    const entry = session.followed.get(id)
    const path = item.path ?? undefined
    if (!entry || entry.reveal === path) return
    entry.stop()
    entry.reveal = path
    listen(session, id, entry)
  }
  const unfold = (id: ItemId, shellId: string | null): void => {
    session.store.update((state) => {
      if ((state.unfolded[id] ?? null) === shellId) return state
      const { [id]: _folded, ...rest } = state.unfolded
      return { ...state, unfolded: shellId === null ? rest : { ...rest, [id]: shellId } }
    })
  }
  const plan = (target: WorkspaceTarget, id: ItemId): PlanActions => {
    const place = planPlace(session, target, id)
    return {
      edit: (text, marks) => {
        const edited = withDoc(place, (current) =>
          // A plan the backend can't write takes no edits. One that was too large may not
          // be, now.
          text === current.text || !current.writable || current.blocked === "transcript"
            ? current
            : {
                ...current,
                text,
                marks,
                marked: text,
                blocked: current.blocked === "too-large" ? null : current.blocked,
              },
        )
        if (edited) saveSoon(place)
      },
      closeEditor: () => {
        // The note code is already loaded: the editor that closed shares it.
        void import("../kinds/plan/plan-editor/notes").then(({ withoutEmptyNotes }) => {
          withDoc(place, (current) => {
            if (!current.writable) return current
            const kept = withoutEmptyNotes(current.text, currentMarks(current))
            return kept ? { ...current, ...kept, marked: kept.text } : current
          })
          saveNow(place)
        })
      },
      flush: () => saveNow(place),
      retry: () => retry(place),
      toggleChanges: () => {
        withDoc(place, (current) => ({ ...current, showChanges: !current.showChanges }))
      },
    }
  }
  const file = (target: WorkspaceTarget, id: ItemId, path: string): FileActions => {
    const place = filePlace(session, target, id, path)
    return {
      edit: (text, marks) => {
        const edited = withDoc(place, (current) =>
          // A file the backend can't write takes no edits. One that was too large may not
          // be, now.
          text === current.text || !current.writable
            ? current
            : {
                ...current,
                text,
                ...(marks && { marks }),
                blocked: current.blocked === "too-large" ? null : current.blocked,
              },
        )
        if (edited) saveSoon(place)
      },
      flush: () => saveNow(place),
      retry: () => retry(place),
    }
  }
  // Waits until `settled` holds, or a save's own time (20 s) has passed, asking again whenever
  // the store changes or a save settles.
  const settling = (settled: () => boolean): Promise<boolean> =>
    new Promise((resolve) => {
      const end = (done: boolean): void => {
        stopStore()
        session.planSaves.settled.delete(check)
        session.fileSaves.settled.delete(check)
        clearTimeout(timer)
        resolve(done)
      }
      const check = (): void => {
        if (settled()) end(true)
      }
      const stopStore = session.store.subscribe(check)
      session.planSaves.settled.add(check)
      session.fileSaves.settled.add(check)
      const timer = setTimeout(() => end(settled()), saveTimeout)
      check()
    })
  const saveFile: ItemStore["saveFile"] = (target, id, path) => {
    const place = filePlace(session, target, id, path)
    // How the edits stand: in the file, where they can't get, or undefined while a save may
    // still take them there.
    const standing = (): FileLeft | undefined => {
      const state = session.store.getSnapshot()
      const doc = place.read(state)
      if (!doc || settledFile(session, place.key, doc)) return "saved"
      const held = heldAt(session, id, path, state)
      return !doc.writable || doc.stalled || fileBlockOf(doc, held) !== null || unreadableNow(held)
        ? "stuck"
        : undefined
    }
    if (standing() === "saved") return undefined
    saveNow(place)
    return settling(() => standing() !== undefined).then(() => standing() ?? "stuck")
  }
  const fileEdits = (id: ItemId, path: string): string | undefined => {
    const doc = session.store.getSnapshot().files[fileKey(id, path)]
    return doc && fileText(doc)
  }
  const dropFile = (id: ItemId, path: string): void => {
    const key = fileKey(id, path)
    forget(session.fileSaves, key)
    session.store.update((state) => {
      if (!(key in state.files)) return state
      const { [key]: _dropped, ...files } = state.files
      const held = heldAt(session, id, path, state)
      const read = held && fileVersionOf(held)
      return {
        ...state,
        files: read?.path === path ? { ...files, [key]: fileDocOf(id, path, read.version) } : files,
      }
    })
  }
  // The app is going, as when it quits or the page reloads: every edit not in its file yet,
  // plans' and files', is sent at once, without asking anything, as whatever can't be saved
  // is lost. Answers where each save is kept.
  const sendAll = (): { readonly saves: Saves; readonly key: string }[] => {
    const state = session.store.getSnapshot()
    const workspaceNow = session.workspace.getSnapshot()
    const sent: { readonly saves: Saves; readonly key: string }[] = []
    for (const [id, doc] of Object.entries(state.plans)) {
      const target = targetOf(workspaceNow, id as ItemId)
      if (!target || (doc.text === doc.base && !session.planSaves.saving.has(id))) continue
      const place = planPlace(session, target, id as ItemId)
      saveNow(place)
      sent.push(place)
    }
    for (const [key, doc] of Object.entries(state.files)) {
      const target = targetOf(workspaceNow, doc.item)
      if (!target || settledFile(session, key, doc)) continue
      const place = filePlace(session, target, doc.item, doc.path)
      saveNow(place)
      sent.push(place)
    }
    return sent
  }
  // Before a quit: what `sendAll` sent, once answered, or a save's own time at most.
  const saveAll = async (): Promise<void> => {
    const sent = sendAll()
    await settling(() => sent.every(({ saves, key }) => !saves.saving.has(key)))
  }
  // The page is going, as on a reload, with nothing to wait for its saves.
  const pageHides = (): void => void sendAll()
  const connect = (): (() => void) => {
    reconcile(session, workspace.getSnapshot())
    // Items change far less often than the workspace: only a session's items changing
    // asks for a look.
    let seen = workspace.getSnapshot()
    const stopWorkspace = workspace.subscribe(() => {
      const next = workspace.getSnapshot()
      const before = itemsOf(seen)
      const after = itemsOf(next)
      seen = next
      if (before.length !== after.length || after.some((items, index) => items !== before[index]))
        reconcile(session, next)
    })
    const stopQuit = companions.beforeQuit?.(saveAll)
    window.addEventListener("pagehide", pageHides)
    return () => {
      stopWorkspace()
      stopQuit?.()
      window.removeEventListener("pagehide", pageHides)
      for (const id of session.followed.keys()) unfollow(session, id)
    }
  }
  const { picture, phone, part } = companions
  const trouble: ItemStore["trouble"] = (target, itemId, shown, troubles) =>
    session.companions.trouble(target, itemId, shown, troubles)
  const changeFile: ItemStore["changeFile"] = (target, itemId, path, layers) =>
    session.companions.changeFile
      ? session.companions.changeFile(target, itemId, path, layers)
      : Promise.reject(new Error("This backend can't read a change's files"))
  const changeRead: ItemStore["changeRead"] = (target, itemId, path) => {
    void session.companions.changeRead?.(target, itemId, path).catch(() => {})
  }
  return {
    store: session.store,
    watch,
    reveal,
    unfold,
    plan,
    file,
    saveFile,
    fileEdits,
    dropFile,
    trouble,
    changeFile,
    changeRead,
    connect,
    ...(picture && { picture }),
    ...(phone && { phone }),
    ...(part && { part }),
  }
}
