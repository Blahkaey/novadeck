import { EventEmitter } from "node:events"

import { railPanels } from "@novadeck/core/types"
import type { Rectangle } from "electron"
import { afterEach, vi } from "vitest"

import { context, describe, expect, it } from "../../test"
import {
  focusSettleMs,
  panelMinimum,
  panelRequest,
  panelWindowOptions,
  panelWindows,
  placePanel,
  requestedBounds,
} from "./panel-windows"

const appUrl = "file:///opt/Novadeck/resources/ui/index.html"

type Frame = { readonly url: string }

/** A window's page as panel windows see it: its frames, its handlers and its throttling. */
class FakeContents extends EventEmitter {
  mainFrame: Frame = { url: appUrl }
  opener: Frame | null = null
  openHandler: ((details: { readonly url: string }) => { action: "deny" }) | undefined
  policy: string | undefined
  readonly throttling: boolean[] = []
  setWindowOpenHandler(handler: (details: { readonly url: string }) => { action: "deny" }): void {
    this.openHandler = handler
  }
  setWebRTCIPHandlingPolicy(policy: string): void {
    this.policy = policy
  }
  setBackgroundThrottling(allowed: boolean): void {
    this.throttling.push(allowed)
  }
  /** Asks to go to `url`, as a link would; whether a listener let it. */
  navigate(): boolean {
    let prevented = false
    this.emit("will-navigate", { preventDefault: () => (prevented = true) })
    return !prevented
  }
}

