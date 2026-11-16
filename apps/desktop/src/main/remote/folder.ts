import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron"

// The addresses the prompt's page navigates to, which never load (the name is one no
// network resolves): the window reads its answer from them.
const origin = "https://novadeck-folder.invalid"
const chosen = `${origin}/chosen`
const cancelled = `${origin}/cancelled`

/**
 * What the runner says of a path the person gave: the folder it names there, by its real
 * path, or why it can't be opened, in words for the person.
 */
export type FolderCheck = { readonly path: string } | { readonly problem: string }

const entities: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

const escaped = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => entities[character] ?? character)

/**
 * The prompt's page: a form for one path, and a link that cancels. It runs no script; the
 * form and the link navigate to addresses of the prompt's own. Shown again after a path the
 * runner refused, it holds that `path` and says the `problem`.
 */
export const folderPromptPage = (
  again: { readonly path: string; readonly problem: string } | undefined = undefined,
): string => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Open folder</title>
<style>
  :root { color-scheme: light dark; font: 13px system-ui, sans-serif; }
  body { margin: 0; padding: 20px; }
  label { display: block; font-weight: 600; margin-bottom: 4px; }
  p { margin: 0 0 12px; opacity: 0.7; }
  p[role="alert"] { margin: 8px 0 0; opacity: 1; color: #c0392b; }
  input { box-sizing: border-box; width: 100%; padding: 6px 8px; font: 13px ui-monospace, monospace; }
  div { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 16px; }
  button { padding: 5px 16px; font: inherit; }
  a { color: inherit; }
</style>
<form action="${chosen}" method="get">
  <label for="path">Folder on the runner's machine</label>
  <p>Its full path there, such as /home/you/project.</p>
  <input id="path" name="path" required autofocus autocomplete="off" spellcheck="false" placeholder="/home/you/project" value="${escaped(again?.path ?? "")}">
  ${again ? `<p role="alert">${escaped(again.problem)}</p>` : ""}
  <div><a href="${cancelled}">Cancel</a><button>Open</button></div>
</form>
</html>`

/**
 * What a navigation of the prompt's page answers: the path the person gave, null when they
 * cancelled or gave none, and undefined for any other address, which is no answer.
 */
export const folderAnswer = (address: string): string | null | undefined => {
  const url = URL.parse(address)
  if (url?.origin !== origin) return undefined
  if (url.pathname !== "/chosen") return null
  const path = url.searchParams.get("path")?.trim()
  return path ? path : null
}

/** The prompt's window: over the app's, without script, a preload or anything of Node. */
const promptWindow = (parent: BrowserWindow): BrowserWindowConstructorOptions => ({
  parent,
  modal: true,
  width: 460,
  height: 210,
  useContentSize: true,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  autoHideMenuBar: true,
  show: false,
  title: "Open folder",
  webPreferences: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    javascript: false,
    // Its own session, kept nowhere: nothing of the app's or the pages'.
    partition: "folder-prompt",
  },
})

const pageAddress = (page: string): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(page)}`

/**
 * Asks the person for a folder on the runner's machine, which no folder picker of this
 * machine can browse: a small window over `parent` with a field for its path. `check` asks
 * the runner about each path given; one it refuses is shown again with the reason, for the
 * person to mend. Answers the folder's real path there, or null when the person cancels or
 * closes the window.
 */
export const askRemoteFolder = (
  parent: BrowserWindow,
  create: (options: BrowserWindowConstructorOptions) => BrowserWindow,
  check: (path: string) => Promise<FolderCheck>,
): Promise<string | null> =>
  new Promise((resolve) => {
    const window = create(promptWindow(parent))
    let answer: string | null = null
    let gone = false
    // One path is asked about at a time: what the person does meanwhile waits for its answer.
    let checking = false
    const { webContents } = window
    const ask = async (path: string): Promise<void> => {
      checking = true
      const result = await check(path).catch((): FolderCheck => ({
        problem: "The runner could not be asked about that folder.",
      }))
      checking = false
      if (gone) return
      if ("path" in result) {
        answer = result.path
        window.close()
        return
      }
      void window.loadURL(pageAddress(folderPromptPage({ path, problem: result.problem })))
    }
    webContents.on("will-navigate", (event, address) => {
      event.preventDefault()
      const given = folderAnswer(address)
      if (given === undefined || checking) return
      if (given === null) window.close()
      else void ask(given)
    })
    webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") window.close()
    })
    window.once("ready-to-show", () => window.show())
    window.once("closed", () => {
      gone = true
      resolve(answer)
    })
    void window.loadURL(pageAddress(folderPromptPage()))
  })
