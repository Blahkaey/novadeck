// Sidebar panels the app's page shows in windows of their own: which requests open one,
// where it goes, and how it lives and dies with the window that opened it. The page opens
// a panel's window itself (`window.open("", "novadeck-panel-<panel>", "popup,…")`) and fills
// that blank document from its own; the panel window runs nothing of its own.
import { railPanels } from "@novadeck/core/types"
import type { BrowserWindowConstructorOptions, Rectangle } from "electron"

/** The start of a panel window's name; the rest is the panel's, as `novadeck-panel-notes`. */
export const panelFramePrefix = "novadeck-panel-"

/** The smallest a panel window gets, whatever size the page asks for. */
export const panelMinimum = { width: 280, height: 240 } as const
/** A panel window's size where the page names none. */
export const panelDefault = { width: 360, height: 600 } as const

/** The bounds the page asks for, each where it names one. */
export type RequestedBounds = {
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

const boundKeys: Readonly<Record<string, keyof RequestedBounds>> = {
  left: "x",
  top: "y",
  width: "width",
  height: "height",
}
// How a page writes `popup`: bare, or with a value Electron reads as true.
const popupValues: ReadonlySet<string> = new Set(["1", "yes", "true"])

/**
 * The bounds a `window.open` features string names (`left`, `top`, `width`, `height`, as the
 * window's outer bounds, each a whole number), or undefined where it names anything else but
 * `popup`. Electron makes a window's options of every feature it is given, so one such as
 * `frame`, `kiosk` or `alwaysOnTop` would set the native window's.
 */
export const requestedBounds = (features: string): RequestedBounds | undefined => {
  const bounds: { -readonly [Key in keyof RequestedBounds]: number } = {}
  for (const feature of features.split(",")) {
    const [name = "", value, ...more] = feature.split("=").map((part) => part.trim())
    const key = name.toLowerCase()
    // Nothing between two commas, as an empty features string is.
    if (key === "" && value === undefined) continue
    if (more.length > 0) return undefined
    if (key === "popup") {
      if (value === undefined || popupValues.has(value.toLowerCase())) continue
      return undefined
    }
    const bound = boundKeys[key]
    if (bound === undefined || value === undefined || !/^-?\d+$/.test(value)) return undefined
    bounds[bound] = Number(value)
  }
  return bounds
}

/**
 * The bounds a window the page asks for names, when it is a panel's: a blank one, named for a
 * panel of the rail, whose features name only its place and size (see `requestedBounds`).
 * Undefined for anything else: a web address, another name, or another feature.
 */
export const panelRequest = ({
  url,
  frameName,
  features,
}: {
  readonly url: string
  readonly frameName: string
  readonly features: string
}): RequestedBounds | undefined =>
  url === "about:blank" && railPanels.some((panel) => `${panelFramePrefix}${panel}` === frameName)
    ? requestedBounds(features)
    : undefined

// How far `one` and `other` overlap across, and down.
const across = (one: Rectangle, other: Rectangle): number =>
  Math.max(0, Math.min(one.x + one.width, other.x + other.width) - Math.max(one.x, other.x))
const down = (one: Rectangle, other: Rectangle): number =>
  Math.max(0, Math.min(one.y + one.height, other.y + other.height) - Math.max(one.y, other.y))

// Whether `bounds`' top edge, its title bar, lies on some of `area`.
const titleOn = (bounds: Rectangle, area: Rectangle): boolean =>
  bounds.y >= area.y && bounds.y < area.y + area.height && across(bounds, area) > 0

// Whether at least half of `bounds` lies on the work areas, together.
const mostlyShown = (bounds: Rectangle, areas: readonly Rectangle[]): boolean =>
  areas.reduce((sum, area) => sum + across(bounds, area) * down(bounds, area), 0) * 2 >=
  bounds.width * bounds.height

type Size = { readonly width: number; readonly height: number }

// A size no smaller than a panel window's least and no larger than `room`.
const fitted = (size: Size, room: Size): { width: number; height: number } => ({
  width: Math.min(Math.max(size.width, panelMinimum.width), room.width),
  height: Math.min(Math.max(size.height, panelMinimum.height), room.height),
})

/**
 * Where a panel window goes, given the bounds asked for, the work areas of the displays
 * there are, and `home`, the work area of the display the opening window is on. It keeps
 * the place asked for when at least half of the window lies on the work areas, together,
 * and its top edge on one of them, so its title bar can be reached, as across the edge
 * between two displays; otherwise, as when the display it was on is gone or no place is
 * named, it is centred on `home`. Its size is the one asked for (or `panelDefault`), no
 * smaller than `panelMinimum`, and no wider or taller than the widest and tallest of the work
 * areas it lies on, or than `home`.
 */
export const placePanel = (
  requested: RequestedBounds,
  areas: readonly Rectangle[],
  home: Rectangle,
): Rectangle => {
  const size = {
    width: Math.max(requested.width ?? panelDefault.width, panelMinimum.width),
    height: Math.max(requested.height ?? panelDefault.height, panelMinimum.height),
  }
  const { x, y } = requested
  if (x !== undefined && y !== undefined) {
    const bounds = { x, y, ...size }
    const shown = areas.filter((area) => across(bounds, area) * down(bounds, area) > 0)
    if (shown.some((area) => titleOn(bounds, area)) && mostlyShown(bounds, shown)) {
      const room = {
        width: Math.max(...shown.map((area) => area.width)),
        height: Math.max(...shown.map((area) => area.height)),
      }
      return { x, y, ...fitted(size, room) }
    }
  }
  const { width, height } = fitted(size, home)
  return {
    x: home.x + Math.round((home.width - width) / 2),
    y: home.y + Math.round((home.height - height) / 2),
    width,
    height,
  }
}

// No largest size and no kind of window, as a feature could have named: the type of
// Electron's options has no room for one set to nothing.
const unset = {
  maxWidth: undefined,
  maxHeight: undefined,
  type: undefined,
  vibrancy: undefined,
  backgroundMaterial: undefined,
} as unknown as BrowserWindowConstructorOptions

/**
 * A panel window's options: at `bounds`, on the app's `ground` until the page paints, with
 * no menu bar showing, hidden until its opener is checked (see `panelWindows`), and with
 * none of its opener's powers: no preload, no Node, a sandbox and no page views. Electron
 * takes these over what the page's features name and what the opener's preferences hand
 * on. The page's features name only the place and size (see `panelRequest`); should another
 * get past that, every option that could hide the window, cover others or keep the person
 * from closing it is set here too: framed, opaque, focusable, in the taskbar, not on top,
 * and free to move, resize, minimize, maximize, close and go full screen.
 */
export const panelWindowOptions = (
  bounds: Rectangle,
  ground: string,
): BrowserWindowConstructorOptions => ({
  ...unset,
  ...bounds,
  useContentSize: false,
  minWidth: panelMinimum.width,
  minHeight: panelMinimum.height,
  show: false,
  frame: true,
  transparent: false,
  opacity: 1,
  hasShadow: true,
  thickFrame: true,
  titleBarStyle: "default",
  focusable: true,
  alwaysOnTop: false,
  skipTaskbar: false,
  // Not `fullscreen: false`, which hides macOS's full-screen button: free to go full screen,
  // as the person chooses, but never opened so.
  fullscreenable: true,
  simpleFullscreen: false,
  kiosk: false,
  enableLargerThanScreen: false,
  hiddenInMissionControl: false,
  closable: true,
  movable: true,
  resizable: true,
  minimizable: true,
  maximizable: true,
  autoHideMenuBar: true,
  backgroundColor: ground,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  },
})