/** A window as panel windows see it: shown, focused, placed, and closed or destroyed. */
class FakeWindow extends EventEmitter {
  readonly webContents = new FakeContents()
  shown = false
  destroyed = false
  focused = false
  state: "normal" | "minimized" | "maximized" | "full screen" = "normal"
  background: string | undefined
  constructor(public bounds: Rectangle = { x: 100, y: 100, width: 1120, height: 720 }) {
    super()
  }
  show(): void {
    this.shown = true
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.emit("closed")
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  isFocused(): boolean {
    return this.focused
  }
  isMinimized(): boolean {
    return this.state === "minimized"
  }
  isMaximized(): boolean {
    return this.state === "maximized"
  }
  isFullScreen(): boolean {
    return this.state === "full screen"
  }
  getBounds(): Rectangle {
    return this.bounds
  }
  setBounds(bounds: Rectangle): void {
    this.bounds = bounds
  }
  setBackgroundColor(color: string): void {
    this.background = color
  }
  /** Opens a window from `frame`, as `window.open` in it does once the handler allowed it. */
  open(frame: Frame | null = this.webContents.mainFrame): FakeWindow {
    const panel = new FakeWindow({ x: 200, y: 200, width: 360, height: 600 })
    panel.webContents.opener = frame
    this.webContents.emit("did-create-window", panel)
    return panel
  }
  /** Gets or loses the system's focus. */
  focus(focused: boolean): void {
    this.focused = focused
    this.emit(focused ? "focus" : "blur")
  }
}

// How much of `one` lies on `other`.
const shared = (one: Rectangle, other: Rectangle): number =>
  Math.max(0, Math.min(one.x + one.width, other.x + other.width) - Math.max(one.x, other.x)) *
  Math.max(0, Math.min(one.y + one.height, other.y + other.height) - Math.max(one.y, other.y))

/** Displays whose work areas a test sets. */
class FakeScreen extends EventEmitter {
  constructor(public areas: readonly Rectangle[]) {
    super()
  }
  getAllDisplays(): { workArea: Rectangle }[] {
    return this.areas.map((workArea) => ({ workArea }))
  }
  /** The display holding the most of `rect`, or the first, as Electron's nearest. */
  getDisplayMatching(rect: Rectangle): { workArea: Rectangle } {
    const workArea = this.areas.reduce((best, area) =>
      shared(rect, area) > shared(rect, best) ? area : best,
    )
    return { workArea }
  }
}

// The turn after this one, when a window refused as it opened is destroyed.
const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const right = { x: 1920, y: 0, width: 2560, height: 1400 }
const left = { x: -1280, y: 0, width: 1280, height: 984 }

const setup = (areas: readonly Rectangle[] = [primary], appBounds?: Rectangle) => {
  const screen = new FakeScreen(areas)
  const told: boolean[] = []
  const outside: string[] = []
  const panels = panelWindows<FakeWindow>({
    displays: screen,
    ground: () => "#101418",
    zoom: () => 1.5,
    isAppPage: (url) => url === appUrl,
    outside: (url) => void outside.push(url),
    focusChanged: (_window, focused) => void told.push(focused),
  })
  const app = new FakeWindow(appBounds)
  panels.host(app)
  panels.watchFocus(app)
  return { screen, told, outside, panels, app }
}

describe("which window a page's request opens as a panel's", () => {
  it.each(railPanels)("opens a blank window named for %s", (panel) => {
    expect(
      panelRequest({
        url: "about:blank",
        frameName: `novadeck-panel-${panel}`,
        features: "popup,width=400,height=600,left=10,top=20",
      }),
    ).toEqual({ x: 10, y: 20, width: 400, height: 600 })
  })

  it("opens one that names no feature", () => {
    expect(
      panelRequest({ url: "about:blank", frameName: "novadeck-panel-notes", features: "" }),
    ).toEqual({})
  })

  it.each(["popup", "popup=1", "popup=yes", "popup=true", "POPUP=Yes", "popup,", ""])(
    "opens one whose features are %j",
    (features) => {
      expect(
        panelRequest({ url: "about:blank", frameName: "novadeck-panel-notes", features }),
      ).toEqual({})
    },
  )

  it.each([
    "popup,kiosk=yes",
    "popup,alwaysOnTop=yes",
    "alwaysOnTop=1",
    "frame=no",
    "transparent=yes",
    "fullscreen=1",
    "simpleFullscreen=yes",
    "skipTaskbar=yes",
    "closable=no",
    "focusable=no",
    "opacity=0",
    "type=desktop",
    "titleBarStyle=hidden",
    "maxWidth=10",
    "x=10",
    "nodeIntegration=yes",
    "webviewTag=yes",
    "popup=0",
    "popup=no",
    "noopener",
    "width=400px",
    "width=12.5",
    "height=",
    "height",
    "left=1=2",
  ])("opens none whose features name %j", (features) => {
    expect(
      panelRequest({ url: "about:blank", frameName: "novadeck-panel-notes", features }),
    ).toBeUndefined()
  })

  it.each([
    ["Sessions, a view of Terminals and no rail panel", "about:blank", "novadeck-panel-sessions"],
    ["a name of no panel", "about:blank", "novadeck-panel-settings"],
    ["the prefix alone", "about:blank", "novadeck-panel-"],
    ["a name in other letters", "about:blank", "novadeck-panel-Notes"],
    ["a name with more after it", "about:blank", "novadeck-panel-notes2"],
    ["no name", "about:blank", ""],
    ["a web address", "https://example.com/", "novadeck-panel-notes"],
    ["the app's own page", appUrl, "novadeck-panel-notes"],
    ["a blank page with a query", "about:blank?x", "novadeck-panel-notes"],
    ["a srcdoc page", "about:srcdoc", "novadeck-panel-notes"],
  ])("opens none for %s", (_case, url, frameName) => {
    expect(panelRequest({ url, frameName, features: "popup" })).toBeUndefined()
  })
})

describe("the bounds a page's features ask for", () => {
  it("reads the place and size, left and top as the window's corner", () => {
    expect(requestedBounds("popup,width=420,height=640,left=1950,top=40")).toEqual({
      x: 1950,
      y: 40,
      width: 420,
      height: 640,
    })
  })

  it("takes negative places, spaces and any letter case", () => {
    expect(requestedBounds(" Left = -1200 , TOP=-5,width=300")).toEqual({
      x: -1200,
      y: -5,
      width: 300,
    })
  })

  it("refuses features that name anything else, or a bound that isn't a whole number", () => {
    expect(requestedBounds("popup,width=420,alwaysOnTop=1")).toBeUndefined()
    expect(requestedBounds("popup,width=abc")).toBeUndefined()
  })
})

describe("placing a panel window", () => {
  context("when the place asked for is mostly on a display", () => {
    it("keeps it, on a display beside the app's", () => {
      const asked = { x: 2000, y: 100, width: 400, height: 700 }
      expect(placePanel(asked, [primary, right], primary)).toEqual(asked)
    })

    it("keeps it on a display left of the main one, at negative places", () => {
      const asked = { x: -1000, y: 50, width: 380, height: 600 }
      expect(placePanel(asked, [primary, left], primary)).toEqual(asked)
    })

    it("keeps one half over the edge between two displays", () => {
      const asked = { x: 1720, y: 100, width: 400, height: 600 }
      expect(placePanel(asked, [primary, right], primary)).toEqual(asked)
    })

    it("keeps one whose title bar is on one display and most of it on another", () => {
      const above = { x: 0, y: -400, width: 1920, height: 400 }
      const asked = { x: 100, y: -100, width: 400, height: 600 }
      expect(placePanel(asked, [primary, above], primary)).toEqual(asked)
    })

    it("keeps one mostly shown only across displays together", () => {
      // 120×400 of it on the main display, 280×120 on the one beside: neither holds half.
      const upper = { x: 1920, y: 0, width: 1920, height: 520 }
      const asked = { x: 1800, y: 400, width: 400, height: 400 }
      expect(placePanel(asked, [primary, upper], primary)).toEqual(asked)
      expect(placePanel(asked, [primary], primary)).toEqual({
        x: 760,
        y: 320,
        width: 400,
        height: 400,
      })
    })
  })

  context("when it isn't", () => {
    it("centres it on the app's display, at the size asked for, once its display is gone", () => {
      expect(placePanel({ x: 2000, y: 100, width: 400, height: 700 }, [primary], primary)).toEqual({
        x: 760,
        y: 170,
        width: 400,
        height: 700,
      })
    })

    it("centres one mostly off every display", () => {
      expect(placePanel({ x: 1800, y: 900, width: 400, height: 600 }, [primary], primary)).toEqual({
        x: 760,
        y: 220,
        width: 400,
        height: 600,
      })
    })

    it("centres one whose title bar is beside every display, though most of it is on one", () => {
      expect(
        placePanel({ x: 1700, y: -40, width: 400, height: 2000 }, [primary, right], primary),
      ).toEqual({ x: 760, y: 0, width: 400, height: 1040 })
    })

    it("centres one whose title bar is above the display", () => {
      expect(placePanel({ x: 100, y: -40, width: 400, height: 600 }, [primary], primary)).toEqual({
        x: 760,
        y: 220,
        width: 400,
        height: 600,
      })
    })

    it("centres one larger than every display, no larger than the app's", () => {
      expect(
        placePanel({ x: 0, y: 0, width: 5000, height: 3000 }, [primary, right], primary),
      ).toEqual(primary)
    })

    it("centres one that names no place", () => {
      expect(placePanel({ width: 400, height: 600 }, [primary], primary)).toEqual({
        x: 760,
        y: 220,
        width: 400,
        height: 600,
      })
    })
  })

  it("is no larger than the display it stays on", () => {
    expect(
      placePanel({ x: 1920, y: 0, width: 2000, height: 1600 }, [primary, right], primary),
    ).toEqual({ x: 1920, y: 0, width: 2000, height: 1400 })
  })

  it("is no smaller than a panel window's least", () => {
    expect(placePanel({ x: 10, y: 10, width: 50, height: 20 }, [primary], primary)).toEqual({
      x: 10,
      y: 10,
      ...panelMinimum,
    })
  })

  it("takes the default size where none is named", () => {
    expect(placePanel({}, [primary], primary)).toEqual({
      x: 780,
      y: 220,
      width: 360,
      height: 600,
    })
  })
})

describe("a panel window's options", () => {
  const options = panelWindowOptions({ x: 1, y: 2, width: 300, height: 400 }, "#101418", 1.25)

  it("keeps whatever else a feature could set from hiding it, covering others or staying open", () => {
    expect(options).toMatchObject({
      frame: true,
      transparent: false,
      opacity: 1,
      focusable: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      fullscreenable: true,
      simpleFullscreen: false,
      kiosk: false,
      closable: true,
      movable: true,
      resizable: true,
      minimizable: true,
      maximizable: true,
      titleBarStyle: "default",
      useContentSize: false,
      enableLargerThanScreen: false,
    })
    for (const option of ["type", "maxWidth", "maxHeight", "vibrancy", "backgroundMaterial"])
      expect(options, option).toHaveProperty(option, undefined)
  })

  it("gives it none of the app window's powers", () => {
    expect(options.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      zoomFactor: 1.25,
    })
    expect(options.webPreferences).not.toHaveProperty("preload")
    expect(options.webPreferences).not.toHaveProperty("additionalArguments")
  })

  it("opens hidden where it was placed, on the app's ground at its scale, with no menu bar showing", () => {
    expect(options).toMatchObject({
      x: 1,
      y: 2,
      width: 300,
      height: 400,
      minWidth: panelMinimum.width,
      minHeight: panelMinimum.height,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#101418",
      webPreferences: { zoomFactor: 1.25 },
    })
  })
})

