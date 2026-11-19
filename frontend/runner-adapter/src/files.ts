import { ChangeUnanswered, type FilesState, type ProjectFiles } from "@novadeck/core/files"
import { createStore } from "@novadeck/core/store"
import { hasCode, type Runner } from "@novadeck/runner-client"

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
    >
    readonly status: Pick<Runner["status"], "state">
  },
  connected: () => Promise<void>,
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
    remove: (projectId, path) => answered(() => projects.removeEntry({ projectId, path })),
    checkout: (projectId) => projects.checkout({ projectId }),
    update: (projectId) => projects.updateCheckout({ projectId }),
  }
}
