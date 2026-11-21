// A node may belong to another window than the page's: a panel in a window of its own is drawn
// by the page into that window's document, where the elements made for it are that window's,
// which `instanceof` this window's `Element` or `HTMLElement` doesn't recognise. These ask the
// node itself, so they hold whichever window it belongs to.

const elementNode = 1
const html = "http://www.w3.org/1999/xhtml"

// Whether `value` is an element, of whichever window.
export const isElement = (value: unknown): value is Element =>
  typeof value === "object" && value !== null && (value as Partial<Node>).nodeType === elementNode

// Whether `value` is an HTML element, of whichever window: one that can take the focus.
export const isHTMLElement = (value: unknown): value is HTMLElement =>
  isElement(value) && value.namespaceURI === html

// The window a node is drawn in, whose observers, frames, focus and clipboard are the ones that
// follow it; the page's own while it is in no window's document.
export const viewOf = (node: Node): Window & typeof globalThis =>
  (node.nodeType === node.DOCUMENT_NODE ? (node as Document) : node.ownerDocument)?.defaultView ??
  window

// The clipboard of the window a node is drawn in: a document without the focus can't write to
// its own, so a copy made in a panel's window of its own goes through that window's. Undefined
// where the page may not reach one.
export const clipboardOf = (node: Node): Clipboard | undefined =>
  viewOf(node).navigator.clipboard as Clipboard | undefined
