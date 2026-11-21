import { plainIndex, type Note, type Notes, type NotesState } from "@novadeck/core/notes"
import { useCallback } from "react"

import { NotesPanel } from "../sidebar/NotesPanel"
import { TodoPanel } from "../sidebar/TodoPanel"
import { useUiState, useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { useStoreSelector } from "./controller/useStoreSelector"
import { usePanelShowing } from "./panels-shown"

const sameNotes = (a: readonly Note[], b: readonly Note[]): boolean =>
  a.length === b.length && a.every((note, index) => Object.is(note, b[index]))

// The open project's notes, todos among them, and whether the person's last change didn't take.
const useProjectNotes = (
  notes: Notes,
): { readonly projectId: string; readonly notes: readonly Note[]; readonly failed: boolean } => {
  const projectId = useWorkspaceState((workspace) => workspace.activeProjectId)
  const ofProject = useCallback(
    (state: NotesState) => state.notes.filter((note) => note.projectId === projectId),
    [projectId],
  )
  const projectNotes = useStoreSelector(notes.state, ofProject, sameNotes)
  const failed = useStoreSelector(notes.state, (state) => state.failed)
  return { projectId, notes: projectNotes, failed }
}

// The Notes panel, wired to where the backend keeps the person's notes: its field adds a plain
// note.
export const NotesSection = ({ notes }: { readonly notes: Notes }): React.JSX.Element => {
  const { commands } = useWorkspaceServices()
  const held = useProjectNotes(notes)
  const { projectId } = held
  const onAdd = useCallback(
    (text: string) => notes.add(projectId, { text, todo: false }),
    [notes, projectId],
  )
  // A backend that can't place a note, as an older runner, moves it among the open notes to the
  // same place.
  const onPlace = useCallback(
    (id: string, before: string | null) =>
      notes.place
        ? notes.place(id, null, before)
        : notes.move(id, plainIndex(notes.state.getSnapshot().notes, projectId, id, before)),
    [notes, projectId],
  )
  const active = useUiState((state) => state.location.route.panel === "notes")
  return (
    <NotesPanel
      key={projectId}
      {...held}
      onAdd={onAdd}
      onChange={notes.change}
      onPlace={onPlace}
      onRemove={notes.remove}
      active={active}
      onClose={commands.hideSidebar}
    />
  )
}

// The Todo board, wired to the same notes: its field adds a todo, and its cards are placed in its
// columns where the backend can place them.
export const TodoSection = ({ notes }: { readonly notes: Notes }): React.JSX.Element => {
  const { commands } = useWorkspaceServices()
  const held = useProjectNotes(notes)
  const { projectId } = held
  const onAdd = useCallback(
    (text: string) => notes.add(projectId, { text, todo: true }),
    [notes, projectId],
  )
  const active = useUiState((state) => state.location.route.panel === "todo")
  const showing = usePanelShowing("todo")
  return (
    <TodoPanel
      key={projectId}
      {...held}
      onAdd={onAdd}
      onChange={notes.change}
      onPlace={notes.place}
      onRemove={notes.remove}
      active={active}
      showing={showing}
      onClose={commands.hideSidebar}
    />
  )
}
