import { posix, win32 } from "node:path"

import type { Install, Model } from "@novadeck/harness-core/harness"
import type { AgentName, Project, TourPrepared } from "@novadeck/protocol"

import { DomainError } from "../errors.js"
import { agentLabel } from "../messaging/messages.js"
import { briefFiles, startLine } from "./brief.js"
import { resetTourFolder, tourFolder } from "./folder.js"
import { tourChoice, tourLaunch } from "./launch.js"

/** What the tour needs of the runner. */
export type TourHost = {
  readonly home?: string
  readonly platform?: NodeJS.Platform
  readonly connected: (agent: AgentName) => Promise<boolean>
  readonly models: (agent: AgentName) => Promise<readonly Model[]>
  readonly install: (agent: AgentName) => Promise<Install | undefined>
  readonly projects: {
    readonly list: () => readonly Project[]
    readonly remove: (projectId: string) => Promise<void>
  }
  /** Rings `text` to the terminal's agent as Novadeck's notice; false where it has none yet. */
  readonly notice: (terminalId: string, text: string) => boolean
}

/**
 * Novadeck's tour, on the runner's side: its folder, made afresh for each run, and the line
 * that starts its agent there. The client opens the project and the terminal, as it lays them
 * out; see docs/backend-api.md.
 */
export class Tour {
  // The run being readied, so a second start meanwhile doesn't empty its folder under it.
  private preparing: Promise<TourPrepared> | undefined

  constructor(private readonly host: TourHost) {}

  /**
   * Readies a run of the tour with `agent`: removes any project open at its folder, closing
   * its terminals, so nothing runs there; then empties the folder and writes the brief there;
   * then builds the agent's launch line, on its cheapest model. An agent Novadeck isn't
   * connected to is a `CONFLICT`, as its tools would be missing; so is a folder that isn't
   * Novadeck's (`resetTourFolder`), and a run asked for while another is being readied. One
   * whose cheapest model can't be told is `MODELS_UNLISTED`: Codex lists its models only once
   * it has started signed in (probed 2026-11-15, 0.169.0: a start not signed in writes no
   * models_cache.json). Nothing changes for any of them.
   */
  prepare(agent: AgentName): Promise<TourPrepared> {
    if (this.preparing)
      return Promise.reject(new DomainError("CONFLICT", "The tour is already starting."))
    const preparing = this.ready(agent).finally(() => {
      this.preparing = undefined
    })
    this.preparing = preparing
    return preparing
  }

  private async ready(agent: AgentName): Promise<TourPrepared> {
    if (!(await this.host.connected(agent)))
      throw new DomainError(
        "CONFLICT",
        `Novadeck isn't connected to ${agentLabel(agent)}, so the tour can't start with it.`,
      )
    // Its cheapest model first, before anything is removed: the person agreed to that one.
    const [models, install] = await Promise.all([
      this.host.models(agent).catch((): readonly Model[] => []),
      this.host.install(agent).catch(() => undefined),
    ])
    if (tourChoice(agent, models).model === undefined)
      throw new DomainError(
        "MODELS_UNLISTED",
        `${agentLabel(agent)} hasn't listed its models here yet, so the tour can't pick its cheapest. Start ${agentLabel(agent)} and sign in, then take the tour.`,
      )
    const directory = tourFolder(this.host.home)
    // Those being removed too, as their shells may still be closing there: the removal
    // under way is waited for.
    const removed = this.host.projects
      .list()
      .filter(({ cwd }) => withinFolder(cwd, directory, this.host.platform))
      .map(({ id }) => id)
    await Promise.all(
      removed.map((id) =>
        Promise.resolve()
          .then(() => this.host.projects.remove(id))
          .catch((error: unknown) => {
            // Removed meanwhile, as from another window.
            if (!(error instanceof DomainError && error.code === "NOT_FOUND")) throw error
          }),
      ),
    )
    await resetTourFolder(directory, briefFiles)
    const launch = await tourLaunch(agent, { models, install, cwd: directory })
    return { ...launch, directory, removed }
  }

  /**
   * Rings the tour's start line to the agent in `terminalId`, for a harness whose launch line
   * takes none (`brief: "doorbell"`): the doorbell delivers it once the agent's prompt shows and
   * its tools are listed. A terminal whose agent hasn't shown yet is a `CONFLICT`; the client
   * asks once it has.
   */
  brief(terminalId: string): void {
    if (!this.host.notice(terminalId, startLine))
      throw new DomainError("CONFLICT", "The terminal's agent hasn't started yet.")
  }
}

/**
 * Whether `path` is `folder` or inside it. Windows' and macOS' file systems don't tell cases
 * apart (macOS' as installed), so neither does this there.
 */
export const withinFolder = (
  path: string,
  folder: string,
  platform: NodeJS.Platform = process.platform,
): boolean => {
  const paths = platform === "win32" ? win32 : posix
  const fold = (text: string) =>
    platform === "win32" || platform === "darwin" ? text.toLowerCase() : text
  const inner = paths.relative(fold(paths.resolve(folder)), fold(paths.resolve(path)))
  return inner === "" || (inner.split(paths.sep)[0] !== ".." && !paths.isAbsolute(inner))
}