describe("panel windows", () => {
  context("when the page asks for a window", () => {
    it("gives a panel's its options, placed on the app window's displays", () => {
      const { panels, app } = setup([primary, right])
      const options = panels.request(app, {
        url: "about:blank",
        frameName: "novadeck-panel-inbox",
        features: "popup,width=420,height=700,left=2100,top=60",
      })
      expect(options).toMatchObject({
        x: 2100,
        y: 60,
        width: 420,
        height: 700,
        show: false,
        backgroundColor: "#101418",
        webPreferences: { webviewTag: false, sandbox: true, zoomFactor: 1.5 },
      })
    })

    it("centres one that names no place on the display the app window is on", () => {
      const { panels, app } = setup([primary, right], { x: 2000, y: 100, width: 1120, height: 720 })
      expect(
        panels.request(app, {
          url: "about:blank",
          frameName: "novadeck-panel-notes",
          features: "popup,width=400,height=600",
        }),
      ).toMatchObject({ x: 3000, y: 400, width: 400, height: 600 })
    })

    it("gives any other nothing", () => {
      const { panels, app } = setup()
      expect(
        panels.request(app, { url: "https://example.com/", frameName: "", features: "" }),
      ).toBeUndefined()
      expect(
        panels.request(app, {
          url: "about:blank",
          frameName: "novadeck-panel-notes",
          features: "popup,kiosk=yes,alwaysOnTop=yes",
        }),
      ).toBeUndefined()
    })
  })

  context("when a window opens", () => {
    it("shows one the app's page opened from its main frame, as a panel window", () => {
      const { panels, app } = setup()
      const panel = app.open()
      expect(panel.shown).toBe(true)
      expect(panels.is(panel)).toBe(true)
      expect(panels.is(app)).toBe(false)
      expect(panels.of(app)).toEqual([panel])
      expect(panels.isPage(panel.webContents)).toBe(true)
      expect(panels.isPage(app.webContents)).toBe(false)
    })

    it("forgets its page once it closes", () => {
      const { panels, app } = setup()
      const panel = app.open()
      panel.destroy()
      expect(panels.isPage(panel.webContents)).toBe(false)
    })

    it("destroys unseen one a frame inside the page opened, once Electron has handed it over", async () => {
      const { panels, app } = setup()
      const panel = app.open({ url: appUrl })
      expect(panel.destroyed).toBe(false)
      expect(panel.webContents.navigate()).toBe(false)
      expect(panel.webContents.openHandler?.({ url: "https://example.com/" })).toEqual({
        action: "deny",
      })
      await nextTurn()
      expect(panel.destroyed).toBe(true)
      expect(panel.shown).toBe(false)
      expect(panels.is(panel)).toBe(false)
      expect(panels.of(app)).toEqual([])
      expect(panels.isPage(panel.webContents)).toBe(false)
      expect(app.webContents.throttling).toEqual([])
    })

    it("destroys nothing a second time, as one closed before its turn came", async () => {
      const { app } = setup()
      const panel = app.open(null)
      let closes = 0
      panel.on("closed", () => (closes += 1))
      panel.destroy()
      await nextTurn()
      expect(closes).toBe(1)
    })

    it("destroys unseen one opened with no opener", async () => {
      const { app } = setup()
      const panel = app.open(null)
      await nextTurn()
      expect(panel.shown).toBe(false)
      expect(panel.destroyed).toBe(true)
    })

    it("destroys unseen one opened while the window shows something other than the app", async () => {
      const { app } = setup()
      app.webContents.mainFrame = { url: "chrome-error://chromewebdata/" }
      const panel = app.open()
      await nextTurn()
      expect(panel.shown).toBe(false)
      expect(panel.destroyed).toBe(true)
    })
  })

  context("while a panel window is open", () => {
    it("keeps it from loading another page", () => {
      const { app } = setup()
      expect(app.open().webContents.navigate()).toBe(false)
    })

    it("opens nothing from it, sending its links where the app window's go", () => {
      const { outside, app } = setup()
      const panel = app.open()
      expect(panel.webContents.openHandler?.({ url: "https://example.com/" })).toEqual({
        action: "deny",
      })
      expect(outside).toEqual(["https://example.com/"])
    })

    it("keeps it as the blank page it opens on commits", () => {
      const { app } = setup()
      const panel = app.open()
      panel.webContents.emit("did-navigate")
      expect(panel.destroyed).toBe(false)
    })

    it("destroys it once it loads again, as on a reload", () => {
      const { panels, app } = setup()
      const panel = app.open()
      panel.webContents.emit("did-navigate")
      panel.webContents.emit("did-navigate")
      expect(panel.destroyed).toBe(true)
      expect(panels.of(app)).toEqual([])
    })

    it("sends no WebRTC traffic past a proxy, as the app window", () => {
      const { app } = setup()
      expect(app.open().webContents.policy).toBe("disable_non_proxied_udp")
    })

    it("keeps the app's page from being throttled until the last one closes", () => {
      const { app } = setup()
      const notes = app.open()
      const inbox = app.open()
      expect(app.webContents.throttling).toEqual([false])
      notes.destroy()
      expect(app.webContents.throttling).toEqual([false])
      inbox.destroy()
      expect(app.webContents.throttling).toEqual([false, true])
      app.open()
      expect(app.webContents.throttling).toEqual([false, true, false])
    })
  })

  context("when the app window's page goes", () => {
    it.each([
      ["the window closes", (app: FakeWindow) => app.destroy()],
      ["its page crashes", (app: FakeWindow) => app.webContents.emit("render-process-gone")],
      ["its page loads again", (app: FakeWindow) => app.webContents.emit("did-navigate")],
    ])("destroys its panel windows as %s", (_case, go) => {
      const { panels, app } = setup()
      const notes = app.open()
      const files = app.open()
      go(app)
      expect([notes.destroyed, files.destroyed]).toEqual([true, true])
      expect(panels.of(app)).toEqual([])
    })

    it("leaves the throttling of a closed window alone", () => {
      const { app } = setup()
      app.open()
      app.destroy()
      expect(app.webContents.throttling).toEqual([false])
    })

    it("leaves another app window's panel windows open", () => {
      const { panels, app } = setup()
      const other = new FakeWindow()
      panels.host(other)
      const theirs = other.open()
      app.open()
      app.destroy()
      expect(theirs.destroyed).toBe(false)
    })
  })

  context("as the focus moves", () => {
    afterEach(() => vi.useRealTimers())
    const settled = (): void => void vi.advanceTimersByTime(focusSettleMs)

    it("tells the page at once as the app window gains it", () => {
      vi.useFakeTimers()
      const { told, app } = setup()
      app.focus(true)
      expect(told).toEqual([true])
    })

    it("tells the page nothing as it moves from the app window to a panel window and back", () => {
      vi.useFakeTimers()
      const { told, app } = setup()
      app.focus(true)
      const panel = app.open()
      app.focus(false)
      panel.focus(true)
      settled()
      panel.focus(false)
      app.focus(true)
      settled()
      expect(told).toEqual([true])
    })

    it("waits afresh for a second blur, so quick switching tells nothing", () => {
      vi.useFakeTimers()
      const { told, app } = setup()
      app.focus(true)
      const panel = app.open()
      app.focus(false)
      vi.advanceTimersByTime(10)
      panel.focus(true)
      vi.advanceTimersByTime(30)
      panel.focus(false)
      vi.advanceTimersByTime(15)
      app.focus(true)
      vi.advanceTimersByTime(focusSettleMs * 2)
      expect(told).toEqual([true])
    })

    it("tells the page once, after it settles, as the person leaves both", () => {
      vi.useFakeTimers()
      const { told, app } = setup()
      app.focus(true)
      const panel = app.open()
      app.focus(false)
      panel.focus(true)
      panel.focus(false)
      expect(told).toEqual([true])
      settled()
      expect(told).toEqual([true, false])
      settled()
      expect(told).toEqual([true, false])
    })

    it("counts a panel window's focus as the app's, with the app window never focused", () => {
      vi.useFakeTimers()
      const { told, app } = setup()
      const panel = app.open()
      panel.focus(true)
      expect(told).toEqual([true])
    })

    it("tells the page as a focused panel window closes with nothing of the app left focused", () => {
      vi.useFakeTimers()
      const { told, app } = setup()
      const panel = app.open()
      panel.focus(true)
      panel.focused = false
      panel.destroy()
      settled()
      expect(told).toEqual([true, false])
    })

    it("tells a page that asks what it is now, whatever it was told", () => {
      vi.useFakeTimers()
      const { told, panels, app } = setup()
      app.focus(true)
      panels.tellFocus(app)
      expect(told).toEqual([true, true])
    })

    it("tells a closed app window nothing", () => {
      vi.useFakeTimers()
      const { told, app } = setup()
      app.open()
      app.destroy()
      settled()
      expect(told).toEqual([])
    })
  })

  context("when a display goes or changes", () => {
    it.each(["display-removed", "display-metrics-changed"])(
      "moves a panel window left off every display back onto the app's (%s)",
      (event) => {
        const { screen, panels, app } = setup([primary, right])
        panels.followDisplays()
        const panel = app.open()
        panel.bounds = { x: 2100, y: 100, width: 400, height: 700 }
        screen.areas = [primary]
        screen.emit(event)
        expect(panel.bounds).toEqual({ x: 760, y: 170, width: 400, height: 700 })
      },
    )

    it("leaves one still on a display where it is", () => {
      const { screen, panels, app } = setup([primary, right])
      panels.followDisplays()
      const panel = app.open()
      const bounds = { x: 300, y: 100, width: 400, height: 700 }
      panel.bounds = bounds
      screen.areas = [primary]
      screen.emit("display-removed")
      expect(panel.bounds).toBe(bounds)
    })

    it.each(["minimized", "maximized", "full screen"] as const)(
      "leaves one %s to the system",
      (state) => {
        const { screen, panels, app } = setup([primary, right])
        panels.followDisplays()
        const panel = app.open()
        const bounds = { x: -32000, y: -32000, width: 400, height: 700 }
        panel.bounds = bounds
        panel.state = state
        screen.emit("display-metrics-changed")
        expect(panel.bounds).toBe(bounds)
      },
    )

    it("shrinks one onto a display that got smaller", () => {
      const { screen, panels, app } = setup()
      panels.followDisplays()
      const panel = app.open()
      panel.bounds = { x: 0, y: 0, width: 400, height: 1000 }
      screen.areas = [{ x: 0, y: 0, width: 1280, height: 760 }]
      screen.emit("display-metrics-changed")
      expect(panel.bounds).toEqual({ x: 0, y: 0, width: 400, height: 760 })
    })
  })
})
