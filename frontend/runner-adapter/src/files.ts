import type { ProjectFiles, FilesState } from "@novadeck/core/files"
import { createStore } from "@novadeck/core/store"
import type { Runner } from "@novadeck/runner-client"

// The runner's project folders as the Files panel reads them, each folder when it is asked
// for, each project's own patterns for hiding files, which the runner keeps, and the person's
// changes to the project's files, which the runner makes. The state stays empty: the panel's
// changes come from the runner's works instead.
export const createRunnerFiles = (
  projects: Pick<
    Runner["projects"],
    "folder" | "filesExclude" | "setFilesExclude" | "createEntry" | "moveEntry" | "removeEntry"
  >,
): ProjectFiles => {
  const state = createStore<FilesState>({ projects: {} })
  return {
    state,
    list: (projectId, folder) => projects.folder({ projectId, folder }),
    exclude: {
      read: (projectId) => projects.filesExclude({ projectId }),
      save: (projectId, patterns) => projects.setFilesExclude({ projectId, patterns }),
    },
    create: async (projectId, path, folder) =>
      (await projects.createEntry({ projectId, path, folder })).path,
    move: async (projectId, from, to) => (await projects.moveEntry({ projectId, from, to })).path,
    remove: (projectId, path) => projects.removeEntry({ projectId, path }),
  }
}