/** A frame of a page, as Electron's `WebFrameMain`: which one it is, and what it shows. */
type Frame = { readonly url: string }

/**
 * What this module needs of a window, the app's or a panel's: Electron's `BrowserWindow`,
 * or a test's.
 */
export type PanelHost = {
  readonly webContents: {
    readonly mainFrame: Frame
    readonly opener: Frame | null
    on(event: "did-create-window", listener: (window: PanelHost) => void): unknown
    on(event: "will-navigate", listener: (event: { preventDefault(): void }) => void): unknown
    on(event: "did-navigate" | "render-process-gone", listener: () => void): unknown
    once(event: "did-navigate", listener: () => void): unknown
    setWindowOpenHandler(handler: (details: { readonly url: string }) => { action: "deny" }): void
    setWebRTCIPHandlingPolicy(policy: "disable_non_proxied_udp"): void
    setBackgroundThrottling(allowed: boolean): void
  }
  on(event: "closed" | "focus" | "blur", listener: () => void): unknown
  show(): void
  destroy(): void
  isDestroyed(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  isMaximized(): boolean
  isFullScreen(): boolean
  getBounds(): Rectangle
  setBounds(bounds: Rectangle): void
  setBackgroundColor(color: string): void
}

/** The displays there are, as Electron's `screen` tells them. */
type Displays = {
  getAllDisplays(): readonly { readonly workArea: Rectangle }[]
  getDisplayMatching(rect: Rectangle): { readonly workArea: Rectangle }
  on(event: "display-removed" | "display-metrics-changed", listener: () => void): unknown
}

const sameBounds = (one: Rectangle, other: Rectangle): boolean =>
  one.x === other.x && one.y === other.y && one.width === other.width && one.height === other.height

/**
 * How long a window losing the system's focus waits before it counts: the focus moving
 * between an app window and its panel window arrives as the one's blur, then the other's
 * focus, which the system may deliver as separate events, a turn or more apart, so
 * `setImmediate` can fall between them. Fifty milliseconds outlasts that gap and is too
 * short for the person to notice a notification or a toast that waited on it.
 */
export const focusSettleMs = 50

/**
 * The panel windows of the app's windows. An app window `host`s them: its open handler asks
 * `request` for a panel window's options, and each window it opens is checked and tracked.
 * The open handler isn't told which frame asked, so a panel window opens hidden and shows
 * only when the main frame of its opener, showing the app's page (`isAppPage`), opened it;
 * any other loads and opens nothing, and is destroyed unseen.
 *
 * A panel window loads nothing and opens nothing: a link in it goes to `outside`, as the app
 * window's do, and a window that loads again, as on a reload, is destroyed, its page gone.
 * The panel in it is the opener's page, so it goes when that page does, as the opener closes,
 * crashes or loads again; and while any is open the opener's page isn't throttled in the
 * background, so the panel stays live while the app's window is minimized or hidden.
 *
 * `focusChanged` hears whether an app window or one of its panel windows has the system's
 * focus, as that changes (see `watchFocus`).
 */
export const panelWindows = <Window extends PanelHost>({
  displays,
  ground,
  isAppPage,
  outside,
  focusChanged,
}: {
  readonly displays: Displays
  readonly ground: () => string
  readonly isAppPage: (url: string) => boolean
  readonly outside: (url: string) => void
  readonly focusChanged: (opener: Window, focused: boolean) => void
}) => {
  const openers = new Map<Window, Set<PanelHost>>()
  const panels = new WeakSet<PanelHost>()
  const pages = new WeakSet<object>()

  const of = (opener: Window): readonly PanelHost[] => [...(openers.get(opener) ?? [])]
  const focused = (opener: Window): boolean =>
    opener.isFocused() || of(opener).some((panel) => panel.isFocused())

  // What each app window's page was last told of its focus, and a blur waiting to count.
  const told = new WeakMap<Window, boolean>()
  const settling = new WeakMap<Window, ReturnType<typeof setTimeout>>()
  const tellFocus = (opener: Window): void => {
    if (opener.isDestroyed()) return
    const now = focused(opener)
    told.set(opener, now)
    focusChanged(opener, now)
  }
  const tellChange = (opener: Window): void => {
    if (opener.isDestroyed() || told.get(opener) === focused(opener)) return
    tellFocus(opener)
  }
  // A blur while one waits waits afresh, so switching back and forth quickly tells nothing.
  const blurred = (opener: Window): void => {
    clearTimeout(settling.get(opener))
    settling.set(
      opener,
      setTimeout(() => {
        settling.delete(opener)
        tellChange(opener)
      }, focusSettleMs),
    )
  }

  const workAreas = (): Rectangle[] => displays.getAllDisplays().map((display) => display.workArea)
  const home = (opener: Window): Rectangle =>
    displays.getDisplayMatching(opener.getBounds()).workArea

  const adopt = (opener: Window, panel: PanelHost): void => {
    const contents = panel.webContents
    const frame = contents.opener
    if (frame !== opener.webContents.mainFrame || !isAppPage(frame.url)) {
      contents.setWindowOpenHandler(() => ({ action: "deny" }))
      contents.on("will-navigate", (event) => event.preventDefault())
      // Electron crashes on a window destroyed while it hands it over.
      setImmediate(() => {
        if (!panel.isDestroyed()) panel.destroy()
      })
      return
    }
    panels.add(panel)
    pages.add(contents)
    const open = openers.get(opener) ?? new Set()
    if (open.size === 0) opener.webContents.setBackgroundThrottling(false)
    openers.set(opener, open.add(panel))

    contents.setWindowOpenHandler(({ url }) => {
      outside(url)
      return { action: "deny" }
    })
    contents.on("will-navigate", (event) => event.preventDefault())
    // Its first page is the blank one it opens on; any after is the page loading again.
    contents.once("did-navigate", () => contents.on("did-navigate", () => panel.destroy()))
    // As the app window's: a frame a panel holds, as a PDF's, sends no UDP past a proxy.
    contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")
    panel.on("focus", () => tellChange(opener))
    panel.on("blur", () => blurred(opener))
    panel.on("closed", () => {
      pages.delete(contents)
      open.delete(panel)
      if (open.size === 0) {
        openers.delete(opener)
        if (!opener.isDestroyed()) opener.webContents.setBackgroundThrottling(true)
      }
      // The system may move the focus on without telling the closing window it lost it.
      blurred(opener)
    })
    panel.show()
  }

  // Moves each open panel window left off every display back onto one. One minimized,
  // maximized or in full screen is the system's to place, and its bounds aren't its own.
  const keepOnDisplays = (): void => {
    const areas = workAreas()
    for (const [opener, open] of openers) {
      for (const panel of open) {
        if (panel.isMinimized() || panel.isMaximized() || panel.isFullScreen()) continue
        const bounds = panel.getBounds()
        const placed = placePanel(bounds, areas, home(opener))
        if (!sameBounds(bounds, placed)) panel.setBounds(placed)
      }
    }
  }

  // The opener's page is gone, and with it what its panel windows showed.
  const closeAll = (opener: Window): void => {
    for (const panel of of(opener)) panel.destroy()
  }

  return {
    /** Whether `window` is a panel window, which is no app window. */
    is: (window: PanelHost): boolean => panels.has(window),
    /** Whether `contents` is an open panel window's page. */
    isPage: (contents: object): boolean => pages.has(contents),
    /** The panel windows `opener` has open. */
    of,
    /**
     * The options of the window `opener`'s page asks for, when it is a panel's (see
     * `panelRequest`), placed by `placePanel`; undefined for any other.
     */
    request: (
      opener: Window,
      details: { readonly url: string; readonly frameName: string; readonly features: string },
    ): BrowserWindowConstructorOptions | undefined => {
      const requested = panelRequest(details)
      if (!requested) return undefined
      return panelWindowOptions(placePanel(requested, workAreas(), home(opener)), ground())
    },
    /** Tracks the windows an app window opens, and closes them with its page. */
    host: (opener: Window): void => {
      opener.webContents.on("did-create-window", (panel) => adopt(opener, panel))
      opener.on("closed", () => closeAll(opener))
      opener.webContents.on("render-process-gone", () => closeAll(opener))
      opener.webContents.on("did-navigate", () => closeAll(opener))
    },
    /**
     * Tells an app window's page of its focus as it changes: at once as it or one of its
     * panel windows gains it, and `focusSettleMs` after one loses it, only if neither has it
     * then, so the focus moving between them tells nothing.
     */
    watchFocus: (opener: Window): void => {
      opener.on("focus", () => tellChange(opener))
      opener.on("blur", () => blurred(opener))
    },
    /** Tells an app window's page of its focus now, as it asks when it starts listening. */
    tellFocus,
    /** Moves each open panel window back onto a display, as one goes or changes. */
    followDisplays: (): void => {
      displays.on("display-removed", keepOnDisplays)
      displays.on("display-metrics-changed", keepOnDisplays)
    },
  }
}

/** The panel windows of the app's windows; see `panelWindows`. */
export type PanelWindows<Window extends PanelHost> = ReturnType<typeof panelWindows<Window>>
