import type { RailPanel } from "@novadeck/core/types"

import type { UiStore } from "./ui-store"

// The part of a window the watch reads.
type PageView = Pick<
  Window,
  "setTimeout" | "clearTimeout" | "addEventListener" | "removeEventListener"
> & {
  readonly document: Pick<
    Document,
    "hasFocus" | "visibilityState" | "addEventListener" | "removeEventListener"
  >
}

// Tells `listener` whether a window of the page has the person's focus, at once and on each
// change: the window focused and its page showing, as a minimized or hidden window's isn't.
// Where the desktop app reports the window's focus (`windowFocus`), that is the window's focus,
// which holds while focus is inside a frame of the page, as a page in the companion pane, and
// ends when the person switches to another app. Without it the window's document says: focus
// moving into a frame blurs it first, so the check waits for that to settle. Returns the stop.
export const watchWindowFocus = (
  view: PageView,
  listener: (focused: boolean) => void,
  windowFocus?: (listener: (focused: boolean) => void) => () => void,
): (() => void) => {
  let settling: number | undefined
  // What the desktop app last said; until it does, the document's own focus.
  let reported: boolean | undefined
  const check = (): void => {
    const focused = reported ?? view.document.hasFocus()
    listener(focused && view.document.visibilityState === "visible")
  }
  const blurred = (): void => {
    view.clearTimeout(settling)
    settling = view.setTimeout(check, 0)
  }
  const stopWindowFocus = windowFocus?.((focused) => {
    reported = focused
    check()
  })
  check()
  if (!windowFocus) {
    view.addEventListener("focus", check)
    view.addEventListener("blur", blurred)
  }
  view.document.addEventListener("visibilitychange", check)
  return () => {
    stopWindowFocus?.()
    view.clearTimeout(settling)
    view.removeEventListener("focus", check)
    view.removeEventListener("blur", blurred)
    view.document.removeEventListener("visibilitychange", check)
  }
}

// Keeps the UI store's `ownWindowFocused` on `panel` while `view`, its window of its own, has the
// person's focus (`watchWindowFocus`), until the window goes. Returns the stop.
export const watchOwnWindowFocus = (
  ui: UiStore,
  panel: RailPanel,
  view: PageView,
): (() => void) => {
  const set = (focused: boolean): void => {
    ui.update((state) => {
      const next = focused
        ? panel
        : state.ownWindowFocused === panel
          ? null
          : state.ownWindowFocused
      return next === state.ownWindowFocused ? state : { ...state, ownWindowFocused: next }
    })
  }
  const stop = watchWindowFocus(view, set)
  return () => {
    stop()
    set(false)
  }
}

// Keeps the UI store's `pageFocused` true while the page's own window has the person's focus
// (`watchWindowFocus`). Returns the stop.
export const watchPageFocus = (
  ui: UiStore,
  view: PageView,
  windowFocus?: (listener: (focused: boolean) => void) => () => void,
): (() => void) =>
  watchWindowFocus(
    view,
    (pageFocused) =>
      ui.update((state) => (state.pageFocused === pageFocused ? state : { ...state, pageFocused })),
    windowFocus,
  )
