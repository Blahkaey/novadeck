import { SidebarPanel } from "./SidebarPanel"

// A note on a panel that is elsewhere: where it is, and a button for each way to it.
export const PanelAwayNote = ({
  text,
  actions,
}: {
  text: string
  actions: readonly { readonly label: string; readonly onClick: () => void }[]
}): React.JSX.Element => (
  <div className="flex flex-col items-start gap-3 px-0.5 pt-2">
    <p className="m-0 text-body leading-5">{text}</p>
    <div className="flex flex-wrap gap-2">
      {actions.map(({ label, onClick }) => (
        <button key={label} type="button" className="button px-2.5" onClick={onClick}>
          {label}
        </button>
      ))}
    </div>
  </div>
)

// What the sidebar shows on a panel that is in a window, on the stage or of its own, as a link
// or Back names it, or as the sidebar opens with every panel in a window: where it is, a way to
// it, and a way to bring it back here.
export const PanelElsewhere = ({
  id,
  title,
  own,
  onShow,
  onReturn,
  onHide,
}: {
  id: string
  // The panel's name.
  title: string
  // Its window is its own, not one on the stage.
  own: boolean
  // Brings its window into view.
  onShow: () => void
  // Closes its window and shows the panel here.
  onReturn: () => void
  onHide: () => void
}): React.JSX.Element => (
  <SidebarPanel id={id} title={title} active onClose={onHide}>
    <PanelAwayNote
      text={`${title} is in ${own ? "its own window" : "a window"}`}
      actions={[
        { label: "Show it", onClick: onShow },
        { label: "Return to sidebar", onClick: onReturn },
      ]}
    />
  </SidebarPanel>
)
