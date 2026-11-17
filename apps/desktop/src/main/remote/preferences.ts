import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron"

import { addressOf, escaped, openPageWindow, page } from "./page-window.js"
import { remoteSettingsOf, type RemoteSettings } from "./settings.js"

const origin = "https://novadeck-remote.invalid"

export type RemoteForm = {
  readonly url: string
  readonly pagesProxy: string
  readonly savedToken: boolean
  readonly active: boolean
  readonly busy?: boolean
  readonly problem?: string | undefined
}

/** The token is never drawn, even after a failed check. */
export const remoteSettingsPage = (form: RemoteForm): string =>
  page(
    "Remote Runner",
    `
    h1 { font-size: 18px; margin: 0 0 12px; }
    input { margin-bottom: 14px; }
    .local { display: block; margin-top: 20px; }
  `,
    `
    <h1>Remote Runner</h1>
    <p>Terminals, agents and files belong to the computer running the runner.</p>
    <form action="${addressOf(origin, "/save")}" method="get" autocomplete="off">
      <fieldset ${form.busy ? "disabled" : ""} style="border:0;padding:0;margin:0">
        <label for="url">Address</label>
        <input id="url" name="url" value="${escaped(form.url)}" placeholder="wss://computer.example/api/rpc" autofocus required>
        <label for="token">Token</label>
        <input id="token" name="token" type="password" autocomplete="off" placeholder="${form.savedToken ? "Leave blank to keep the saved token" : "The runner's NOVADECK_TOKEN"}">
        <label for="pagesProxy">Pages proxy (optional)</label>
        <input id="pagesProxy" name="pagesProxy" value="${escaped(form.pagesProxy)}" placeholder="socks5://127.0.0.1:1080">
        <p>Pages load through this proxy from the runner's computer.</p>
        ${form.problem ? `<p role="alert">${escaped(form.problem)}</p>` : ""}
        <div class="actions"><a href="${addressOf(origin, "/cancel")}">Cancel</a><button>${form.busy ? "Checking connection…" : "Save and Restart"}</button></div>
        ${form.active ? `<a class="local" href="${addressOf(origin, "/local")}">Use this computer's runner</a>` : ""}
      </fieldset>
    </form>`,
  )

export type SettingsAction =
  | {
      readonly kind: "save"
      readonly url: string
      readonly token: string
      readonly pagesProxy: string
    }
  | { readonly kind: "local" | "cancel" }

export const settingsAction = (url: URL): SettingsAction | undefined => {
  if (url.origin !== origin) return
  if (url.pathname === "/cancel") return { kind: "cancel" }
  if (url.pathname === "/local") return { kind: "local" }
  if (url.pathname !== "/save") return
  return {
    kind: "save",
    url: url.searchParams.get("url") ?? "",
    token: url.searchParams.get("token") ?? "",
    pagesProxy: url.searchParams.get("pagesProxy") ?? "",
  }
}

/** Opens the host's own form. Every failure stays in the form; no navigation is logged. */
export const askRemoteSettings = (
  parent: BrowserWindow | undefined,
  create: (options: BrowserWindowConstructorOptions) => BrowserWindow,
  options: {
    readonly saved?: RemoteSettings
    readonly active: boolean
    readonly problem?: string
    readonly check: (settings: RemoteSettings) => Promise<void>
    readonly save: (settings: RemoteSettings) => Promise<void>
    readonly local: () => Promise<void>
    readonly restart: () => void
  },
): Promise<void> =>
  new Promise((resolve) => {
    let busy = false
    let form: RemoteForm = {
      url: options.saved?.url ?? "",
      pagesProxy: options.saved?.pagesProxy ?? "",
      savedToken: Boolean(options.saved?.token),
      active: options.active,
      ...(options.problem && { problem: options.problem }),
    }
    const window = openPageWindow(parent, create, {
      title: "Remote Runner",
      width: 500,
      height: 500,
      partition: "novadeck-remote-settings",
      origin,
      first: remoteSettingsPage(form),
      closed: resolve,
      navigate: (url) => {
        const action = settingsAction(url)
        if (!action) return
        if (action.kind === "cancel") return window.close()
        if (busy) return
        if (action.kind === "local" && !options.active) return
        busy = true
        void (async () => {
          try {
            if (action.kind === "local") await options.local()
            else if (action.kind === "save") {
              form = { ...form, url: action.url, pagesProxy: action.pagesProxy, problem: undefined }
              const settings = remoteSettingsOf(
                JSON.stringify({
                  url: action.url,
                  token: action.token.trim() || options.saved?.token || "",
                  pagesProxy: action.pagesProxy,
                }),
              )
              window.draw(remoteSettingsPage({ ...form, busy: true }))
              await options.check(settings)
              // Closing during a check cancels the save and restart too.
              if (window.gone) return
              try {
                await options.save(settings)
              } catch {
                throw new Error(
                  "The connection settings could not be saved. Check that the app's data folder is writable.",
                )
              }
            }
            // Request quitting before closing the last window, which otherwise starts a
            // quit on Linux and Windows before the restart has been requested.
            options.restart()
            window.close()
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : "The connection could not be checked."
            // Even an injected error cannot echo a token into the next page.
            const tokens = [
              options.saved?.token,
              action.kind === "save" ? action.token.trim() : undefined,
            ]
            const problem = tokens.reduce<string>(
              (text, token) => (token ? text.replaceAll(token, "[token]") : text),
              reason,
            )
            window.draw(remoteSettingsPage({ ...form, problem }))
          } finally {
            busy = false
          }
        })()
      },
    })
  })
