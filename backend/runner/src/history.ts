import type { ClosedTerminal, HistoryChange } from "@novadeck/protocol"

/**
 * What the router needs of History: a project's closed terminals, a stream of changes, and a
 * way to delete rows.
 */
export type History = {
  /** A project's closed terminals, newest first, each with its availability as of now. */
  list(projectId: string): Promise<ClosedTerminal[]>
  /**
   * Every closed terminal, then `synced`, then each later change, until `signal` aborts;
   * `ownerId` is the session following.
   */
  watch(ownerId: string, signal?: AbortSignal): AsyncGenerator<HistoryChange>
  /** Deletes the rows of these ids for good; one it doesn't keep, or that is being restored, is passed over. */
  erase(ids: readonly string[]): void
}
