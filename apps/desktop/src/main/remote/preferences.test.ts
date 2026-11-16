import { EventEmitter } from "node:events"

import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron"
import { vi } from "vitest"

import { describe, expect, it } from "../../test"
import { askRemoteSettings, remoteSettingsPage, settingsAction } from "./preferences"
import type { RemoteSettings } from "./settings"

const origin = "https://novadeck-remote.invalid"
const saved = {
  url: "wss://runner.example/api/rpc",
  token: "a-test-token-of-more-than-32-characters",
}

class FormWindow extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: () => {} })
  pages: string[] = []
  closed = false
  loadURL(url: string): Promise<void> {
    this.pages.push(decodeURIComponent(url))
    return Promise.resolve()
  }
  show(): void {}
  close(): void {
    this.closed = true
    this.emit("closed")
  }
  navigate(path: string): void {
    this.webContents.emit("will-navigate", { preventDefault() {} }, `${origin}${path}`)
  }
  save(fields: Record<string, string> = {}): void {
    this.navigate(
      `/save?${new URLSearchParams({ url: saved.url, token: "", pagesProxy: "", ...fields })}`,
    )
  }
  get page(): string {
    return this.pages.at(-1)!
  }
}

const open = (
  options: {
    active?: boolean
    saved?: boolean
    check?: () => Promise<void>
    save?: () => Promise<void>
  } = {},
) => {
  const window = new FormWindow()
  const did: string[] = []
  const checked: RemoteSettings[] = []
  const written: RemoteSettings[] = []
  let configuration: BrowserWindowConstructorOptions | undefined
  const done = askRemoteSettings(
    undefined,
    (config) => {
      configuration = config
      return window as unknown as BrowserWindow
    },
    {
      ...(options.saved !== false && { saved }),
      active: options.active ?? true,
      check: async (settings) => {
        did.push("check")
        checked.push(settings)
        await options.check?.()
      },
      save: async (settings) => {
        did.push("save")
        written.push(settings)
        await options.save?.()
      },
      local: () => {
        did.push("local")
        return Promise.resolve()
      },
      restart: () => {
        did.push("restart")
      },
    },
  )
  return { window, done, did, checked, written, configuration }
}

describe("the remote runner settings", () => {
  it("shows escaped fields, a blank password and no script or saved token", () => {
    const page = remoteSettingsPage({
      url: '"><b>runner',
      pagesProxy: '"&proxy',
      savedToken: true,
      active: true,
      problem: "<script>bad</script>",
    })
    expect(page).toContain('type="password"')
    expect(page).toContain("Leave blank to keep the saved token")
    expect(page).toContain("default-src 'none'")
    expect(page).toContain("&lt;script&gt;bad&lt;/script&gt;")
    expect(page).toContain('value="&quot;&gt;&lt;b&gt;runner"')
    expect(page).not.toContain("<script>")
    expect(page).not.toContain(saved.token)
  })

  it("accepts only its own navigation paths", () => {
    expect(settingsAction(new URL(`${origin}/cancel`))).toEqual({ kind: "cancel" })
    expect(settingsAction(new URL(`${origin}/local`))).toEqual({ kind: "local" })
    expect(settingsAction(new URL(`${origin}/other`))).toBeUndefined()
    expect(settingsAction(new URL("https://elsewhere.test/save"))).toBeUndefined()
  })

  it("runs without script, Node, a preload or an on-disk session, even before an app window exists", () => {
    const { window, configuration } = open()
    expect(configuration?.webPreferences).toMatchObject({
      sandbox: true,
      javascript: false,
      nodeIntegration: false,
    })
    expect(configuration?.webPreferences?.partition).not.toMatch(/^persist:/)
    expect(configuration?.webPreferences?.preload).toBeUndefined()
    window.close()
  })

  it("keeps a blank token, checks before saving, then requests a normal restart", async () => {
    const { window, done, checked, written, did } = open()
    window.save()
    await done
    expect(checked).toEqual([saved])
    expect(written).toEqual([saved])
    expect(did).toEqual(["check", "save", "restart"])
  })

  it.each([true, false])("can save a new token with previous settings: %s", async (exists) => {
    const { window, done, written } = open({ saved: exists, active: exists })
    const token = "a-different-test-token-over-32-characters"
    window.save({ token, pagesProxy: "socks5://127.0.0.1:1080" })
    await done
    expect(written).toEqual([{ ...saved, token, pagesProxy: "socks5://127.0.0.1:1080" }])
  })

  it("keeps an invalid form open without connecting or saving", async () => {
    const { window, did } = open()
    window.save({ url: "http://runner.test" })
    await vi.waitFor(() => expect(window.page).toContain('role="alert"'))
    expect(did).toEqual([])
    expect(window.closed).toBe(false)
    window.close()
  })

  it("keeps a failed check open, hides its token, and requires a new replacement token on retry", async () => {
    const token = "a-replacement-test-token-over-32-characters"
    const { window, did } = open({ check: () => Promise.reject(new Error(`Refused ${token}`)) })
    window.save({ token })
    await vi.waitFor(() => expect(window.page).toContain("Refused [token]"))
    expect(window.page).not.toContain(token)
    expect(did).toEqual(["check"])
    window.close()
  })

  it("reports a failed write without restarting", async () => {
    const { window, did } = open({ save: () => Promise.reject(new Error("disk full")) })
    window.save()
    await vi.waitFor(() => expect(window.page).toContain("could not be saved"))
    expect(did).toEqual(["check", "save"])
    window.close()
  })

  it("ignores repeated submissions and cancels the save when closed during a check", async () => {
    let answer!: () => void
    const { window, done, did } = open({
      check: () =>
        new Promise<void>((resolve) => {
          answer = resolve
        }),
    })
    window.save()
    window.save()
    expect(window.page).toContain("Checking connection…")
    expect(did).toEqual(["check"])
    window.navigate("/cancel")
    await done
    answer()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(did).toEqual(["check"])
  })

  it("switches to local by retaining the settings before requesting a restart", async () => {
    const { window, done, did } = open()
    window.navigate("/local")
    await done
    expect(did).toEqual(["local", "restart"])
  })
})
