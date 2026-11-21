import { useEnvironmentContext } from "@ark-ui/react/environment"
import { useEffect, useEffectEvent } from "react"

// Closes what is open in another window of the page, as a panel's window of its own, as that
// window goes: what was drawn in it moves back to the page with the panel, and a dialog or menu
// that came along would stand open there without holding focus, over the page. The page's own
// window going takes everything with it.
export const useClosesWithItsWindow = (open: boolean, close: () => void): void => {
  const environment = useEnvironmentContext()
  const closeNow = useEffectEvent(close)
  useEffect(() => {
    if (!open) return
    const view = environment.getWindow()
    if (view === window) return
    view.addEventListener("pagehide", closeNow)
    return () => view.removeEventListener("pagehide", closeNow)
  }, [open, environment])
}
