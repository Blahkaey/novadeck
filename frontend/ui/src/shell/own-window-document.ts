// Dresses a panel's window of its own as the page is: the page's stylesheets in its head, and the
// theme the page's root and body wear on its own, kept in step as the page changes them (a theme
// switched, Vite's styles coming and going while developing). Returns what stops it and takes
// the copies away again.

// The page's stylesheets: its linked sheets and its style elements, in their order.
const sheets = 'link[rel~="stylesheet"], style'

// Puts `source`'s attributes on `copy`, and takes away those it no longer has.
const copyAttributes = (
  source: Element,
  copy: Element,
  wanted: (name: string) => boolean = () => true,
): void => {
  for (const name of copy.getAttributeNames())
    if (wanted(name) && !source.hasAttribute(name)) copy.removeAttribute(name)
  for (const name of source.getAttributeNames()) {
    const value = source.getAttribute(name)!
    if (wanted(name) && copy.getAttribute(name) !== value) copy.setAttribute(name, value)
  }
}

// A sheet's copy as `source` is now: its attributes, a linked sheet's address whole, as the
// window's document has no address of the page's to read one from, and a style's text.
const refresh = (source: Element, copy: Element): void => {
  if (source.localName !== "link") {
    copyAttributes(source, copy)
    if (copy.textContent !== source.textContent) copy.textContent = source.textContent
    return
  }
  copyAttributes(source, copy, (name) => name !== "href")
  const href = (source as HTMLLinkElement).href
  if (copy.getAttribute("href") !== href) copy.setAttribute("href", href)
}

// What the root wears but the app window's frame: where its own controls sit over the page,
// the room they take and whether the window has the system's focus (app/window-controls.ts).
// A panel's window has the system's frame, title bar and all.
const rootAttribute = (name: string): boolean => !name.startsWith("data-window-")

// What the body wears that a theme may style by: its classes and its data attributes, not its
// inline style, which an open dialog of either document sets on its own body.
const bodyAttribute = (name: string): boolean => name === "class" || name.startsWith("data-")

// Names the window, as its title bar and the system's list of windows say.
export const nameOwnWindow = (page: Document, title: string): void => {
  page.title = title
}

export const dressOwnWindow = (owner: Document, page: Document): (() => void) => {
  const copies = new Map<Element, Element>()
  // The copy after `copy` in the window's head, passing over what the window has of its own
  // there, as its title.
  const nextCopy = (copy: Element): Element | null => {
    let next = copy.nextElementSibling
    while (next && ![...copies.values()].includes(next)) next = next.nextElementSibling
    return next
  }
  const syncSheets = (): void => {
    const present = [...owner.head.querySelectorAll(sheets)]
    for (const [source, copy] of copies) {
      if (present.includes(source)) continue
      copy.remove()
      copies.delete(source)
    }
    // From the last, each before the one after it, so the cascade keeps the page's order and a
    // sheet already in place among the copies isn't moved, which would load it again.
    let after: Element | null = null
    for (const source of present.toReversed()) {
      const copy = copies.get(source) ?? page.createElement(source.localName)
      copies.set(source, copy)
      refresh(source, copy)
      if (copy.parentNode !== page.head || nextCopy(copy) !== after)
        page.head.insertBefore(copy, after)
      after = copy
    }
  }
  const syncTheme = (): void => {
    copyAttributes(owner.documentElement, page.documentElement, rootAttribute)
    copyAttributes(owner.body, page.body, bodyAttribute)
  }
  syncSheets()
  syncTheme()
  const view = owner.defaultView ?? window
  const sheetsChanged = new view.MutationObserver(syncSheets)
  sheetsChanged.observe(owner.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  })
  const themeChanged = new view.MutationObserver(syncTheme)
  themeChanged.observe(owner.documentElement, { attributes: true })
  themeChanged.observe(owner.body, { attributes: true })
  return () => {
    sheetsChanged.disconnect()
    themeChanged.disconnect()
    for (const copy of copies.values()) copy.remove()
  }
}
