import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron"

// The small windows a remote runner asks things in (a folder, its connection settings) show
// pages the main process writes, which run no script: each link and form navigates to an
// address of the window's own, which never loads (the name is one no network resolves), and
// the main process reads the person's answer from it and draws the next page.

const entities: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

/** `text` as HTML shows it, in an element or an attribute's value. */
export const escaped = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => entities[character] ?? character)

/** The page's address: the page itself, as a `data:` URL. */
export const pageAddress = (page: string): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(page)}`

/**
 * The address of a window's `path`, with `params` percent-encoded, as a link or a form of
 * the page goes to it.
 */
export const addressOf = (
  origin: string,
  path: string,
  params: Readonly<Record<string, string>> = {},
): string => {
  const query = new URLSearchParams(params).toString()
  return `${origin}${path}${query ? `?${query}` : ""}`
}

/** What a navigation of the page answers: the address, if it is one of `origin`'s. */
export const answerAt = (origin: string, address: string): URL | undefined => {
  const url = URL.parse(address)
  return url?.origin === origin ? url : undefined
}

/** The style every such page shares, which the page's content policy lets in. */
export const pageStyle = `
  :root { color-scheme: light dark; font: 13px system-ui, sans-serif; }
  body { margin: 0; padding: 20px; box-sizing: border-box; }
  label { display: block; font-weight: 600; margin-bottom: 4px; }
  p { margin: 0 0 12px; opacity: 0.7; }
  p[role="alert"] { margin: 8px 0 0; opacity: 1; color: #c0392b; }
  input { box-sizing: border-box; width: 100%; padding: 6px 8px; font: 13px ui-monospace, monospace; }
  button { padding: 5px 16px; font: inherit; }
  a { color: inherit; }
  .actions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 16px; }`

/** A page with the content policy every such page has: no script, nothing loaded. */
export const page = (title: string, style: string, body: string): string => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escaped(title)}</title>
<style>${pageStyle}${style}</style>
${body}
</html>`

export type PageWindowOptions = {
  readonly title: string
  readonly width: number
  readonly height: number
  readonly resizable?: boolean
  /** The session it runs in, kept nowhere, apart from the app's and the pages'. */
  readonly partition: string
}

/** The window: over the app's, without script, a preload or anything of Node. */
export const pageWindowOptions = (
  parent: BrowserWindow | undefined,
  options: PageWindowOptions,
): BrowserWindowConstructorOptions => ({
  ...(parent && { parent }),
  modal: true,
  width: options.width,
  height: options.height,
  useContentSize: true,
  resizable: options.resizable ?? false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  autoHideMenuBar: true,
  show: false,
  title: options.title,
  webPreferences: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    javascript: false,
    // Not `persist:`, so nothing of it is kept on disk.
    partition: options.partition,
  },
})

/** A page window as its owner holds it. */
export type PageWindow = {
  /** Draws `page` in place of what the window shows. */
  draw(page: string): void
  close(): void
  /** Whether the window has closed. */
  readonly gone: boolean
}

/**
 * Opens a page window over `parent`, drawing `first`. Every navigation of its page is held
 * back: one to an address of `origin` goes to `navigate`, and any other goes nowhere. It opens
 * no other window, and Escape closes it. `closed` hears once that it has closed, however it
 * did. A navigation's address may carry what the person typed, a token among it: it is never
 * logged here.
 */
export const openPageWindow = (
  parent: BrowserWindow | undefined,
  create: (options: BrowserWindowConstructorOptions) => BrowserWindow,
  options: PageWindowOptions & {
    readonly origin: string
    readonly first: string
    readonly navigate: (url: URL) => void
    readonly closed: () => void
  },
): PageWindow => {
  const window = create(pageWindowOptions(parent, options))
  let gone = false
  const { webContents } = window
  webContents.on("will-navigate", (event, address) => {
    event.preventDefault()
    const url = answerAt(options.origin, address)
    if (url) options.navigate(url)
  })
  webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") window.close()
  })
  window.once("ready-to-show", () => window.show())
  window.once("closed", () => {
    gone = true
    options.closed()
  })
  void window.loadURL(pageAddress(options.first))
  return {
    draw: (next) => {
      if (!gone) void window.loadURL(pageAddress(next))
    },
    close: () => {
      if (!gone) window.close()
    },
    get gone() {
      return gone
    },
  }
}
