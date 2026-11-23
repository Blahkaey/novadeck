import {
  ChangeUnanswered,
  type FilesState,
  type ProjectFiles,
  type ProjectFilesClipboard,
} from "@novadeck/core/files"
import { createStore } from "@novadeck/core/store"
import type { DesktopFilesClipboard } from "@novadeck/protocol/bridge"
import { hasCode, type Runner } from "@novadeck/runner-client"

type Imports = Pick<
  Runner["projects"],
  "beginImport" | "writeImport" | "writeImportPart" | "finishImport"
>

const fileClipboard = (
  clipboard: DesktopFilesClipboard,
  projects: Imports,
  answered: <T>(send: () => Promise<T>) => Promise<T>,
): ProjectFilesClipboard => ({
  mark: (marker) => clipboard.mark(marker),
  async paste(projectId, into, marker, progress) {
    const selection = await clipboard.read(marker)
    if (typeof selection === "string") return selection
    const { id: transfer, entries } = selection
    let sent = 0
    const total = entries.reduce((size, entry) => size + (entry.size ?? 0), 0)
    try {
      await projects.beginImport({ projectId, into, transfer }).catch((error: unknown) => {
        if (hasCode(error, "NOT_FOUND") && error instanceof Error && error.message === "Not Found")
          throw new Error("Update the runner to paste files from Finder.", { cause: error })
        throw error
      })
      progress(sent, total)
      for (const [index, entry] of entries.entries()) {
        // eslint-disable-next-line no-await-in-loop -- A file's entry precedes its bytes.
        await projects.writeImport(transfer, { kind: "entry", entry })
        for (let offset = 0; offset < (entry.size ?? 0);) {
          // eslint-disable-next-line no-await-in-loop -- Keep only one part of the file in memory.
          const bytes = await clipboard.chunk(transfer, index, offset)
          if (bytes.length === 0) throw new Error("A file ended before its copy was complete.")
          // eslint-disable-next-line no-await-in-loop -- Send the next part only after this one is saved.
          await projects.writeImportPart(transfer, offset, bytes)
          offset += bytes.length
          sent += bytes.length
          progress(sent, total)
        }
      }
      return await answered(() => projects.finishImport(transfer))
    } catch (error) {
      await projects.writeImport(transfer, { kind: "cancel" }).catch(() => {})
      throw error
    } finally {
      await clipboard.release(transfer).catch(() => {})
    }
  },
})

// The runner's project folders as the Files panel reads them, each folder when it is asked
// for, each project's own patterns for hiding files, which the runner keeps, and the person's
// changes to the project's files, which the runner makes. The state stays empty: the panel's
// changes come from the runner's works instead. A move, a copy or a delete the connection dropped
// under may still be made by the runner, which nothing tells of after: it fails as
// `ChangeUnanswered` only once `connected` says the runner is back, or given up on, so the
// panel's reading of the folders again then shows what the runner did. One asked while the runner
// isn't connected is never sent, and says so.
export const createRunnerFiles = (
  runner: {
    readonly projects: Pick<
      Runner["projects"],
      | "folder"
      | "checkout"
      | "updateCheckout"
      | "filesExclude"
      | "setFilesExclude"
      | "createEntry"
      | "moveEntry"
      | "copyEntry"
      | "removeEntry"
    > &
      Imports
    readonly status: Pick<Runner["status"], "state">
  },
  connected: () => Promise<void>,
  clipboard?: DesktopFilesClipboard,
): ProjectFiles => {
  const { projects } = runner
  const state = createStore<FilesState>({ projects: {} })
  const answered = async <T>(send: () => Promise<T>): Promise<T> => {
    // The client sends nothing while it reconnects, refusing at once.
    const sent = runner.status.state === "connected"
    try {
      return await send()
    } catch (error) {
      if (!hasCode(error, "DISCONNECTED")) throw error
      if (!sent)
        throw new Error("Novadeck isn't connected to the runner, so nothing was done.", {
          cause: error,
        })
      await connected()
      throw new ChangeUnanswered({ cause: error })
    }
  }
  return {
    state,
    list: (projectId, folder) => projects.folder({ projectId, folder }),
    exclude: {
      read: (projectId) => projects.filesExclude({ projectId }),
      save: (projectId, patterns) => projects.setFilesExclude({ projectId, patterns }),
    },
    create: async (projectId, path, folder) =>
      (await projects.createEntry({ projectId, path, folder })).path,
    move: async (projectId, from, to) =>
      (await answered(() => projects.moveEntry({ projectId, from, to }))).path,
    copy: async (projectId, from, into) =>
      (await answered(() => projects.copyEntry({ projectId, from, into }))).path,
    ...(clipboard && { clipboard: fileClipboard(clipboard, projects, answered) }),
    remove: (projectId, path) => answered(() => projects.removeEntry({ projectId, path })),
    checkout: (projectId) => projects.checkout({ projectId }),
    update: (projectId) => projects.updateCheckout({ projectId }),
  }
}
