import { EventEmitter } from "node:events"

import type { FolderBrowse } from "@novadeck/protocol"
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron"
import { vi } from "vitest"

import { context, describe, expect, it } from "../../test"
import {
  askRemoteFolder,
  folderAction,
  folderBrowserPage,
  inside,
  type FolderLook,
  type RemoteFolders,
} from "./folder"

const origin = "https://novadeck-folder.invalid"

const home: FolderBrowse = {
  path: "/home/ana",
  parent: "/home",
  folders: [".config", "code", "notes"],
  truncated: false,
}

/** The links of a page, as the addresses they go to, by their text. */
const links = (page: string): Record<string, string> =>
  Object.fromEntries(
    [...page.matchAll(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map(([, href, text]) => [
      text!.replaceAll("&amp;", "&"),
      href!.replaceAll("&amp;", "&"),
    ]),
  )

describe("folderAction", () => {
  it("browses to the path a link or the field gives, or home without one", () => {
    expect(folderAction(new URL(`${origin}/browse?path=%2Fhome%2Fana%2Fmy+project`))).toEqual({
      kind: "browse",
      path: "/home/ana/my project",
    })
    expect(folderAction(new URL(`${origin}/browse?path=++`))).toEqual({
      kind: "browse",
      path: undefined,
    })
    expect(folderAction(new URL(`${origin}/browse`))).toEqual({ kind: "browse", path: undefined })
  })

  it("opens the path the field holds, and browses home when it holds none", () => {
    expect(folderAction(new URL(`${origin}/open?path=%2Fsrv%2Fapp`))).toEqual({
      kind: "open",
      path: "/srv/app",
    })
    expect(folderAction(new URL(`${origin}/open?path=`))).toEqual({
      kind: "browse",
      path: undefined,
    })
  })

  it("cancels, and is no action for any other address", () => {
    expect(folderAction(new URL(`${origin}/cancelled`))).toEqual({ kind: "cancel" })
    expect(folderAction(new URL(`${origin}/elsewhere`))).toBeUndefined()
    expect(folderAction(new URL("https://example.test/browse?path=%2Fetc"))).toBeUndefined()
  })
})

describe("inside", () => {
  it("joins a name to a folder with the separator its path uses", () => {
    expect(inside("/home/ana", "code")).toBe("/home/ana/code")
    expect(inside("/", "home")).toBe("/home")
    expect(inside("C:\\Users\\ana", "code")).toBe("C:\\Users\\ana\\code")
    expect(inside("C:\\", "Users")).toBe("C:\\Users")
  })
})

describe("folderBrowserPage", () => {
  const view = { folder: home, path: home.path, places: [{ name: "Home", path: "/home/ana" }] }

  it("runs no script and loads nothing", () => {
    const page = folderBrowserPage(view)
    expect(page).toContain("default-src 'none'")
    expect(page).not.toContain("<script")
  })

  it("links each folder, hidden ones last, the folder above, and the places to start from", () => {
    const page = folderBrowserPage(view)
    const shown = links(page)
    expect(Object.keys(shown)).toEqual(["Home", "..", "code/", "notes/", ".config/", "Cancel"])
    for (const [text, path] of [
      ["..", "/home"],
      ["code/", "/home/ana/code"],
      [".config/", "/home/ana/.config"],
      ["Home", "/home/ana"],
    ] as const)
      expect(folderAction(new URL(shown[text]!))).toEqual({ kind: "browse", path })
    expect(folderAction(new URL(shown.Cancel!))).toEqual({ kind: "cancel" })
  })

  it("holds the folder's path in its field, to browse to with Go or open with its button", () => {
    const page = folderBrowserPage(view)
    expect(page).toContain(`value="/home/ana"`)
    const action = /<form action="([^"]+)"/.exec(page)?.[1]
    const open = /<button formaction="([^"]+)">Open this folder<\/button>/.exec(page)?.[1]
    expect(folderAction(new URL(`${action}?path=%2Fsrv`))).toEqual({ kind: "browse", path: "/srv" })
    expect(folderAction(new URL(`${open}?path=%2Fsrv`))).toEqual({ kind: "open", path: "/srv" })
    // Enter in the field browses: Go is the form's first button.
    expect(page.indexOf(">Go</button>")).toBeLessThan(page.indexOf(">Open this folder</button>"))
  })

  it("has no way up from the root, and says when a folder holds no folders", () => {
    const page = folderBrowserPage({
      folder: { path: "/", parent: null, folders: [], truncated: false },
      path: "/",
      places: [],
    })
    expect(Object.keys(links(page))).toEqual(["Cancel"])
    expect(page).toContain("No folders in this folder.")
  })

  it("says when only some of a folder's folders are listed", () => {
    const page = folderBrowserPage({ ...view, folder: { ...home, truncated: true } })
    expect(page).toContain("Only the first 3 folders are listed")
  })

  it("shows names, paths and problems as text, and percent-encodes paths in links", () => {
    const strange = '"><b>x&y'
    const page = folderBrowserPage({
      folder: { path: `/srv/${strange}`, parent: "/srv", folders: [strange], truncated: false },
      path: `/srv/${strange}`,
      problem: "<i>gone</i> & lost",
      places: [{ name: `<b>${strange}`, path: `/p/${strange}` }],
    })
    expect(page).not.toContain("<b>")
    expect(page).not.toContain("<i>")
    expect(page).toContain("&lt;i&gt;gone&lt;/i&gt; &amp; lost")
    expect(page).toContain('value="/srv/&quot;&gt;&lt;b&gt;x&amp;y"')
    const shown = links(page)
    const link = shown["&quot;&gt;&lt;b&gt;x&y/".replaceAll("&amp;", "&")]
    expect(link).toBeDefined()
    expect(link).not.toMatch(/[<>"' ]/)
    expect(folderAction(new URL(link!))).toEqual({
      kind: "browse",
      path: `/srv/${strange}/${strange}`,
    })
  })
})

