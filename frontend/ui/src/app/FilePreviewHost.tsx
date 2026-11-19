import { absolutePath } from "@novadeck/core/files"
import type { Item } from "@novadeck/core/items"
import type { WorkspaceTarget } from "@novadeck/core/types"
import type { WorkPreview } from "@novadeck/core/works"
import { FilePreview } from "@novadeck/items/FilePreview"
import type { Agent, Rename } from "@novadeck/items/FilePreview"
import { ProjectWindow } from "@novadeck/items/ProjectWindow"
import type { ItemStore } from "@novadeck/items/store"
import { useCallback, useEffect, useMemo, useState } from "react"

import { filesOfWorks } from "../sidebar/files-works"
import { useUiState, useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { useStoreSelector } from "./controller/useStoreSelector"
import {
  copyOf,
  noFiles,
  noWorks,
  ownersOf,
  previewFiles,
  sameOwners,
  sameWorks,
} from "./files-feed"
import { currentTarget, projectWindowFile, sameTarget, stateAt } from "./selectors"
import type { FilePreviewRequest } from "./ui-store"
import { useWorktreesShown } from "./use-worktrees-shown"

// How often an open preview is read again while an agent writes the file: the works come every
// few seconds, and a write that changes a file again leaves what the agent's status says the same.
const writingEveryMs = 2000

const noHandles: ReadonlySet<string> = new Set()

// Whether the window should go back to the project's own file: it points at an agent's copy in
// its worktree (main lacked the file) and the preview, read, lists no work for it any longer
// (merged, or closed), so what the window holds is about to be gone.
export const shouldRepoint = (
  request: Pick<FilePreviewRequest, "backed">,
  preview: Pick<WorkPreview, "unavailable" | "works" | "renames"> | undefined,
): boolean =>
  request.backed &&
  preview !== undefined &&
  !preview.unavailable &&
  preview.works.length === 0 &&
  preview.renames.length === 0

type FileWindow = {
  readonly item: Item | undefined
  readonly itemStore: ItemStore
  readonly target: WorkspaceTarget
}

// A restored file in the project can offer a diff once the works have reported. An agent
// copy opened in this app has its project-relative path in the saved open request.
const requestOf = (
  item: Item | undefined,
  directory: string,
  projectId: string,
  saved: FilePreviewRequest | undefined,
): FilePreviewRequest | undefined => {
  if (item?.kind !== "file" || item.path === null) return undefined
  if (saved?.itemId === item.id && saved.itemVersion === item.version) return saved
  const base = absolutePath(directory, "")
  if (!item.path.startsWith(base)) return undefined
  const path = item.path.slice(base.length)
  return {
    itemId: item.id,
    itemVersion: item.version,
    projectId,
    path: base.endsWith("\\") ? path.replaceAll("\\", "/") : path,
    backed: false,
    showDiff: false,
  }
}

const WithDiff = ({
  item,
  itemStore,
  target,
  request,
}: FileWindow & {
  readonly item: Item
  readonly request: FilePreviewRequest
}): React.JSX.Element => {
  const { projectId, path, backed, showDiff, opened } = request
  const { backend, commands, workspace, ui } = useWorkspaceServices()
  const works = backend.works
  // The works can start changing the file while the editor is open.
  useEffect(() => works?.watch(), [works])
  const synced = useStoreSelector(works?.state ?? noWorks, (state) => state.synced)
  const projectWorks = useStoreSelector(
    works?.state ?? noWorks,
    (state) => state.works.filter((work) => work.projectId === projectId),
    sameWorks,
  )
  const owners = useWorkspaceState(
    (state) => ownersOf(state.projects.find((project) => project.id === projectId)?.history ?? []),
    sameOwners,
  )
  const filesProject = useStoreSelector(
    backend.files?.state ?? noFiles,
    (state) => state.projects[projectId],
  )
  const project = useMemo(
    () => filesProject ?? filesOfWorks(projectWorks, projectId, owners),
    [filesProject, projectWorks, projectId, owners],
  )
  const writing = useMemo(
    () =>
      new Set(
        Object.entries(project?.writing ?? {}).flatMap(([handle, file]) =>
          file === path ? [handle] : [],
        ),
      ),
    [project, path],
  )
  const lit = useUiState((state) => state.filesLit)

  // What changes the preview: a work that changes the file, or lines of it, anew.
  const changed = useMemo(
    () =>
      JSON.stringify(
        previewFiles(projectWorks, projectId, path).map(({ work, file }) => [
          work.root,
          file.path,
          file.status,
          file.changedAt,
          file.added,
          file.removed,
          work.working,
        ]),
      ),
    [projectWorks, projectId, path],
  )
  const hasWork = changed !== "[]"
  const reading = (showDiff && (hasWork || !synced)) || (backed && synced && !hasWork)
  const [answer, setAnswer] = useState<{ changed: string; result: WorkPreview | "failed" }>()
  const preview = answer?.result === "failed" ? undefined : answer?.result
  const [saving, setSaving] = useState(false)
  const writers = [...writing].toSorted().join(" ")
  useEffect(() => {
    if (!works || !reading) return
    let live = true
    // One read at a time; what came meanwhile is read once it ends.
    let busy = false
    let again = false
    const read = (): void => {
      if (busy) {
        again = true
        return
      }
      busy = true
      again = false
      works
        .preview(projectId, path)
        .then(
          (found) => {
            if (live) setAnswer({ changed, result: found })
          },
          () => {
            if (live) setAnswer({ changed, result: "failed" })
          },
        )
        .finally(() => {
          busy = false
          if (live && again) read()
        })
    }
    read()
    const timer = writers === "" ? undefined : setInterval(read, writingEveryMs)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [works, projectId, path, changed, writers, reading])

  const stillShowing = useCallback(() => {
    const file = projectWindowFile(stateAt(workspace.getSnapshot(), target))
    return file?.id === item.id && file.version === item.version && file.path === item.path
  }, [workspace, target, item.id, item.version, item.path])
  const choose = useCallback(
    (next: boolean): void => {
      if (!stillShowing()) return
      const key = `${projectId}/${target.workspaceSessionId}`
      ui.update((state) => {
        const saved = state.filePreviews[key]
        const current =
          saved?.itemId === item.id && saved.itemVersion === item.version ? saved : undefined
        if (current?.opened !== opened || (current?.showDiff ?? false) === next) return state
        return {
          ...state,
          filePreviews: { ...state.filePreviews, [key]: { ...request, showDiff: next } },
        }
      })
    },
    [
      stillShowing,
      projectId,
      target.workspaceSessionId,
      ui,
      item.id,
      item.version,
      opened,
      request,
    ],
  )

  const currentAnswer = answer?.changed === changed
  const empty =
    currentAnswer &&
    preview !== undefined &&
    !preview.unavailable &&
    preview.works.length === 0 &&
    preview.renames.length === 0
  const available = hasWork && !empty
  const unreadable = answer?.result === "failed" || preview?.unavailable !== undefined
  useEffect(() => {
    if (showDiff && ((!hasWork && synced) || unreadable || empty)) choose(false)
  }, [showDiff, hasWork, synced, unreadable, empty, choose])

  const agents = useMemo(
    (): readonly Agent[] =>
      (preview?.works ?? []).map((work) => {
        const handle = work.terminalId === null ? undefined : owners.get(work.terminalId)?.handle
        return {
          key: work.root,
          handle,
          label: handle === undefined ? (work.branch ?? "worktree") : `@${handle}`,
          status: work.status,
          changedAt: work.changedAt,
          renamedFrom: work.renamedFrom,
          hunks: work.hunks,
        }
      }),
    [preview, owners],
  )
  // Where main has the file by now, the window goes back to it; where it still doesn't it stays.
  const repoint = !hasWork && currentAnswer && shouldRepoint(request, preview)
  useEffect(() => {
    if (repoint && stillShowing() && sameTarget(currentTarget(workspace.getSnapshot()), target))
      commands.openProjectFile(path).catch(() => {})
  }, [repoint, commands, path, stillShowing, target, workspace])
  const renames = useMemo(
    (): readonly Rename[] =>
      (preview?.renames ?? []).map((rename) => {
        const handle =
          rename.terminalId === null ? undefined : owners.get(rename.terminalId)?.handle
        return {
          label: handle === undefined ? (rename.branch ?? "worktree") : `@${handle}`,
          to: rename.to,
        }
      }),
    [preview, owners],
  )
  const openDiff = (): void => {
    setAnswer(undefined)
    choose(true)
  }
  const toggle = (): void => {
    if (showDiff) {
      choose(false)
      return
    }
    const save = item.path === null ? undefined : itemStore.saveFile(target, item.id, item.path)
    if (!save) {
      openDiff()
      return
    }
    setSaving(true)
    void save.then((result) => {
      setSaving(false)
      if (result === "saved") openDiff()
    })
  }
  const diff =
    showDiff && available && !unreadable ? (
      preview ? (
        <FilePreview
          path={path}
          main={preview.main}
          agents={agents}
          lit={lit ?? noHandles}
          writing={writing}
          renames={renames}
          onOpen={(to) =>
            void commands
              .openProjectFile(to, { preview: true, copy: copyOf(projectWorks, projectId, to) })
              .catch(() => {})
          }
        />
      ) : (
        <div className="artifact-status" role="status">
          Reading worktree diff…
        </div>
      )
    ) : undefined
  return (
    <ProjectWindow
      item={item}
      itemStore={itemStore}
      target={target}
      worktreeCopy={backed}
      diff={available ? { body: diff, saving, toggle } : undefined}
      notice={available && unreadable ? "Couldn't read the worktree diff." : undefined}
    />
  )
}

export const FilePreviewHost = ({ item, itemStore, target }: FileWindow): React.JSX.Element => {
  const enabled = useWorktreesShown()
  const directory = useWorkspaceState(
    (state) => state.projects.find(({ id }) => id === target.projectId)?.directory ?? "",
  )
  const saved = useUiState(
    (state) => state.filePreviews[`${target.projectId}/${target.workspaceSessionId}`],
  )
  const request = requestOf(item, directory, target.projectId, saved)
  return enabled && request && item && !item.secret ? (
    <WithDiff
      key={JSON.stringify([item.id, item.version, request.opened])}
      item={item}
      itemStore={itemStore}
      target={target}
      request={request}
    />
  ) : (
    <ProjectWindow
      item={item}
      itemStore={itemStore}
      target={target}
      worktreeCopy={request?.backed}
    />
  )
}
