import {
  absolutePath,
  ChangeUnanswered,
  type FilesExclude,
  type FolderListing,
  type FilesProject,
} from "@novadeck/core/files"
import { ConfirmDialog } from "@novadeck/toolkit/ConfirmDialog"
import { ContextMenu } from "@novadeck/toolkit/ContextMenu"
import { SubjectBar, SubjectDetail, SubjectName, SubjectSide } from "@novadeck/toolkit/SubjectBar"
import { Tooltip } from "@novadeck/toolkit/Tooltip"
import { ChevronsDownUp, EyeOff, File, Folder, RefreshCw, X } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from "react"

import {
  currentPlatform,
  filesShortcutBindings,
  matchesFilesShortcut,
} from "../interaction/shortcuts"
import {
  keptWorking,
  litSet,
  namedAgents,
  noAgents,
  stripHoverOf,
  stripSlots,
  type Squad,
} from "./files-agents"
import {
  atOrBelow,
  changeable,
  checkName,
  foldersOnTheWay,
  listedMoved,
  listingsCopied,
  listingsMade,
  listingsMoved,
  listingsRemoved,
  moved,
  nameOf,
  newEntryIn,
  parentOf,
  rowAfterLeaving,
  type EntryChanges,
  type Naming,
} from "./files-edit"
import { exactPattern, hiddenUnder, hidesOf, hidingPattern } from "./files-exclude"
import { textWidth } from "./files-fonts"
import { filesMenu } from "./files-menu"
import {
  buildTree,
  chipsOf,
  estimateChipWidth,
  estimateNameWidth,
  expandable,
  foldChips,
  initialOpen,
  isNaming,
  isNote,
  isRow,
  keepListings,
  marksOf,
  shownWork,
  visibleLines,
  type Chips as ChipSet,
  type Listings,
  type FilesRow,
} from "./files-tree"
import { CheckoutLine, useCheckout, type Checkout } from "./FilesCheckout"
import { FilesExcludeDialog } from "./FilesExcludeDialog"
import { NameRow } from "./FilesNameRow"
import { FilesStrip } from "./FilesStrip"
import { NoteRow, TreeRow, type Pointed } from "./FilesTreeRows"
import { panelLabels } from "./panel-labels"
import { SidebarPanel } from "./SidebarPanel"
import { useFilesClipboard, type PasteChanges } from "./useFilesClipboard"
import { useFocusOnceShown, focusMovable } from "./useFocusOnceShown"
import { useFolderReader } from "./useFolderReader"
import {
  useProjectExclude,
  type ExcludeEditing,
  type ProjectExcludeSource,
} from "./useProjectExclude"
import { usePulses } from "./usePulses"
import { useShowingNow } from "./useShowingNow"
import { useTreeMeasure } from "./useTreeMeasure"

const noFolders: ReadonlySet<string> = new Set()
const noListings: Listings = new Map()
const noPatterns: FilesExclude = {}

// The strip the question to delete a row opens on: its icon, its name, and its folder.
const deleteBar = (row: FilesRow): React.JSX.Element => (
  <SubjectBar>
    <SubjectSide>
      {row.node.folder ? (
        <Folder size={14} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <File size={14} strokeWidth={1.5} aria-hidden="true" />
      )}
      <SubjectName>{row.node.name}</SubjectName>
    </SubjectSide>
    <SubjectDetail end>{parentOf(row.node.path) || "Project folder"}</SubjectDetail>
  </SubjectBar>
)

// The path of the row an event happened in, from anywhere in it, its chips too; none on the
// tree's empty space or a note.
const pathAt = (target: EventTarget): string | undefined =>
  target instanceof Element
    ? target.closest(".files-row")?.querySelector<HTMLElement>("[data-path]")?.dataset["path"]
    : undefined

// Whether the focus is still where a paste asked on the row `asked` (null off a row) left it: on
// that row of the tree `tree`, or on nothing, as where that row went. Anywhere else, the person
// put it there since.
const focusStays = (tree: HTMLElement | null, asked: string | null): boolean => {
  const focused = document.activeElement
  if (focused === null || focused === document.body) return true
  return asked !== null && tree?.contains(focused) === true && pathAt(focused) === asked
}

// Where a change the person asked for leaves the tree once it is made: the focus on the entry
// changed, or on the row `instead` where the patterns hide it, or left where it is; and the
// selection and the tab stop as they were when it was asked (`was`), which move to the entry
// only where they haven't moved since.
type Landing = {
  readonly focus: boolean
  readonly instead: string | null
  readonly was: { readonly selected: string | null; readonly stop: string | null }
}

