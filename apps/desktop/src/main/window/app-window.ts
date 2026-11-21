// The app's own windows: opening one on the app's page, and telling a request or a page of
// the app's own UI from anything else a window may show.
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { Log } from "@novadeck/log"
import { pagesPartition } from "@novadeck/protocol/pages"
import { attachPage, webAddress } from "@novadeck/viewers/browser/host"
import {
  app,
  BrowserWindow,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron"

import { windowFocusChannel } from "../../bridge.js"
import { developmentOrigin, uiAddress, uiFile } from "../resources.js"
import type { PanelWindows } from "./panel-windows.js"
import { ownPage } from "./permissions.js"

// The folder the main process's bundle runs from, which the preload's sits beside.
const currentDirectory = dirname(fileURLToPath(import.meta.url))

/** Whether a frame shows this app's own UI: the packaged page or the dev server. */
export const isAppPage = (url: string): boolean => ownPage(url, uiAddress())

/**
 * The window of a request from the main frame of this app's own window showing its own
 * UI, or undefined for any other sender.
 */
export const appWindow = (event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | undefined => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const frame = event.senderFrame
  if (!window || !frame || frame !== event.sender.mainFrame || !isAppPage(frame.url)) return
  return window
}

/**
 * The pages of these windows that are alive and show the app, skipping any that crashed,
 * went away, or show something other than the app.
 */
export const appPages = (windows: readonly BrowserWindow[]): WebContents[] =>
  windows
    .map((window) => window.webContents)
    .filter(
      (contents) =>
        !contents.isDestroyed() &&
        !contents.isCrashed() &&
        contents.getURL() !== "" &&
        isAppPage(contents.getURL()),
    )

/**
 * Tells a window's page whether it has the system's focus, `focused`: the window or one of
 * its panel windows has it. The page tracks it itself only while its own document does,
 * not while focus is inside a frame of it or in a panel window.
 */
export const tellWindowFocus = (window: BrowserWindow, focused: boolean): void => {
  if (window.isDestroyed()) return
  const contents = window.webContents
  if (contents.isDestroyed() || !isAppPage(contents.getURL())) return
  contents.send(windowFocusChannel, focused)
}

/** Opens a link to the web in the system's browser; any other address goes nowhere. */
export const openOutside = (url: string): void => {
  if (webAddress(url)) void shell.openExternal(url)
}

/** Shows a window again, as a second launch asks for. */
export const bringForward = (window: BrowserWindow): void => {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * Logs what goes wrong with a window's page, as the page itself can't tell: it hangs, it
 * didn't load, or its preload failed.
 */
export const watchAppPage = (contents: WebContents, log: Log): void => {
  contents.on("unresponsive", () =>
    log.warn("ui.unresponsive", "A window's page stopped answering."),
  )
  contents.on("responsive", () => log.info("ui.responsive", "A window's page answers again."))
  contents.on("did-fail-load", (_event, code, description, url, mainFrame) => {
    if (mainFrame)
      log.error("ui.load-failed", "A window's page did not load.", {
        data: { code, description, url },
      })
  })
  contents.on("preload-error", (_event, _path, error) =>
    log.error("ui.preload-failed", "A window's preload failed.", { err: error }),
  )
}

/**
 * Opens a window on the app's page, hidden until its page is ready to show, on `ground`
 * so a dark theme never flashes white. `preloadArguments` reach its preload. It never
 * navigates away; links to the web open in the system's browser, a sidebar panel the page
 * asks for opens in a window of its own (see ./panel-windows.ts), and only page views of
 * the pages' partition attach.
 */
export const openAppWindow = ({
  ground,
  preloadArguments,
  runnerHost,
  panels,
}: {
  readonly ground: string
  readonly preloadArguments: readonly string[]
  readonly runnerHost?: string
  readonly panels: PanelWindows<BrowserWindow>
}): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: ground,
    webPreferences: {
      additionalArguments: [...preloadArguments],
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(currentDirectory, "../preload/index.cjs"),
      sandbox: true,
      // Live pages in the companion pane; see @novadeck/viewers/browser/host.
      webviewTag: true,
    },
  })

  if (runnerHost) {
    const title = `Novadeck — ${runnerHost}`
    window.setTitle(title)
    window.on("page-title-updated", (event) => {
      event.preventDefault()
      window.setTitle(title)
    })
  }

  window.once("ready-to-show", () => window.show())
  panels.watchFocus(window)

  window.webContents.on("will-navigate", (event) => event.preventDefault())
  // The app uses no WebRTC, and no page policy can keep a frame in it from opening a peer
  // connection, as a PDF's (libraries/viewers/src/pdf.ts) could: none of it sends UDP that
  // doesn't go through a proxy (see SECURITY.md, PDF Previews).
  window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")

  window.webContents.setWindowOpenHandler((details) => {
    const panel = panels.request(window, details)
    if (panel) return { action: "allow", overrideBrowserWindowOptions: panel }
    openOutside(details.url)
    return { action: "deny" }
  })
  panels.host(window)

  window.webContents.on("will-attach-webview", (event, preferences, params) => {
    if (!attachPage(preferences, params, pagesPartition)) event.preventDefault()
  })

  if (app.isPackaged) {
    void window.loadFile(uiFile())
  } else {
    void window.loadURL(developmentOrigin)
  }

  return window
}
