import { EventEmitter } from "node:events"

import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron"
import { vi } from "vitest"

import { context, describe, expect, it } from "../../test"
import { askRemoteFolder, folderAnswer, folderPromptPage, type FolderCheck } from "./folder"

describe("folderAnswer", () => {
  it("answers the path the person gave, as a form encodes it", () => {
    expect(
      folderAnswer("https://novadeck-folder.invalid/chosen?path=%2Fhome%2Fana%2Fmy+project"),
    ).toBe("/home/ana/my project")
  })

  it("answers none when the person cancelled", () => {
    expect(folderAnswer("https://novadeck-folder.invalid/cancelled")).toBeNull()
  })

  it("answers none for a path of nothing but spaces", () => {
    expect(folderAnswer("https://novadeck-folder.invalid/chosen?path=++")).toBeNull()
  })

  it("is no answer for any other address", () => {
    expect(folderAnswer("https://example.test/chosen?path=%2Fetc")).toBeUndefined()
    expect(folderAnswer("not an address")).toBeUndefined()
  })
})

describe("folderPromptPage", () => {
  it("runs no script and loads nothing", () => {
    const page = folderPromptPage()
    expect(page).toContain("default-src 'none'")
    expect(page).not.toContain("<script")
  })

  it("submits its path to the address the prompt reads its answer from", () => {
    const page = folderPromptPage()
    const action = /<form action="([^"]+)"/.exec(page)?.[1]
    expect(folderAnswer(`${action}?path=%2Fsrv%2Fapp`)).toBe("/srv/app")
  })

  it("shows a refused path and its problem as text, whatever they hold", () => {
    const page = folderPromptPage({ path: '/srv/"><b>', problem: "<i>gone</i> & lost" })
    expect(page).toContain('value="/srv/&quot;&gt;&lt;b&gt;"')
    expect(page).toContain("&lt;i&gt;gone&lt;/i&gt; &amp; lost")
    expect(page).not.toContain("<b>")
    expect(page).not.toContain("<i>")
  })
})

/** A window as the prompt uses one: its page's events for the test to raise, and what it did. */
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
  /** The page navigating to `url`; answers whether the window let it. */
  navigate(url: string): boolean {
    let prevented = false
    this.webContents.emit("will-navigate", { preventDefault: () => (prevented = true) }, url)
    return !prevented
  }
  /** The person submitting `path`. */
  submit(path: string): void {
    this.navigate(`https://novadeck-folder.invalid/chosen?path=${encodeURIComponent(path)}`)
  }
}

/** The prompt on a fake window, with a runner that knows the folders of `real`. */
const ask = (real: Readonly<Record<string, string>> = { "/srv/app": "/srv/app" }) => {
  const parent = {} as BrowserWindow
  let window: FakeWindow | undefined
  const asked: string[] = []
  const answers: ((check: FolderCheck) => void)[] = []
  const answer = askRemoteFolder(
    parent,
    (options) => {
      window = new FakeWindow(options)
      return window as unknown as BrowserWindow
    },
    (path) => {
      asked.push(path)
      return new Promise((settle) => {
        answers.push(settle)
      })
    },
  )
  /** The runner answering the path it was last asked about. */
  const runnerAnswers = async (): Promise<void> => {
    const path = asked.at(-1)!
    const found = real[path]
    answers.at(-1)!(found ? { path: found } : { problem: "No folder has that full path." })
    await Promise.resolve()
    await Promise.resolve()
  }
  return { answer, window: window!, parent, asked, runnerAnswers }
}

describe("askRemoteFolder", () => {
  it("opens a window over the app's that runs no script and has no preload", () => {
    const { window, parent } = ask()
    expect(window.options).toMatchObject({
      parent,
      modal: true,
      webPreferences: { sandbox: true, javascript: false, nodeIntegration: false },
    })
    expect(window.options.webPreferences?.preload).toBeUndefined()
    expect(window.loaded).toEqual([expect.stringContaining(folderPromptPage())])
  })

  it("answers the folder the runner finds at the path the person submits, and closes", async () => {
    const { answer, window, asked, runnerAnswers } = ask({ "/srv/link": "/srv/app" })
    expect(window.navigate("https://novadeck-folder.invalid/chosen?path=%2Fsrv%2Flink")).toBe(false)
    expect(asked).toEqual(["/srv/link"])
    expect(window.closed).toBe(false)
    await runnerAnswers()
    await expect(answer).resolves.toBe("/srv/app")
    expect(window.closed).toBe(true)
  })

  context("when the runner has no such folder", () => {
    it("shows the path again with what is wrong, and takes the mended one", async () => {
      const { answer, window, asked, runnerAnswers } = ask()
      window.submit("/srv/ap")
      await runnerAnswers()
      expect(window.closed).toBe(false)
      expect(window.loaded.at(-1)).toContain('value="/srv/ap"')
      expect(window.loaded.at(-1)).toContain("No folder has that full path.")
      window.submit("/srv/app")
      await runnerAnswers()
      expect(asked).toEqual(["/srv/ap", "/srv/app"])
      await expect(answer).resolves.toBe("/srv/app")
    })

    it("says so when the runner can't be asked at all", async () => {
      const parent = {} as BrowserWindow
      let window: FakeWindow | undefined
      void askRemoteFolder(
        parent,
        (options) => {
          window = new FakeWindow(options)
          return window as unknown as BrowserWindow
        },
        () => Promise.reject(new Error("unreachable")),
      )
      window!.submit("/srv/app")
      await vi.waitFor(() =>
        expect(window!.loaded.at(-1)).toContain("The runner could not be asked about that folder."),
      )
      expect(window!.closed).toBe(false)
    })
  })

  it("asks about one path at a time", async () => {
    const { window, asked, runnerAnswers } = ask()
    window.submit("/srv/app")
    window.submit("/srv/other")
    expect(asked).toEqual(["/srv/app"])
    await runnerAnswers()
  })

  context("when the person gives no folder", () => {
    it("answers none when they cancel", async () => {
      const { answer, window, asked } = ask()
      window.navigate("https://novadeck-folder.invalid/cancelled")
      await expect(answer).resolves.toBeNull()
      expect(asked).toEqual([])
    })

    it("answers none when they close the window", async () => {
      const { answer, window } = ask()
      window.close()
      await expect(answer).resolves.toBeNull()
    })

    it("answers none when they press Escape", async () => {
      const { answer, window } = ask()
      window.webContents.emit("before-input-event", {}, { type: "keyDown", key: "Escape" })
      await expect(answer).resolves.toBeNull()
    })

    it("answers none when they close the window while the runner is asked", async () => {
      const { answer, window, runnerAnswers } = ask()
      window.submit("/srv/app")
      window.close()
      await runnerAnswers()
      await expect(answer).resolves.toBeNull()
    })
  })

  it("lets its page go nowhere else", async () => {
    const { answer, window, asked } = ask()
    expect(window.navigate("https://example.test/")).toBe(false)
    expect(window.closed).toBe(false)
    expect(asked).toEqual([])
    window.close()
    await expect(answer).resolves.toBeNull()
  })
})
