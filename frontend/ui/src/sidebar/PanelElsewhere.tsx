import { SidebarPanel } from "./SidebarPanel"

// What the sidebar shows on a panel that is in a window on the stage, as a link or Back names
// it, or as the sidebar opens with every panel in a window: where it is, a way to it, and a way
// to bring it back here.
export const PanelElsewhere = ({
  id,
  title,
  onShow,
  onReturn,
  onHide,
}: {
  id: string
  // The panel's name.
  title: string
  // Brings its window into view.
  onShow: () => void
  // Closes its window and shows the panel here.
  onReturn: () => void
  onHide: () => void
}): React.JSX.Element => (
  <SidebarPanel id={id} title={title} active onClose={onHide}>
    <div className="flex flex-col items-start gap-3 px-0.5 pt-2">
      <p className="m-0 text-body leading-5">{title} is in a window</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="button px-2.5" onClick={onShow}>
          Show it
        </button>
        <button type="button" className="button px-2.5" onClick={onReturn}>
          Return to sidebar
        </button>
      </div>
    </div>
  </SidebarPanel>
)