/** A window as the browser uses one: its page's events for the test to raise, and what it did. */
class FakeWindow extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: () => {},
  })
  readonly loaded: string[] = []
  closed = false
  constructor(readonly options: BrowserWindowConstructorOptions) {
    super()
  }
  loadURL(url: string): Promise<void> {
    this.loaded.push(decodeURIComponent(url))
    return Promise.resolve()
  }
  show(): void {}
  close(): void {
    if (this.closed) return
    this.closed = true
    this.emit("closed")
  }
  get page(): string {
    return this.loaded.at(-1)!
  }
  /** The page navigating to `url`; answers whether the window let it. */
  navigate(url: string): boolean {
    let prevented = false
    this.webContents.emit("will-navigate", { preventDefault: () => (prevented = true) }, url)
    return !prevented
  }
  /** The person clicking the link that reads `text`. */
  click(text: string): void {
    this.navigate(links(this.page)[text]!)
  }
}

/** The browser on a fake window, over a runner that has `folders`, answering when told. */
const browse = (
  folders: Readonly<Record<string, FolderBrowse>> = {
    "/home/ana/code": {
      path: "/home/ana/code",
      parent: "/home/ana",
      folders: [],
      truncated: false,
    },
    "/srv/link": { path: "/srv/app", parent: "/srv", folders: [], truncated: false },
  },
) => {
  const parent = {} as BrowserWindow
  let window: FakeWindow | undefined
  const asked: (string | undefined)[] = []
  const answers: ((look: FolderLook) => void)[] = []
  let closes = 0
  const runner: RemoteFolders = {
    browse: (path) => {
      asked.push(path)
      return new Promise((settle) => {
        answers.push(settle)
      })
    },
    places: () => Promise.resolve([{ name: "Storefront", path: "/home/ana/code" }]),
    close: () => {
      closes += 1
    },
  }
  const answer = askRemoteFolder(
    parent,
    (options) => {
      window = new FakeWindow(options)
      return window as unknown as BrowserWindow
    },
    runner,
  )
  /** The runner answering what it was last asked about, and the window drawing or closing. */
  const runnerAnswers = async (): Promise<void> => {
    const path = asked.at(-1)
    const found = path === undefined ? home : folders[path]
    const drawn = window!.loaded.length
    answers.at(-1)!(found ?? { problem: "No folder has that path." })
    await vi.waitFor(() => expect(window!.loaded.length > drawn || window!.closed).toBe(true))
  }
  return { answer, window: window!, parent, asked, runnerAnswers, closes: () => closes }
}

