import type { FolderBrowse } from "@novadeck/protocol"
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron"

import { addressOf, escaped, openPageWindow, page } from "./page-window.js"

// The addresses the browser's page navigates to, which never load: the window reads what the
// person did from them.
const origin = "https://novadeck-folder.invalid"

/** A folder to start from: the home folder, or a project's. */
export type Place = { readonly name: string; readonly path: string }

/** What the runner says of a path: the folder there, or why it can't be shown, in words for the person. */
export type FolderLook = FolderBrowse | { readonly problem: string }

/** The runner's folders, as the browser asks about them over one connection. */
export type RemoteFolders = {
  /** The folder at `path`, or the runner owner's home folder without one. */
  browse(path: string | undefined): Promise<FolderLook>
  /** The folders of the runner's projects, to start from; none when they can't be read. */
  places(): Promise<readonly Place[]>
  /** Ends the connection, once the browser is done. */
  close(): void
}

/** What the browser shows: the folder, the path field, what went wrong, and where to start from. */
export type FolderView = {
  /** The folder shown; none until the runner showed one. */
  readonly folder?: FolderBrowse
  /** What the path field holds: the folder's path, or what the person typed. */
  readonly path: string
  /** Why the path last asked about can't be shown or opened. */
  readonly problem?: string
  readonly places: readonly Place[]
}

/** What the person did on the page. */
export type FolderAction =
  | { readonly kind: "browse"; readonly path: string | undefined }
  | { readonly kind: "open"; readonly path: string }
  | { readonly kind: "cancel" }

/** What a navigation of the browser's page asks for, or undefined for no action of its. */
export const folderAction = (url: URL): FolderAction | undefined => {
  if (url.origin !== origin) return undefined
  const path = url.searchParams.get("path")?.trim() || undefined
  if (url.pathname === "/browse") return { kind: "browse", path }
  if (url.pathname === "/open") return path ? { kind: "open", path } : { kind: "browse", path }
  if (url.pathname === "/cancelled") return { kind: "cancel" }
  return undefined
}

/** `name` in the folder at `path`, joined with the separator that path uses. */
export const inside = (path: string, name: string): string => {
  const separator = /^[A-Za-z]:\\|^\\\\/.test(path) ? "\\" : "/"
  return path.endsWith(separator) ? `${path}${name}` : `${path}${separator}${name}`
}

const browseLink = (path: string, text: string, label = text): string =>
  `<a href="${escaped(addressOf(origin, "/browse", { path }))}" title="${escaped(label)}">${escaped(text)}</a>`

const style = `
  body { height: 100vh; }
  form { display: flex; flex-direction: column; height: 100%; }
  .path { display: flex; gap: 8px; }
  .places { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 8px 0 0; }
  ul { flex: 1; overflow: auto; list-style: none; margin: 12px 0 0; padding: 4px 0; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 4px; }
  li a { display: block; padding: 3px 10px; text-decoration: none; font: 13px ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  li a:hover, li a:focus { background: color-mix(in srgb, Highlight 30%, transparent); outline: none; }
  li.hidden a { opacity: 0.6; }
  li.empty { padding: 3px 10px; opacity: 0.6; }
  .note { margin: 8px 0 0; }
  .actions { margin-top: 12px; }`

/**
 * The browser's page: a typable path field, the places to start from, the folder's
 * subfolders as links (hidden ones last), and a button that opens the folder shown, or the
 * path typed. It runs no script: every link and button navigates to an address of the
 * browser's own, and names and paths are escaped wherever they show.
 */
