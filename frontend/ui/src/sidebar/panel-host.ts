import { createContext, useContext } from "react"

// Where a panel's frame is drawn, as the app tells each panel it draws: in the sidebar, stacked
// with the others there; in a window on the stage, which it fills; or in a window of its own,
// which it fills too. In the sidebar, a panel offers a button that opens it in a window
// (`detach`); on the stage, its count and scope show beside the window's title, drawn into
// `count`, and what its title has beside it after them, drawn into `extra`, both of which the
// window's header holds; in a window of its own, `view`, its header returns it to the sidebar
// (`onReturn`), in place of hiding it.
export type PanelHost =
  | { readonly place: "sidebar"; readonly detach?: (() => void) | undefined }
  | { readonly place: "stage"; readonly count: Element; readonly extra: Element }
  | { readonly place: "window"; readonly view: Window; readonly onReturn: () => void }

// A frame drawn by no panel the app holds, as the sidebar's note on a panel that is in a window,
// is the sidebar's, with nothing to detach.
export const PanelHostContext = createContext<PanelHost>({ place: "sidebar" })

export const usePanelHost = (): PanelHost => useContext(PanelHostContext)

// The window the panel is drawn in: its own, or the page's. A panel's observers, frames and
// listeners on the window come from it, so they follow the panel as it moves between them.
export const usePanelView = (): Window & typeof globalThis => {
  const host = usePanelHost()
  return host.place === "window" ? (host.view as Window & typeof globalThis) : window
}
