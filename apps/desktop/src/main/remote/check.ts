import { connectRunner, hasCode, type Runner } from "@novadeck/runner-client"
import { websocket } from "@novadeck/wire/client"

import type { FolderLook, Place, RemoteFolders } from "./folder.js"
import type { RemoteSettings } from "./settings.js"

/** The part of a runner the folder browser uses. */
type Projects = { readonly projects: Pick<Runner["projects"], "browse" | "list"> } & Pick<
  Runner,
  "close"
>

// How long the runner has to answer each time.
const checkMs = 10_000

/** `promise`, or a failure once the runner has taken longer than `checkMs` to answer. */
const timed = <T>(promise: Promise<T>): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("The runner took too long to answer.")), checkMs).unref()
    }),
  ])

/**
 * The runner's folders for the folder browser, over a connection of its own, apart from the
 * page's: made at the first question, kept for the next, and made again after one that
 * failed. Each look only looks: the runner makes nothing of it. `connect` reaches the runner.
 */
export const remoteFolders = (connect: () => Promise<Projects>): RemoteFolders => {
  let runner: Promise<Projects> | undefined
  let closed = false
  const reach = (): Promise<Projects> => {
    runner ??= connect()
    // A connection that failed is made again next time.
    runner.catch(() => (runner = undefined))
    return runner
  }
  return {
    async browse(path): Promise<FolderLook> {
      let client: Projects
      try {
        client = await reach()
      } catch {
        return { problem: "The runner could not be reached to look at that folder." }
      }
      try {
        return await timed(client.projects.browse(path === undefined ? {} : { path }))
      } catch (error) {
        // The runner says why in words for the person: not a full path, no such folder,
        // not a folder, or one it can't read.
        if (hasCode(error, "INVALID_DIRECTORY"))
          return {
            problem:
              error instanceof Error && error.message
                ? error.message
                : "No folder has that full path on the runner's machine.",
          }
        return { problem: "The runner could not be asked about that folder." }
      }
    },
    async places(): Promise<readonly Place[]> {
      const client = await reach()
      const projects = await timed(client.projects.list())
      return projects.map((project) => ({ name: project.name, path: project.cwd }))
    },
    close() {
      if (closed) return
      closed = true
      void runner?.then((client) => client.close()).catch(() => {})
    },
  }
}

/** A client of the remote runner, on its own connection. */
export const remoteClient =
  (settings: Pick<RemoteSettings, "url" | "token">): (() => Promise<Runner>) =>
  () =>
    connectRunner(websocket(settings.url, { token: settings.token }), {
      signal: AbortSignal.timeout(checkMs),
      timeoutMs: checkMs,
    })
