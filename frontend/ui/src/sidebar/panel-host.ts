import { createContext, useContext } from "react"

// Where a panel's frame is drawn, as the app tells each panel it draws: in the sidebar, stacked
// with the others there, or in a window on the stage, which it fills. In the sidebar, a panel
// that can open in a window offers a button that opens it there (`detach`); in a window, its
// count shows beside the window's title, drawn into `count`, which the window's header holds.
export type PanelHost =
  | { readonly place: "sidebar"; readonly detach?: (() => void) | undefined }
  | { readonly place: "stage"; readonly count: Element }

// A frame drawn by no panel the app holds, as the sidebar's note on a panel that is in a window,
// is the sidebar's, with nothing to detach.
export const PanelHostContext = createContext<PanelHost>({ place: "sidebar" })

export const usePanelHost = (): PanelHost => useContext(PanelHostContext)
