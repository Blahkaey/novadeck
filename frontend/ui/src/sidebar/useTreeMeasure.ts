import { useLayoutEffect, useState } from "react"

import { forgetWidths, fontsOf, noFonts, sameFonts, type Fonts } from "./files-fonts"

// The tree's width and the fonts, which decide how many chips a row has room for; the sidebar is
// resizable, so a ResizeObserver follows the width. Unknown (nothing folds) until measured, and
// while the panel is hidden (a width of zero). Out of a document, as a parked panel is, nothing is
// measured, and the tree keeps what it had for when it shows again. `view` is the window the
// panel is drawn in, the page's or its own, whose observers, frames, fonts and theme it follows.
export const useTreeMeasure = (
  tree: HTMLElement | null,
  view: Window & typeof globalThis,
): { readonly width: number | undefined; readonly fonts: Fonts } => {
  const [width, setWidth] = useState<number | undefined>()
  const [fonts, setFonts] = useState<Fonts>(noFonts)
  useLayoutEffect(() => {
    const element = tree
    if (!element) return undefined
    const measure = (): void => {
      if (!element.isConnected) return
      setWidth(element.clientWidth > 0 ? element.clientWidth : undefined)
      const next = fontsOf(element)
      setFonts((known) => (sameFonts(known, next) ? known : next))
    }
    measure()
    let current = true
    const fontsChanged = (): void => {
      if (!current) return
      forgetWidths()
      // The font strings stay the same when a web font loads, but the widths measured before it
      // did not: a new object folds the chips again.
      setFonts(fontsOf(element))
    }
    // A theme sets its own fonts (a mono sans in phosphor) on the root element. Its style also
    // changes for other reasons, as a view's transition, so the measuring waits for the next
    // frame and runs once however many changes came before it.
    const root = view.document.documentElement
    let frame: number | undefined
    const themed =
      typeof view.MutationObserver === "undefined"
        ? undefined
        : new view.MutationObserver(() => {
            if (!current || frame !== undefined) return
            frame = view.requestAnimationFrame(() => {
              frame = undefined
              if (current) measure()
            })
          })
    themed?.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-scheme", "class", "style"],
    })
    const faces = view.document.fonts
    void faces?.ready.then(fontsChanged)
    faces?.addEventListener?.("loadingdone", fontsChanged)
    const observer =
      typeof view.ResizeObserver === "undefined" ? undefined : new view.ResizeObserver(measure)
    observer?.observe(element)
    return () => {
      current = false
      if (frame !== undefined) view.cancelAnimationFrame(frame)
      themed?.disconnect()
      faces?.removeEventListener?.("loadingdone", fontsChanged)
      observer?.disconnect()
    }
  }, [tree, view])
  return { width, fonts }
}
