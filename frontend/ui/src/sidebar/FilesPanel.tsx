import {
  absolutePath,
  type FilesExclude,
  type FolderListing,
  type FilesProject,
} from "@novadeck/core/files"
import { ContextMenu } from "@novadeck/toolkit/ContextMenu"
import { Tooltip } from "@novadeck/toolkit/Tooltip"
import { ChevronsDownUp, EyeOff, RefreshCw, X } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { currentPlatform, filesShortcutBindings, matchesShortcut } from "../interaction/shortcuts"
import {
  keptWorking,
  litSet,
  namedAgents,
  noAgents,
  stripHoverOf,
  stripSlots,
  type Squad,
} from "./files-agents"
import { exactPattern, hiddenUnder, hidesOf } from "./files-exclude"
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
  isNote,
  keepListings,
  marksOf,
  shownWork,
  visibleLines,
  type Chips as ChipSet,
  type Listings,
  type FilesRow,
} from "./files-tree"
import { FilesExcludeDialog } from "./FilesExcludeDialog"
import { FilesStrip } from "./FilesStrip"
import { NoteRow, TreeRow, type Pointed } from "./FilesTreeRows"
import { panelLabels } from "./panel-labels"
import { SidebarPanel } from "./SidebarPanel"
import { useFolderReader } from "./useFolderReader"
import {
  useProjectExclude,
  type ExcludeEditing,
  type ProjectExcludeSource,
} from "./useProjectExclude"
import { usePulses } from "./usePulses"
import { useTreeMeasure } from "./useTreeMeasure"

const noFolders: ReadonlySet<string> = new Set()
const noListings: Listings = new Map()
const noPatterns: FilesExclude = {}

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")))

// The path of the row an event happened in, from anywhere in it, its chips too; none on the
// tree's empty space or a note.
const pathAt = (target: EventTarget): string | undefined =>
  target instanceof Element
    ? target.closest(".files-row")?.querySelector<HTMLElement>("[data-path]")?.dataset["path"]
    : undefined

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
// files opens, or added to by a row's Hide in This Project.
export const FilesPanel = ({
  project,
  directory,
  list,
  exclude,
  projectExclude,
  onExcludeSettings,
  turn,
  watch,
  onOpenFile,
  onLit,
  selectedHandle,
  roster,
  squads,
  active,
  visible,
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
  // When an agent's turn last ended in the project, which has the folders read again.
  turn: number
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
  // Whether the sidebar itself is shown, not collapsed.
  visible: boolean
  onHide: () => void
}): React.JSX.Element => {
  const showing = active && visible
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
  const lines = useMemo(
    () => visibleLines(tree, open, rootTruncated, stillKept),
    [tree, open, rootTruncated, stillKept],
  )
  const rows = useMemo(() => lines.filter((line): line is FilesRow => !isNote(line)), [lines])

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
        !isNote(line) && line.node.folder && line.open ? [line.node.path] : [],
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
    const refused = (): void =>
      setFailure({ text: `Couldn't copy ${text} to the clipboard.`, shown: shownTimes })
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
      const index = rows.findIndex((each) => each.node.path === path)
      const stays = (each: FilesRow): boolean =>
        each.node.path !== path && !each.node.path.startsWith(`${path}/`)
      const next = rows.slice(index + 1).find(stays) ?? rows.slice(0, index).findLast(stays)
      change((current) => ({ ...current, [exactPattern(path)]: true })).then(
        () => {
          // The row may have left already, and focus with it: then it is nowhere.
          const focused = document.activeElement
          if (focused === document.body || treeNode?.contains(focused)) focusRow(next)
        },
        (error: unknown) =>
          setFailure({
            text: `Couldn't hide ${path}: ${error instanceof Error ? error.message : "Novadeck could not save it."}`,
            shown: shownTimes,
          }),
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
  // Enter opens it.
  const onKeyDown = (event: React.KeyboardEvent): void => {
    onEscape(event)
    const path = pathAt(event.target)
    const index = rows.findIndex((row) => row.node.path === path)
    const row = rows[index]
    if (!row) return
    // Shift+Alt+C copies the focused row's path. It stops here, or the workspace would type its
    // character into the selected terminal.
    if (matchesShortcut(event, filesShortcutBindings(platform).copyPath)) {
      event.preventDefault()
      event.stopPropagation()
      copy(absolutePath(directory, row.node.path))
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
              {rootRead === "failed" ? (
                <p className="files-empty text-control">Can't read this project's files.</p>
              ) : rootEmpty ? (
                <p className="files-empty text-control">This project's folder is empty.</p>
              ) : rootHidden ? (
                <p className="files-empty text-control">
                  Everything in this project's folder is hidden.
                </p>
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
