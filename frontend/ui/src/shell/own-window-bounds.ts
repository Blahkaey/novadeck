import { railPanels, type RailPanel } from "@novadeck/core/types"

// Where a panel's window of its own sits and how big it is, as the next one opens: its size,
// and its place on the screens once the person has had one open. Whole numbers of CSS pixels.
export type OwnWindowBounds = {
  readonly width: number
  readonly height: number
  readonly left?: number
  readonly top?: number
}

// A panel's first window of its own: about a sidebar's width, a tall window's height, placed by
// the browser or the desktop app.
export const ownWindowDefault: OwnWindowBounds = { width: 380, height: 640 }

// What every panel's last window of its own was, by panel, as they are kept.
export type KeptBounds = Readonly<Partial<Record<RailPanel, OwnWindowBounds>>>

const whole = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined

// A kept window's bounds, where they make one: a size above nothing, and a place only where it
// names both edges; anything else, as an older or damaged value, is none.
export const boundsOf = (value: unknown): OwnWindowBounds | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const kept = value as Record<string, unknown>
  const width = whole(kept.width)
  const height = whole(kept.height)
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return undefined
  const left = whole(kept.left)
  const top = whole(kept.top)
  return left === undefined || top === undefined ? { width, height } : { width, height, left, top }
}

// Every panel's kept bounds out of what storage held, leaving out what makes none.
export const keptBoundsOf = (value: unknown): KeptBounds => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  const kept = value as Record<string, unknown>
  return Object.fromEntries(
    railPanels.flatMap((panel) => {
      const bounds = boundsOf(kept[panel])
      return bounds ? [[panel, bounds]] : []
    }),
  )
}

// The features `window.open` asks for the window with: a popup, at its place where it has one,
// at its size. The desktop app opens a panel's window only from exactly these: `popup` and
// whole-number bounds, by commas without spaces (SECURITY.md, "Desktop Panel Windows"), so each
// number is rounded here, whatever it was measured or kept as.
const feature = (name: string, value: number): string => `${name}=${Math.round(value)}`

export const ownWindowFeatures = ({ width, height, left, top }: OwnWindowBounds): string =>
  [
    "popup",
    ...(left === undefined || top === undefined
      ? []
      : [feature("left", left), feature("top", top)]),
    feature("width", width),
    feature("height", height),
  ].join(",")

// What a window says of where it is and how big.
export type WindowMeasures = Pick<
  Window,
  "screenX" | "screenY" | "outerWidth" | "outerHeight" | "innerWidth" | "innerHeight"
>

// Which size a host opened the window at, asked for `asked`: a browser takes it for the page's
// (inner), the desktop app for the window's with its frame (outer). Read from the window once it
// is drawn: at the page's size asked for, to a pixel or two a zoomed screen rounds by, the
// inner; otherwise, the desktop app having moved it onto a screen or the person having resized
// it, the outer.
export type SizeBasis = "inner" | "outer"

const near = (one: number, other: number): boolean => Math.abs(one - other) <= 2

export const sizeBasis = (view: WindowMeasures, asked: OwnWindowBounds): SizeBasis =>
  near(view.innerWidth, asked.width) && near(view.innerHeight, asked.height) ? "inner" : "outer"

// The bounds that open the window again as it is now, by the size its host reads.
export const measuredBounds = (view: WindowMeasures, basis: SizeBasis): OwnWindowBounds => ({
  left: Math.round(view.screenX),
  top: Math.round(view.screenY),
  width: Math.round(basis === "inner" ? view.innerWidth : view.outerWidth),
  height: Math.round(basis === "inner" ? view.innerHeight : view.outerHeight),
})

export const sameBounds = (one: OwnWindowBounds, other: OwnWindowBounds): boolean =>
  one.width === other.width &&
  one.height === other.height &&
  one.left === other.left &&
  one.top === other.top