describe("askRemoteFolder", () => {
  it("opens a window over the app's that runs no script and has no preload", () => {
    const { window, parent } = browse()
    expect(window.options).toMatchObject({
      parent,
      modal: true,
      width: 460,
      height: 460,
      webPreferences: { sandbox: true, javascript: false, nodeIntegration: false },
    })
    expect(window.options.webPreferences?.preload).toBeUndefined()
    expect(window.options.webPreferences?.partition).not.toMatch(/^persist:/)
  })

  it("starts in the home folder, with the projects' folders to start from", async () => {
    const { window, asked, runnerAnswers } = browse()
    expect(asked).toEqual([undefined])
    await runnerAnswers()
    expect(Object.keys(links(window.page))).toEqual([
      "Home",
      "Storefront",
      "..",
      "code/",
      "notes/",
      ".config/",
      "Cancel",
    ])
    expect(window.page).toContain('value="/home/ana"')
  })

  it("goes into a folder clicked, and opens the folder shown, by its real path", async () => {
    const { answer, window, asked, runnerAnswers, closes } = browse()
    await runnerAnswers()
    window.click("code/")
    await runnerAnswers()
    expect(window.page).toContain('value="/home/ana/code"')
    expect(window.closed).toBe(false)

    window.navigate(`${origin}/open?path=%2Fhome%2Fana%2Fcode`)
    await runnerAnswers()

    await expect(answer).resolves.toBe("/home/ana/code")
    expect(asked).toEqual([undefined, "/home/ana/code", "/home/ana/code"])
    expect(window.closed).toBe(true)
    expect(closes()).toBe(1)
  })

  it("opens a path typed into its field, once the runner has looked at it", async () => {
    const { answer, window, runnerAnswers } = browse()
    await runnerAnswers()
    window.navigate(`${origin}/open?path=%2Fsrv%2Flink`)
    expect(window.closed).toBe(false)
    await runnerAnswers()
    await expect(answer).resolves.toBe("/srv/app")
  })

  context("when the runner can't show a path", () => {
    it("keeps the folder shown, with the path typed and the reason, for the person to mend", async () => {
      const { answer, window, runnerAnswers } = browse()
      await runnerAnswers()
      window.navigate(`${origin}/open?path=%2Fsrv%2Fap`)
      await runnerAnswers()
      expect(window.closed).toBe(false)
      expect(window.page).toContain('value="/srv/ap"')
      expect(window.page).toContain("No folder has that path.")
      expect(Object.keys(links(window.page))).toContain("code/")

      window.navigate(`${origin}/open?path=%2Fsrv%2Flink`)
      await runnerAnswers()
      await expect(answer).resolves.toBe("/srv/app")
    })

    it("says so when the runner can't be asked at all, and still takes a typed path", async () => {
      let window: FakeWindow | undefined
      let reachable = false
      const answer = askRemoteFolder(
        {} as BrowserWindow,
        (options) => {
          window = new FakeWindow(options)
          return window as unknown as BrowserWindow
        },
        {
          browse: (path) =>
            reachable
              ? Promise.resolve({ path: path ?? "/", parent: null, folders: [], truncated: false })
              : Promise.reject(new Error("unreachable")),
          places: () => Promise.reject(new Error("unreachable")),
          close: () => {},
        },
      )
      await vi.waitFor(() =>
        expect(window!.page).toContain("The runner could not be asked about that folder."),
      )
      reachable = true
      window!.navigate(`${origin}/open?path=%2Fsrv`)
      await expect(answer).resolves.toBe("/srv")
    })
  })

  it("asks the runner one thing at a time", async () => {
    const { window, asked, runnerAnswers } = browse()
    window.navigate(`${origin}/browse?path=%2Fsrv`)
    expect(asked).toEqual([undefined])
    await runnerAnswers()
    window.click("code/")
    window.click("notes/")
    expect(asked).toEqual([undefined, "/home/ana/code"])
  })

  context("when the person opens no folder", () => {
    it("answers none when they cancel", async () => {
      const { answer, window, runnerAnswers, closes } = browse()
      await runnerAnswers()
      window.click("Cancel")
      await expect(answer).resolves.toBeNull()
      expect(closes()).toBe(1)
    })

    it("answers none when they close the window", async () => {
      const { answer, window } = browse()
      window.close()
      await expect(answer).resolves.toBeNull()
    })

    it("answers none when they press Escape", async () => {
      const { answer, window } = browse()
      window.webContents.emit("before-input-event", {}, { type: "keyDown", key: "Escape" })
      await expect(answer).resolves.toBeNull()
    })

    it("answers none when they close the window while the runner is asked", async () => {
      const { answer, window, runnerAnswers } = browse()
      await runnerAnswers()
      window.navigate(`${origin}/open?path=%2Fsrv%2Flink`)
      window.close()
      await runnerAnswers()
      await expect(answer).resolves.toBeNull()
    })
  })

  it("lets its page go nowhere else", async () => {
    const { answer, window, asked } = browse()
    expect(window.navigate("https://example.test/")).toBe(false)
    expect(window.closed).toBe(false)
    expect(asked).toEqual([undefined])
    window.close()
    await expect(answer).resolves.toBeNull()
  })
})
