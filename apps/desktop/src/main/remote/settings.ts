import { randomUUID } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

/** The file in the app's data folder that names a runner on another machine. */
export const remoteSettingsFile = "remote-runner.json"
export const remoteOffFile = "remote-runner.off.json"

/**
 * A runner on another machine, which the app connects to in place of starting its own: its
 * shells, agents and files are that machine's.
 */
export type RemoteSettings = {
  /**
   * The runner's WebSocket, `ws://127.0.0.1:8787/api/rpc` where an SSH tunnel brings the
   * runner's port to this machine.
   */
  readonly url: string
  /** The runner's `NOVADECK_TOKEN`. */
  readonly token: string
  /**
   * A SOCKS proxy that leaves from the runner's machine, as `ssh -D` opens one, such as
   * `socks5://127.0.0.1:1080`: the companion pane's pages load through it, so an address
   * like `localhost:3000` is the runner's machine's, where the agent's server runs.
   */
  readonly pagesProxy?: string
}

/** Whether `host` names this machine only, as the runner's own check has it. */
const loopback = (host: string): boolean => {
  const name = host.replace(/^\[(.*)\]$/, "$1").toLowerCase()
  return name === "localhost" || name === "::1" || /^127(\.\d{1,3}){3}$/.test(name)
}

const runnerUrl = (value: unknown): string => {
  const url = typeof value === "string" ? URL.parse(value.trim()) : null
  if (!url || (url.protocol !== "ws:" && url.protocol !== "wss:"))
    throw new Error('"url" must be a ws: or wss: address, such as ws://127.0.0.1:8787/api/rpc')
  // The token crosses in the handshake: in the clear only where nothing can listen in.
  if (url.protocol === "ws:" && !loopback(url.hostname))
    throw new Error(
      `"url" reaches ${url.hostname} unencrypted: use an SSH tunnel to this machine (ws://127.0.0.1:…) or a wss: address`,
    )
  return url.href
}

/** Saves checked settings atomically, with no interval where a partial file can be read. */
export const writeRemoteSettings = async (
  folder: string,
  settings: RemoteSettings,
): Promise<void> => {
  const checked = remoteSettingsOf(JSON.stringify(settings))
  const temporary = join(folder, `.remote-runner-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, { mode: 0o600, flag: "wx" })
    await rename(temporary, join(folder, remoteSettingsFile))
  } finally {
    await rm(temporary, { force: true })
  }
}

/** Keeps the remote settings for switching back, in place of deleting them. */
export const disableRemoteSettings = async (folder: string): Promise<void> => {
  try {
    await rename(join(folder, remoteSettingsFile), join(folder, remoteOffFile))
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

const runnerToken = (value: unknown): string => {
  const token = typeof value === "string" ? value.trim() : ""
  if (token.length < 32 || token.length > 512)
    throw new Error('"token" must be the runner\'s NOVADECK_TOKEN, 32 to 512 characters')
  return token
}

const proxy = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined
  const url = typeof value === "string" ? URL.parse(value.trim()) : null
  if (!url || !["socks5:", "socks4:", "http:"].includes(url.protocol) || !url.port)
    throw new Error(
      '"pagesProxy" must be a proxy address with a port, such as socks5://127.0.0.1:1080',
    )
  return `${url.protocol}//${url.host}`
}

/** The settings `text` holds, a JSON object; throws an error that says what is wrong with it. */
export const remoteSettingsOf = (text: string): RemoteSettings => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("it is not JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("it must hold a JSON object")
  const { url, token, pagesProxy } = parsed as Record<string, unknown>
  const through = proxy(pagesProxy)
  return {
    url: runnerUrl(url),
    token: runnerToken(token),
    ...(through !== undefined && { pagesProxy: through }),
  }
}

/**
 * The remote runner `file` names, or undefined where there is no such file and the app runs
 * its own. A file that can't be read or understood throws, naming the file: the app must
 * not quietly start a runner on this machine when the person asked for another's.
 */
export const readRemoteSettings = async (
  file: string,
  read: (path: string, encoding: "utf8") => Promise<string> = readFile,
): Promise<RemoteSettings | undefined> => {
  let text: string
  try {
    text = await read(file, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw new Error(`${file} could not be read`, { cause: error })
  }
  try {
    return remoteSettingsOf(text)
  } catch (error) {
    throw new Error(`${file} is not a remote runner's settings: ${(error as Error).message}`, {
      cause: error,
    })
  }
}
