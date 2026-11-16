import { randomUUID } from "node:crypto"

import { connectRunner, hasCode, type Runner } from "@novadeck/runner-client"
import { websocket } from "@novadeck/wire/client"

import type { FolderCheck } from "./folder.js"
import type { RemoteSettings } from "./settings.js"

/** The part of a runner the check uses. */
type Projects = { readonly projects: Pick<Runner["projects"], "create" | "remove"> } & Pick<
  Runner,
  "close"
>

// How long the runner has to answer about one folder.
const checkMs = 10_000

/**
 * Asks the runner whether `path` is a folder on its machine, before the page makes a project
 * of it: a project the runner refuses would stay in the window, with terminals that can't
 * start. The runner has no call that only looks, so a project is made there and removed at
 * once, which takes the same checks and answers the folder's real path. `connect` reaches
 * the runner as a client of its own, apart from the page's.
 */
export const checkRemoteFolder = async (
  path: string,
  connect: () => Promise<Projects>,
): Promise<FolderCheck> => {
  let runner: Projects
  try {
    runner = await connect()
  } catch {
    return { problem: "The runner could not be reached to check that folder." }
  }
  const id = randomUUID()
  try {
    const project = await runner.projects.create({ id, name: "Folder check", cwd: path })
    await runner.projects.remove({ projectId: id })
    return { path: project.cwd }
  } catch (error) {
    if (hasCode(error, "INVALID_DIRECTORY"))
      return { problem: "No folder has that full path on the runner's machine." }
    // Made but not removed, as when the connection dropped in between: removed if it can be.
    await runner.projects.remove({ projectId: id }).catch(() => {})
    return { problem: "The runner could not be asked about that folder." }
  } finally {
    await runner.close().catch(() => {})
  }
}

/** A client of the remote runner for one check: its own connection, closed after it. */
export const remoteClient =
  (settings: Pick<RemoteSettings, "url" | "token">): (() => Promise<Runner>) =>
  () =>
    connectRunner(websocket(settings.url, { token: settings.token }), {
      signal: AbortSignal.timeout(checkMs),
      timeoutMs: checkMs,
    })