// The project's files, a folder read when the person opens it, and read again when the panel is
// shown again or an agent's turn ends. Where the backend tells what its agents changed (the
// demo), every live agent's work is in them: who owns each file, what they did and which one they
// are writing now. Keeping agents' chips in the strip leaves only their work in the tree: the files
// they touched or are writing and the folders those are in; with nothing kept every file shows.
// Lighting an agent otherwise, by selecting its terminal or pointing at a chip, only dims the rest.
// A right-click on a row, or off one, on the tree's empty space or the line in the tree's place,
// which stand for the project's folder, opens the menu `filesMenu` builds for it; what the panel
// couldn't do shows above the tree while it shows. What the person's patterns for every project
// and the project's own over them match leaves the tree, and the agents' work there with it;
// the project's are read when the panel is shown, and edited in the dialog the header's Hidden
// files opens, or added to by a row's Hide in This Project. Where the backend makes them, the
// menu and the keys (F2, Delete) make a new file or folder, named in a field in the tree, rename
// a row in its place, and delete one once the person confirms, and the menu and Ctrl or ⌘ with X,
// C and V cut or copy a row and paste it elsewhere, with the panel's own clipboard; then the
// folders involved are read again and the row made, renamed or pasted takes the selection.
const FilesPanelView = ({
  project,
  directory,
  list,
  exclude,
  projectExclude,
  onExcludeSettings,
  entries,
  onMoved,
  turn,
  checkout,
  watch,
  onOpenFile,
  onLit,
  selectedHandle,
  roster,
  squads,
  active,
  showing,
  onHide,
}: {
  // What the demo's agents changed in the project, laid over its files; a runner has none.
  project: FilesProject | undefined
  // The project's directory, as the backend's machine writes it.
  directory: string
  // Reads a folder of the project, by its path from the project's root.
  list: (folder: string) => Promise<FolderListing>
  // The person's patterns for hiding files in every project.
  exclude: FilesExclude
  // Where the backend keeps the project's own patterns over them: how to read and replace them.
  // Left out, nothing is hidden in the project alone, and nothing offers to.
  projectExclude?: ProjectExcludeSource | undefined
  // Opens Preferences where the person's patterns for every project are edited.
  onExcludeSettings: () => void
  // How the backend makes, moves, copies and deletes the project's files and folders, each where
  // it can; left out, nothing is offered.
  entries?: EntryChanges | undefined
  // Told an entry moved, by its paths from the root, so what shows it can follow it.
  onMoved?: ((from: string, to: string) => void) | undefined
  // When an agent's turn last ended in the project, which has the folders read again.
  turn: number
  // The project's own checkout against its remote's main, where the backend has one to move.
  checkout?: Checkout | undefined
  // Follows the works `project` comes from until the returned release is called, where it
  // comes from them.
  watch?: (() => () => void) | undefined
  // Opens a file of the project, by its path from the root; rejects if it can't be opened.
  onOpenFile: (path: string) => Promise<void>
  // Told the agents the panel lights while it shows (the kept ones, else the selected terminal's),
  // and none when it does not: what an open file preview emphasizes.
  onLit?: ((lit: ReadonlySet<string>) => void) | undefined
  // The handle of the workspace's selected terminal.
  selectedHandle: string | undefined
  // The handles of the session's terminals in roster order, and its teams as handles, each lead
  // first: how the agents strip orders and groups the agents.
  roster: readonly string[]
  squads: readonly Squad[]
  // Whether this is the sidebar's panel now.
  active: boolean
  // Whether the panel is in sight: it reads, watches and lights agents only then.
  showing: boolean
  onHide: () => void
}): React.JSX.Element => {
  const platform = currentPlatform()
  const [listings, setListings] = useState<Listings>(noListings)
  const { editing, reread: rereadExclude } = useProjectExclude(projectExclude, showing)
  const projectPatterns = editing?.patterns
  const hides = useMemo(
    () => hidesOf(exclude, projectPatterns ?? noPatterns),
    [exclude, projectPatterns],
  )
  // The agents' work the tree shows: none of it in what is hidden.
  const shown = useMemo(() => project && shownWork(project, hides), [project, hides])
  const tree = useMemo(() => buildTree(listings, shown, hides), [listings, shown, hides])
  // The listings of a folder that vanished are dropped, to be read anew if it comes back.
  const rootRead = listings.get("")
  const survivors = keepListings(listings, tree)
  if (survivors !== listings) setListings(survivors)
  // Folders open once, when the panel first has the project's root; after that only the
  // person's clicks open or close one.
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string> | null>(null)
  if (openFolders === null && typeof listings.get("") === "object")
    setOpenFolders(initialOpen(tree))
  const open = openFolders ?? noFolders
  // A root that lists nothing is empty, whatever an agent is said to have changed in it.
  const rootEmpty =
    typeof rootRead === "object" && rootRead.entries.length === 0 && !rootRead.truncated
  // A root that lists entries, all of them hidden, with none of the agents' work showing either,
  // says so rather than drawing nothing. One that lists only some ends with its "More not shown".
  const rootHidden =
    typeof rootRead === "object" &&
    !rootRead.truncated &&
    rootRead.entries.length > 0 &&
    tree.length === 0
  const rootTruncated = typeof rootRead === "object" && rootRead.truncated
  // The agents the person keeps lit, any number; this panel remounts with the project, which
  // forgets them. Kept agents that no longer have work here are let go, as nothing in the strip
  // shows them. The tree holds only the work of the ones kept.
  const [kept, setKept] = useState<ReadonlySet<string>>(noAgents)
  const stillKept = useMemo(() => keptWorking(shown, kept), [shown, kept])
  if (stillKept.size !== kept.size) setKept(stillKept)
  // What the person is naming in a field in the tree, a new entry or a row anew; and the row they
  // asked to delete, while the dialog asks.
  const [naming, setNaming] = useState<Naming | null>(null)
  const [deleting, setDeleting] = useState<FilesRow | null>(null)
  const lines = useMemo(
    () => visibleLines(tree, open, rootTruncated, stillKept, naming),
    [tree, open, rootTruncated, stillKept, naming],
  )
  const rows = useMemo(() => lines.filter(isRow), [lines])
  // The line in the tree's place where the root has nothing to show: none while a name is typed,
  // which the tree shows.
  const inPlace =
    naming !== null
      ? undefined
      : rootRead === "failed"
        ? "Can't read this project's files."
        : rootEmpty
          ? "This project's folder is empty."
          : rootHidden
            ? "Everything in this project's folder is hidden."
            : undefined

  const { read, isReading } = useFolderReader(list, setListings)
  // The works the changes come from are followed while the panel shows.
  useEffect(() => (showing && watch ? watch() : undefined), [showing, watch])
  // The root and the open folders, those the kept agents' work leaves out too, so the tree is
  // current when they're let go: what the panel keeps read while it is shown.
  const wanted = useMemo(() => {
    const all = stillKept.size > 0 ? visibleLines(tree, open) : lines
    return [
      "",
      ...all.flatMap((line) =>
        isRow(line) && line.node.folder && line.open ? [line.node.path] : [],
      ),
    ]
  }, [lines, tree, open, stillKept])
  const wantedNow = useRef(wanted)
  useLayoutEffect(() => {
    wantedNow.current = wanted
  }, [wanted])
  // Shown, or shown again, or an agent's turn ended: everything on screen is read again.
  useEffect(() => {
    if (showing) wantedNow.current.forEach(read)
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A turn's end has it read again.
  }, [showing, turn, read])
  // A folder that opens, as the first ones do, is read once if nothing has.
  useEffect(() => {
    if (!showing) return
    for (const folder of wanted) if (!listings.has(folder) && !isReading(folder)) read(folder)
  }, [showing, wanted, listings, read, isReading])
  // The backend moved the checkout to main: the files on disk changed, so what is on screen is
  // read again, added and removed files with it.
  const checkoutState = useCheckout(checkout, showing, turn, () => wantedNow.current.forEach(read))
  const [selected, setSelected] = useState<string | null>(null)
  // The row the menu was last asked on; undefined for the tree's empty space.
  const [menuRow, setMenuRow] = useState<FilesRow | undefined>()
  // What the panel couldn't do last, and in which showing of it (`shownTimes`): a line above the
  // tree says so through that showing only, until dismissed. What fails once the panel is
  // hidden, as a copy chosen from a menu left open as it hid, says nothing then or later.
  const [failure, setFailure] = useState<{ readonly text: string; readonly shown: number } | null>(
    null,
  )
  // A chip can leave from under the pointer, folded into `+N` by another agent's write or a
  // narrower tree, with no pointerleave to say so: the agent stays lit only while that row still
  // shows that chip.
  const [hovered, setHovered] = useState<Pointed | undefined>()
  // The strip's chip under the pointer: its agent, or a lead's whole squad.
  const [stripHover, setStripHover] = useState<string | undefined>()
  const [treeNode, setTreeNode] = useState<HTMLDivElement | null>(null)
  const { width: treeWidth, fonts } = useTreeMeasure(treeNode)
  // Rows rank their chips by what is kept or selected only, so pointing never reorders them.
  const ranked = useMemo(() => litSet(shown, kept, selectedHandle), [shown, kept, selectedHandle])
  // The chips each row shows, folded by its room; an open folder names nobody: its files do.
  const chipsByPath = useMemo(() => {
    const chipWidth = (text: string): number =>
      textWidth(text, text.startsWith("+") ? fonts.more : fonts.chip, estimateChipWidth(text))
    const byPath = new Map<string, ChipSet>()
    for (const row of rows) {
      const { node } = row
      if (node.folder && row.open) continue
      const chips = chipsOf(node.touched, node.writing, ranked)
      byPath.set(
        node.path,
        chips.shown.length < 2
          ? chips
          : foldChips(chips, {
              width: treeWidth,
              depth: row.depth,
              nameWidth:
                treeWidth === undefined
                  ? 0
                  : textWidth(node.name, fonts.name, estimateNameWidth(node.name)),
              marks: marksOf(node),
              chipWidth,
            }),
      )
    }
    return byPath
  }, [rows, ranked, treeWidth, fonts])
  const pointed =
    showing && hovered && chipsByPath.get(hovered.path)?.shown.includes(hovered.handle)
      ? hovered.handle
      : undefined
  const slots = useMemo(
    () => (shown ? stripSlots(shown, roster, squads) : []),
    [shown, roster, squads],
  )
  // The strip chip under the pointer lights its agent, or a lead's whole squad. A squad can
  // dissolve or the strip go with no pointerleave to say so: the hover counts only while its
  // chip is still in the strip, and is forgotten once it is not.
  const stripPointed = stripHoverOf(slots, stripHover)
  if (stripHover !== undefined && stripPointed === undefined) setStripHover(undefined)
  const pointing = pointed !== undefined || (showing && stripPointed !== undefined)
  const lit = useMemo(() => {
    const pointedAt = pointed ? [pointed] : showing ? stripPointed : undefined
    return pointedAt ? new Set(pointedAt) : ranked
  }, [pointed, showing, stripPointed, ranked])
  useEffect(() => {
    onLit?.(showing ? ranked : noAgents)
    return () => onLit?.(noAgents)
  }, [onLit, showing, ranked])
  const following = kept.size === 0 && ranked.size > 0 ? [...ranked][0] : undefined
  // The row that holds the tree's one Tab stop: the last one focused, or the first.
  const [stop, setStop] = useState<string | null>(null)
  const tabStop = rows.some((row) => row.node.path === stop) ? stop : (rows[0]?.node.path ?? null)
  // The row that takes focus once it shows, as a row made, renamed or pasted with the keyboard.
  const focusOnceShown = useFocusOnceShown(rows, treeNode)
  // A field whose row, or the folder it adds to, left the tree, as when a reading or the agents
  // kept no longer show it, goes with it, and the tree's tab stop takes the focus it had. A field
  // is open from when it shows until a key or a blur ends it; one that ends otherwise was lost.
  const fieldOpen = useRef(false)
  if (naming !== null && !lines.some(isNaming)) setNaming(null)
  useLayoutEffect(() => {
    if (naming !== null) fieldOpen.current = true
    if (naming !== null || !fieldOpen.current) return
    fieldOpen.current = false
    if (tabStop === null || !focusMovable(treeNode)) return
    treeNode?.querySelector<HTMLElement>(`[data-path="${CSS.escape(tabStop)}"]`)?.focus()
  }, [naming, tabStop, treeNode])

  const { pulses, end: endPulses } = usePulses(project?.changes, rows, open, showing, hides)
  // Hiding the panel ends the pulses, and showing it again starts the trails over so each reads
  // its true age: a hidden panel's animations restart at full brightness when it shows.
  const [wasShowing, setWasShowing] = useState(showing)
  const [shownTimes, setShownTimes] = useState(0)
  if (wasShowing !== showing) {
    setWasShowing(showing)
    if (showing) setShownTimes(shownTimes + 1)
    else {
      endPulses()
      setHovered(undefined)
      setStripHover(undefined)
    }
  }
  const failed = showing && failure?.shown === shownTimes ? failure.text : undefined
  // Says what the panel couldn't do above the tree, in the showing it settles in: none, once the
  // panel was hidden, though it shows again before then.
  const showingNow = useShowingNow(showing, shownTimes)
  const say = (text: string): void => setFailure({ text, shown: showingNow() })

  const toggle = (path: string, to?: boolean): void => {
    const next = new Set(open)
    if (to ?? !next.has(path)) {
      next.add(path)
      // Opening shows the folder as it is now, whatever was read before, and so the folders
      // left open inside it, which show again with it, but those hidden since.
      read(path)
      for (const inner of open)
        if (inner.startsWith(`${path}/`) && !hiddenUnder(hides, inner)) read(inner)
    } else next.delete(path)
    setOpenFolders(next)
  }
  const activate = (row: FilesRow): void => {
    if (!row.node.folder) setSelected(row.node.path)
    else if (expandable(row.node)) toggle(row.node.path)
  }
  // A file that can't be opened may be gone: its folder is read again.
  const openFile = (row: FilesRow): void => {
    if (row.node.folder) return
    setSelected(row.node.path)
    onOpenFile(row.node.path).catch(() => read(parentOf(row.node.path)))
  }
  const focusRow = (row: FilesRow | undefined): void => {
    if (!row) return
    setStop(row.node.path)
    treeNode?.querySelector<HTMLElement>(`[data-path="${CSS.escape(row.node.path)}"]`)?.focus()
  }
  const rowAt = (target: EventTarget): FilesRow | undefined => {
    const path = pathAt(target)
    return rows.find((row) => row.node.path === path)
  }
  // The menu is the row's under the pointer, which a right-click focuses, or the empty space's.
  const aim = (event: React.MouseEvent): void => {
    const row = rowAt(event.target)
    setMenuRow(row)
    focusRow(row)
  }
  // Puts text on the clipboard; a page that may not, or a clipboard that refuses, says so above
  // the tree. A copy that works says nothing.
  const copy = (text: string): void => {
    setFailure(null)
    const refused = (): void => say(`Couldn't copy ${text} to the clipboard.`)
    const write = navigator.clipboard?.writeText(text)
    if (!write) {
      refused()
      return
    }
    void write.catch(refused)
  }
  // Reads the root, the open folders and the project's patterns again, as showing the panel does.
  const refresh = (): void => {
    wanted.forEach((folder) => read(folder))
    rereadExclude()
  }
  // Whether the dialog for the project's patterns is open.
  const [excluding, setExcluding] = useState(false)
  // Hides a row in the project by its exact path, which a right-click focused, added to the
  // project's patterns as the backend holds them by then. Once it is hidden, the row after it
  // takes focus, else the one before, unless the person has put focus somewhere else meanwhile; a
  // read or a save that fails says why above the tree.
  const hideIn =
    ({ change }: ExcludeEditing) =>
    (row: FilesRow): void => {
      setFailure(null)
      const { path } = row.node
      const next = rowAfterLeaving(rows, path)
      change((current) => ({ ...current, [exactPattern(path)]: true })).then(
        () => {
          // The row may have left already, and focus with it: then it is nowhere.
          if (focusMovable(treeNode)) focusRow(next)
        },
        (error: unknown) =>
          say(
            `Couldn't hide ${path}: ${error instanceof Error ? error.message : "Novadeck could not save it."}`,
          ),
      )
    }
  // What a change to the project's files, `action`, couldn't do, with the backend's reason,
  // above the tree; or, where the connection dropped before the backend answered, that it may
  // have been done. The folders `involved` are read again, as a refusal may come once part of the
  // change was made.
  const failing =
    (action: string, involved: readonly string[]) =>
    (error: unknown): void => {
      involved.forEach(read)
      say(
        error instanceof ChangeUnanswered
          ? `Novadeck lost its connection before it heard whether it could ${action}; it may have been done, or may still be under way.`
          : `Couldn't ${action}: ${error instanceof Error ? error.message : "Novadeck could not change it."}`,
      )
    }
  // Starts naming a new file or folder where the menu was asked: inside a folder, which opens,
  // beside a file, or in the root off a row.
  const startNew = (row: FilesRow | undefined, folder: boolean): void => {
    const parent = newEntryIn(row)
    setFailure(null)
    if (parent !== "" && !open.has(parent)) toggle(parent, true)
    setNaming({ kind: "new", parent, folder, from: row?.node.path })
  }
  const startRename = (row: FilesRow): void => {
    setFailure(null)
    setNaming({ kind: "rename", path: row.node.path, folder: row.node.folder })
  }
  // Ends the naming with nothing changed; a key gives the row it was asked on its focus back.
  const endNaming = (asked: Naming, keyboard: boolean): void => {
    fieldOpen.current = false
    setNaming(null)
    if (keyboard) focusOnceShown(asked.kind === "rename" ? asked.path : (asked.from ?? tabStop))
  }
  // Where the person's selection and tab stop are as they ask for a change.
  const placeNow = (): Landing["was"] => ({ selected, stop })
  // Once an entry is made, renamed or pasted at `path` it is the row selected (a file) and the
  // tree's tab stop, each where it hasn't moved since, and takes the focus as `landing` says, and
  // the agents kept are let go so it shows; one the patterns hide says so above the tree, naming
  // the pattern, and the focus goes to the row `instead`, where it is one.
  const changed = (path: string, folder: boolean, done: string, landing: Landing): void => {
    const { focus, instead, was } = landing
    const pattern = hidingPattern(exclude, projectPatterns ?? noPatterns, path)
    if (pattern !== undefined) {
      say(`${done} ${path}, which the pattern ${pattern} hides.`)
      if (focus) focusOnceShown(instead)
      return
    }
    setKept(noAgents)
    if (!folder) setSelected((current) => (current === was.selected ? path : current))
    setStop((current) => (current === was.stop ? path : current))
    if (focus) focusOnceShown(path)
  }
  // Makes the entry the person named in the folder `parent`, opening and reading again the
  // folders on the way to it; one the patterns hide leaves the focus on the row asked on.
  const make = (
    create: NonNullable<EntryChanges["create"]>,
    asked: Extract<Naming, { readonly kind: "new" }>,
    path: string,
    keyboard: boolean,
  ): void => {
    const { parent, folder } = asked
    const was = placeNow()
    create(path, folder).then(
      (made) => {
        const way = foldersOnTheWay(made)
        setListings((known) => listingsMade(known, made, folder))
        setOpenFolders((current) => current && new Set([...current, ...way]))
        ;["", ...way].forEach(read)
        changed(made, folder, "Made", { focus: keyboard, instead: asked.from ?? null, was })
      },
      failing(`make ${path}`, [parent]),
    )
  }
  // Once the entry at `from` moved to `path`, renamed or pasted after a cut: an open folder keeps
  // what it lists and what is open in it, the selection and tab stop follow, as do what was cut or
  // copied and what shows it outside the panel, and the folders it left and went to are read
  // again. Then it is the row `changed` makes it.
  const settleMove = (
    from: string,
    path: string,
    folder: boolean,
    done: string,
    landing: Landing,
  ): void => {
    setListings((known) => listingsMoved(known, from, path))
    setOpenFolders(
      (current) => current && new Set([...current].map((each) => moved(each, from, path))),
    )
    setSelected((current) => current && moved(current, from, path))
    setStop((current) => current && moved(current, from, path))
    clipboard.moved(from, path)
    new Set([parentOf(from), parentOf(path)]).forEach(read)
    onMoved?.(from, path)
    changed(path, folder, done, landing)
  }
  // Moves the entry at `from` to `to`, a rename or a cut pasted, and answers where it is. A move
  // the backend never answered (`ChangeUnanswered`) whose entry the folders, read again, show at
  // `to` by then was made; one they don't rejects as it did.
  const moveTo = (
    move: NonNullable<EntryChanges["move"]>,
    from: string,
    to: string,
  ): Promise<string> =>
    move(from, to).catch(async (error: unknown) => {
      if (!(error instanceof ChangeUnanswered)) throw error
      const folders = [...new Set([parentOf(from), parentOf(to)])]
      const listed = await Promise.all(folders.map(list)).catch(() => {
        throw error
      })
      if (!listedMoved(new Map(folders.map((folder, at) => [folder, listed[at]!])), from, to))
        throw error
      return to
    })
  // Renames the entry at `from` to `to`; where the patterns hide its new name, the row `after`
  // takes the focus in its place.
  const rename = (
    move: NonNullable<EntryChanges["move"]>,
    asked: Extract<Naming, { readonly kind: "rename" }>,
    to: string,
    keyboard: boolean,
  ): void => {
    const { path: from, folder } = asked
    // The row after it among the rows it is one of, read before its field leaves.
    const after = keyboard
      ? (rowAfterLeaving(visibleLines(tree, open, rootTruncated, stillKept).filter(isRow), from)
          ?.node.path ?? null)
      : null
    const was = placeNow()
    moveTo(move, from, to).then(
      (path) =>
        settleMove(from, path, folder, "Renamed to", { focus: keyboard, instead: after, was }),
      failing(`rename ${from} to ${nameOf(to)}`, [parentOf(from)]),
    )
  }
  // How a paste is made where the backend moves and copies files: a cut moved as a rename is, a
  // copy made under the name the backend chose. Afterwards the entry pasted takes the selection
  // and the tab stop where they haven't moved since, and the focus where it is still on the row
  // the paste was asked on; that row keeps it where the patterns hide the entry.
  const moveFile = entries?.move
  const copyFile = entries?.copy
  const pasteChanges: PasteChanges | undefined =
    moveFile && copyFile
      ? {
          move: (from, to, folder, asked) => {
            const was = placeNow()
            return moveTo(moveFile, from, to).then((path) => {
              const focus = focusStays(treeNode, asked)
              settleMove(from, path, folder, "Moved to", { focus, instead: asked, was })
              return path
            })
          },
          copy: (from, into, folder, asked) => {
            const was = placeNow()
            return copyFile(from, into).then((path) => {
              setListings((known) => listingsCopied(known, path, folder))
              read(into)
              const focus = focusStays(treeNode, asked)
              changed(path, folder, "Copied to", { focus, instead: asked, was })
              return path
            })
          },
        }
      : undefined
  const clipboard = useFilesClipboard({
    changes: pasteChanges,
    listings,
    read,
    opened: (folder) => {
      if (folder !== "" && !open.has(folder)) toggle(folder, true)
    },
    began: () => setFailure(null),
    failing,
  })
  const { actions: clipActions } = clipboard
  // Makes or renames what the person named, which the menu and the keys ask for only where the
  // backend makes that change. With a key, the row it was asked on holds the focus meanwhile,
  // and keeps it if the change is refused.
  const commitName = (asked: Naming, path: string, keyboard: boolean): void => {
    fieldOpen.current = false
    setNaming(null)
    setFailure(null)
    if (keyboard) focusOnceShown(asked.kind === "rename" ? asked.path : (asked.from ?? tabStop))
    if (asked.kind === "new" && entries?.create) make(entries.create, asked, path, keyboard)
    if (asked.kind === "rename" && entries?.move) rename(entries.move, asked, path, keyboard)
  }
  // Deletes the row the person confirmed; the row after it, else the one before, takes the focus
  // unless the person put it somewhere else meanwhile. A refusal reads its folder again, and the
  // folder itself where it is open, as part of it may be gone.
  const remove = (removeEntry: NonNullable<EntryChanges["remove"]>, row: FilesRow): void => {
    const { path } = row.node
    const next = rowAfterLeaving(rows, path)
    setFailure(null)
    removeEntry(path).then(
      () => {
        setListings((known) => listingsRemoved(known, path))
        setOpenFolders(
          (current) => current && new Set([...current].filter((each) => !atOrBelow(each, path))),
        )
        setSelected((current) => (current !== null && atOrBelow(current, path) ? null : current))
        clipboard.removed(path)
        read(parentOf(path))
        focusOnceShown(next?.node.path ?? null)
      },
      failing(`delete ${path}`, [parentOf(path), ...(open.has(path) ? [path] : [])]),
    )
  }
  // Escape in the strip or the tree lets go of every kept agent, back to following the selected
  // terminal. With nothing kept it is left for whatever else listens.
  const onEscape = (event: React.KeyboardEvent): void => {
    if (event.key !== "Escape" || kept.size === 0) return
    event.stopPropagation()
    setKept(noAgents)
  }
  // The tree keyboard pattern; Space and a folder's Enter are the buttons' own click, a file's
  // Enter opens it. Escape lets go of what was cut first, and of the kept agents only then.
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const plain = !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    if (event.key === "Escape" && plain && clipboard.letGo()) {
      event.stopPropagation()
      return
    }
    onEscape(event)
    const path = pathAt(event.target)
    const index = rows.findIndex((row) => row.node.path === path)
    const row = rows[index]
    if (!row) return
    const keys = filesShortcutBindings(platform)
    // Shift+Alt+C copies the focused row's path. It stops here, or the workspace would type its
    // character into the selected terminal.
    if (matchesFilesShortcut(event, keys.copyPath)) {
      event.preventDefault()
      event.stopPropagation()
      copy(absolutePath(directory, row.node.path))
      return
    }
    // Ctrl or ⌘ with X, C and V cut, copy and paste the row with the panel's own clipboard, never
    // the system's, where the backend may and the row is the project's. They stop here whatever
    // they do. A paste held down pastes once.
    const cutting = matchesFilesShortcut(event, keys.cut)
    const copying = matchesFilesShortcut(event, keys.copy)
    const pasting = matchesFilesShortcut(event, keys.paste)
    if (cutting || copying || pasting) {
      event.preventDefault()
      event.stopPropagation()
      if (!changeable(row.node) || !clipActions) return
      if (cutting) clipActions.take(row, "cut")
      if (copying) clipActions.take(row, "copy")
      if (pasting && !event.repeat) clipActions.paste(row)
      return
    }
    // F2 renames the row and Delete deletes it, where the backend may and the row is the
    // project's. Both stop here whatever they do: while navigating, the keymap would rename or
    // close the active terminal. On macOS only ⌘⌫ deletes, as in Finder, and a plain forward
    // Delete stops here too, doing nothing.
    const renaming = matchesFilesShortcut(event, keys.rename)
    const forwardDelete =
      platform === "mac" &&
      event.key === "Delete" &&
      !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    if (renaming || forwardDelete || matchesFilesShortcut(event, keys.delete)) {
      event.preventDefault()
      event.stopPropagation()
      if (forwardDelete || !changeable(row.node)) return
      if (renaming && entries?.move) startRename(row)
      if (!renaming && entries?.remove) setDeleting(row)
      return
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const handled = ((): boolean => {
      switch (event.key) {
        case "ArrowDown":
          focusRow(rows[Math.min(rows.length - 1, index + 1)])
          return true
        case "ArrowUp":
          focusRow(rows[Math.max(0, index - 1)])
          return true
        case "Home":
          focusRow(rows[0])
          return true
        case "End":
          focusRow(rows[rows.length - 1])
          return true
        case "Enter":
          if (row.node.folder) return event.repeat
          // Holding the key opens the file once.
          if (!event.repeat) openFile(row)
          return true
        case "ArrowRight":
          if (!expandable(row.node)) return true
          if (!row.open) toggle(row.node.path, true)
          else if ((rows[index + 1]?.depth ?? 0) > row.depth) focusRow(rows[index + 1])
          return true
        case "ArrowLeft":
          if (row.open) toggle(row.node.path, false)
          else
            focusRow(
              rows.slice(0, index).findLast((candidate) => candidate.depth === row.depth - 1),
            )
          return true
        default:
          return false
      }
    })()
    if (handled) event.preventDefault()
  }
  return (
    <SidebarPanel
      id="files-panel"
      title={panelLabels.files}
      active={active}
      onClose={onHide}
      actions={
        <>
          {editing && (
            <Tooltip content="Hidden files">
              <button
                className="icon-button dim quiet size-7"
                type="button"
                aria-label="Hidden files"
                aria-haspopup="dialog"
                onClick={() => setExcluding(true)}
              >
                <EyeOff size={14} strokeWidth={1.6} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Refresh">
            <button
              className="icon-button dim quiet size-7"
              type="button"
              aria-label="Refresh"
              onClick={refresh}
            >
              <RefreshCw size={14} strokeWidth={1.6} />
            </button>
          </Tooltip>
          <Tooltip content="Collapse folders">
            <button
              className="icon-button dim quiet size-7"
              type="button"
              aria-label="Collapse folders"
              onClick={() => setOpenFolders(new Set())}
            >
              <ChevronsDownUp size={14} strokeWidth={1.6} />
            </button>
          </Tooltip>
        </>
      }
    >
      {checkoutState.state && (
        <CheckoutLine
          state={checkoutState.state}
          updating={checkoutState.updating}
          refused={checkoutState.refused}
          onUpdate={checkoutState.update}
        />
      )}
      {failed && (
        <div className="sidebar-refusal files-failure" role="alert">
          <p className="text-control">{failed}</p>
          <button
            type="button"
            className="icon-button small dim quiet"
            aria-label="Dismiss"
            onClick={() => setFailure(null)}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {slots.length > 0 && (
        <FilesStrip
          slots={slots}
          kept={kept}
          selected={following}
          onKeep={setKept}
          onLight={setStripHover}
          onKeyDown={onEscape}
        />
      )}
      {rootRead !== undefined && (
        <ContextMenu
          label={menuRow ? `${menuRow.node.name} actions` : "Project folder actions"}
          items={filesMenu({
            row: menuRow,
            directory,
            platform,
            onCopy: copy,
            onRefresh: refresh,
            ...(editing && { onHide: hideIn(editing) }),
            ...(entries?.create && { onNew: startNew }),
            ...(clipActions && {
              clipboard: {
                onCut: (row: FilesRow) => clipActions.take(row, "cut"),
                onCopy: (row: FilesRow) => clipActions.take(row, "copy"),
                ready: clipboard.ready,
                onPaste: clipActions.paste,
              },
            }),
            ...(entries?.move && { onRename: startRename }),
            ...(entries?.remove && { onDelete: setDeleting }),
          })}
          trigger={
            // The tree, or the line in its place: a right-click anywhere in it, off a row, is on
            // the project's folder.
            <div
              className="files-body flex min-h-0 flex-1 flex-col"
              onContextMenu={aim}
              // A long press, as on a phone, may open the menu with no right-click: a touch aims it.
              onPointerDown={(event) => {
                if (event.pointerType !== "mouse") setMenuRow(rowAt(event.target))
              }}
            >
              {inPlace !== undefined ? (
                <p className="files-empty text-control">{inPlace}</p>
              ) : (
                <div
                  ref={setTreeNode}
                  role="tree"
                  aria-label="Project files"
                  aria-description={
                    stillKept.size > 0
                      ? `Only the work of ${namedAgents(stillKept)} is shown.${
                          pointing
                            ? ` Of that, the work of ${namedAgents(lit)} is lit; the rest is dimmed.`
                            : ""
                        }`
                      : lit.size > 0
                        ? `The work of ${namedAgents(lit)} is lit; files and folders they did not touch are dimmed.`
                        : "No agent is lit."
                  }
                  className="files-tree mt-2.5 flex min-h-0 flex-1 flex-col overflow-y-auto pb-3"
                  data-lit={lit.size > 0 ? [...lit].join(" ") : undefined}
                  onKeyDown={onKeyDown}
                  onPointerLeave={() => setHovered(undefined)}
                >
                  {lines.map((line) =>
                    isNote(line) ? (
                      <NoteRow key={`${line.path}\0${line.note}`} line={line} />
                    ) : isNaming(line) ? (
                      <NameRow
                        key="\0naming"
                        line={line}
                        check={(typed) => checkName(line.naming, typed, listings)}
                        onCommit={(path, keyboard) => commitName(line.naming, path, keyboard)}
                        onEnd={(keyboard) => endNaming(line.naming, keyboard)}
                      />
                    ) : (
                      <TreeRow
                        key={line.node.path}
                        row={line}
                        chips={chipsByPath.get(line.node.path)}
                        lit={lit}
                        selected={selected === line.node.path}
                        tabStop={tabStop === line.node.path}
                        pulse={pulses[line.node.path]}
                        shownTimes={shownTimes}
                        cut={
                          clipboard.clip?.mode === "cut" && clipboard.clip.path === line.node.path
                        }
                        busy={clipboard.busy(line.node.path)}
                        onActivate={activate}
                        onOpenFile={openFile}
                        onFocus={setStop}
                        onLight={setHovered}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
          }
        />
      )}
      <ConfirmDialog
        subject={deleting}
        bar={deleteBar}
        title={(row) => `Delete ${row.node.name}?`}
        description={(row) =>
          row.node.folder
            ? `${row.node.path} and everything in it will be deleted. This can't be undone.`
            : `${row.node.path} will be deleted. This can't be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (deleting && entries?.remove) remove(entries.remove, deleting)
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
        returnFocus={(row) =>
          treeNode?.querySelector<HTMLElement>(`[data-path="${CSS.escape(row.node.path)}"]`) ?? null
        }
        widthClassName="w-[min(360px,calc(100vw-32px))]"
      />
      {editing && (
        <FilesExcludeDialog
          open={excluding}
          patterns={editing.patterns}
          everywhere={exclude}
          onSave={async (patterns) => {
            await editing.save(patterns)
            setExcluding(false)
          }}
          onClose={() => setExcluding(false)}
          onSettings={() => {
            setExcluding(false)
            onExcludeSettings()
          }}
        />
      )}
    </SidebarPanel>
  )
}

// Drawn again only as its own props change: the sidebar keeps every panel mounted.
export const FilesPanel = memo(FilesPanelView)