export const folderBrowserPage = (view: FolderView): string => {
  const { folder } = view
  const sorted = folder
    ? [
        ...folder.folders.filter((name) => !name.startsWith(".")),
        ...folder.folders.filter((name) => name.startsWith(".")),
      ]
    : []
  const entries = folder
    ? [
        ...(folder.parent === null
          ? []
          : [`<li>${browseLink(folder.parent, "..", `Up to ${folder.parent}`)}</li>`]),
        ...sorted.map(
          (name) =>
            `<li${name.startsWith(".") ? ' class="hidden"' : ""}>${browseLink(inside(folder.path, name), `${name}/`, inside(folder.path, name))}</li>`,
        ),
        ...(sorted.length === 0 ? ['<li class="empty">No folders in this folder.</li>'] : []),
      ]
    : []
  return page(
    "Open folder",
    style,
    `<form action="${origin}/browse" method="get">
  <label for="path">Folder on the runner's machine</label>
  <div class="path">
    <input id="path" name="path" autofocus autocomplete="off" spellcheck="false" placeholder="/home/you/project" value="${escaped(view.path)}">
    <button>Go</button>
  </div>
  ${view.places.length > 0 ? `<nav class="places" aria-label="Places">${view.places.map((place) => browseLink(place.path, place.name, place.path)).join("")}</nav>` : ""}
  ${view.problem ? `<p role="alert">${escaped(view.problem)}</p>` : ""}
  ${folder ? `<ul aria-label="Folders in ${escaped(folder.path)}">${entries.join("")}</ul>` : '<ul aria-label="Folders"></ul>'}
  ${folder?.truncated ? `<p class="note">Only the first ${folder.folders.length} folders are listed: type a path to go further.</p>` : ""}
  <div class="actions"><a href="${origin}/cancelled">Cancel</a><button formaction="${origin}/open">Open this folder</button></div>
</form>`,
  )
}

/** The places to start from: the home folder first, then each project's, each path once. */
const placesOf = (home: string | undefined, projects: readonly Place[]): readonly Place[] => {
  const all = [...(home === undefined ? [] : [{ name: "Home", path: home }]), ...projects]
  return all.filter((place, index) => all.findIndex((each) => each.path === place.path) === index)
}

/**
 * Asks the person for a folder on the runner's machine, which no folder picker of this
 * machine can browse: a small window over `parent` that starts in the runner owner's home
 * folder, with its folders to click through, places to start from, and a path field to type
 * into. "Open this folder" answers the folder shown, or the path typed, by its real path
 * there, once the runner has looked at it; one it can't show stays to be mended, with the
 * reason. Answers null when the person cancels or closes the window.
 */
export const askRemoteFolder = (
  parent: BrowserWindow,
  create: (options: BrowserWindowConstructorOptions) => BrowserWindow,
  folders: RemoteFolders,
): Promise<string | null> =>
  new Promise((resolve) => {
    let view: FolderView = { path: "", places: [] }
    let home: string | undefined
    let projects: readonly Place[] = []
    let answer: string | null = null
    // One thing is asked of the runner at a time: what the person does meanwhile is dropped.
    let busy = false
    const look = (path: string | undefined): Promise<FolderLook> =>
      folders.browse(path).catch((): FolderLook => ({
        problem: "The runner could not be asked about that folder.",
      }))
    const window = openPageWindow(parent, create, {
      title: "Open folder",
      width: 460,
      height: 460,
      resizable: true,
      partition: "folder-prompt",
      origin,
      first: folderBrowserPage(view),
      navigate: (url) => {
        const action = folderAction(url)
        if (action === undefined || busy) return
        if (action.kind === "cancel") return window.close()
        void act(action)
      },
      closed: () => {
        folders.close()
        resolve(answer)
      },
    })
    const act = async (action: Exclude<FolderAction, { kind: "cancel" }>): Promise<void> => {
      busy = true
      const result = await look(action.path)
      busy = false
      if (window.gone) return
      if ("problem" in result) {
        view = { ...view, path: action.path ?? "", problem: result.problem }
      } else if (action.kind === "open") {
        answer = result.path
        return window.close()
      } else {
        view = { folder: result, path: result.path, places: placesOf(home, projects) }
      }
      window.draw(folderBrowserPage(view))
    }
    // The home folder first, with the projects' folders to start from.
    busy = true
    void Promise.all([look(undefined), folders.places().catch(() => [])]).then(
      ([result, places]) => {
        busy = false
        projects = places
        if (!("problem" in result)) home = result.path
        view =
          "problem" in result
            ? { path: "", problem: result.problem, places: placesOf(home, projects) }
            : { folder: result, path: result.path, places: placesOf(home, projects) }
        window.draw(folderBrowserPage(view))
      },
    )
  })
