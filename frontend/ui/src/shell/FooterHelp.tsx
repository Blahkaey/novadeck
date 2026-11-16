import { ContextMenu, type ContextMenuAction } from "@novadeck/toolkit/ContextMenu"
import { CircleHelp } from "lucide-react"

/**
 * The footer's Help button, after the feedback button: an icon alone, a chip like it, pressed
 * while its menu is open. The menu opens above it and lists `items`, which the app gives.
 */
export const FooterHelp = ({
  items,
}: {
  readonly items: readonly ContextMenuAction[]
}): React.JSX.Element => (
  <ContextMenu
    label="Help"
    opensOn="click"
    tooltip="Help"
    items={items}
    trigger={
      <button type="button" className="footer-update cursor-pointer" aria-label="Help">
        <CircleHelp size={12} strokeWidth={1.75} aria-hidden="true" />
      </button>
    }
  />
)
