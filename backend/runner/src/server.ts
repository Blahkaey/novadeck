import { maxWebSocketMessageBytes } from "@novadeck/protocol"

import { startHttpServer, type HttpOptions, type HttpServer } from "./http.js"
import type { RunnerOptions } from "./runner.js"
import type { TerminalOptions } from "./terminals/index.js"

export type ServerOptions = HttpOptions &
  Readonly<{
    token?: string
    database?: string
    /** Where the shell integration goes; see `RunnerOptions.shell`. */
    shell?: string
    /** Where pasted files go; see `RunnerOptions.uploads`. */
    uploads?: string
    /** Where saved dialogs go; see `RunnerOptions.dialogs`. */
    dialogs?: string
    /** The relay agents start for Novadeck's MCP server and hooks; see `RunnerOptions.relay`. */
    relay?: string
    /** Voice input's engine and where it installs; see `RunnerOptions.voice`. */
    voice?: RunnerOptions["voice"]
    /** Murmur's engine and where it installs; see `RunnerOptions.murmur`. */
    murmur?: RunnerOptions["murmur"]
    /**
     * A file holding the key saved transcripts are encrypted with, made on the first start;
     * see `loadKeyFile`. Without one no transcript is saved or shown again.
     */
    transcriptKeyFile?: string
    /** The cap on running and retained terminals: 32 when omitted, none when `null`. */
    maxTerminals?: number | null
    terminals?: TerminalOptions
  }>

export type { HttpServer as Server } from "./http.js"

/** Standalone runner: HTTP status plus a token-authenticated WebSocket runner API. */
export const startServer = async (options: ServerOptions = {}): Promise<HttpServer> => {
  if (options.token === undefined) return startHttpServer(options)
  const [{ createRunner }, { serveWebSocket }, { loadKeyFile }] = await Promise.all([
    import("./index.js"),
    import("@novadeck/wire/server"),
    import("./terminals/key-file.js"),
  ])
  // Read before anything starts, so a key file that can't be used stops the start.
  const transcriptKey =
    options.transcriptKeyFile === undefined
      ? undefined
      : await loadKeyFile(options.transcriptKeyFile)
  // A shared, network-reachable runner keeps a cap unless told otherwise; the
  // desktop runner has none. The manager reads an absent cap as none.
  const cap = options.maxTerminals === undefined ? 32 : options.maxTerminals
  const runner = createRunner({
    ...(options.database !== undefined && { database: options.database }),
    ...(transcriptKey !== undefined && { transcriptKey: Promise.resolve(transcriptKey) }),
    ...(options.shell !== undefined && { shell: options.shell }),
    ...(options.uploads !== undefined && { uploads: options.uploads }),
    ...(options.dialogs !== undefined && { dialogs: options.dialogs }),
    ...(options.relay !== undefined && { relay: options.relay }),
    ...(options.voice !== undefined && { voice: options.voice }),
    ...(options.murmur !== undefined && { murmur: options.murmur }),
    terminals: { ...(cap !== null && { maxTerminals: cap }), ...options.terminals },
  })
  let sockets: ReturnType<typeof serveWebSocket>
  try {
    sockets = serveWebSocket(runner.sessions, {
      path: "/api/rpc",
      token: options.token,
      origins: options.origins ?? ["http://127.0.0.1:5173"],
      maxPayloadBytes: maxWebSocketMessageBytes,
      // Room for a terminal's largest initial snapshot, and the traffic beside it.
      sendBudgetBytes: runner.snapshotBytes + 8 * 1024 * 1024,
    })
  } catch (error) {
    await runner.close()
    throw error
  }
  return startHttpServer(options, {
    attach: (server) => server.on("upgrade", sockets.upgrade),
    async close() {
      try {
        await sockets.close()
      } finally {
        await runner.close()
      }
    },
  })
}
