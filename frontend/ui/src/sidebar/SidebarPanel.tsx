import { PortalInto } from "@novadeck/toolkit/PortalInto"
import { Tooltip } from "@novadeck/toolkit/Tooltip"
import { AppWindow, X } from "lucide-react"
import type { ReactNode } from "react"

import { usePanelHost } from "./panel-host"

// A panel's create button: a button set flush left across the panel.
export const sidebarCreateClasses =
  "button sidebar-create w-full shrink-0 justify-start px-2.5 text-left"

export const SidebarPanel = ({
  id,
  title,
  titleHint,
  titleLead,
  titleExtra,
  count,
  scope,
  active,
  onClose,
  actions,
  children,
}: {
  id: string
  title: string
  titleHint?: string
  // Before the title, where panels that share a header's place keep it still: the switch
  // between the Terminals panel's views.
  titleLead?: ReactNode
  // Beside the title, such as a pill that says something waits.
  titleExtra?: ReactNode
  // How many, or an element that says it; an element that renders nothing hides it.
  count?: ReactNode
  // What the list is of, where the heading alone can't say: the open session over its terminals.
  scope?: string | undefined
  active: boolean
  onClose: () => void
  // Quiet buttons beside the close button.
  actions?: ReactNode
  children: ReactNode
}): React.JSX.Element => {
  const host = usePanelHost()
  // In a window on the stage, which it fills, always in sight while the window is, with no Hide:
  // the window's header names it, shows its count and returns it to the sidebar. Its heading
  // stays for assistive technology, by the same ids, out of its own row, which shows only its
  // actions, and only while it has any. Both places draw the same elements in the same order,
  // so moving between them keeps what the person had in the panel.
  const stage = host.place === "stage" ? host : undefined
  const heading = (
    <Tooltip content={titleHint} disabled={!titleHint}>
      <h2
        id={`${id}-title`}
        tabIndex={titleHint ? 0 : -1}
        className="section-label m-0 flex min-w-0 items-center gap-1.5 text-label font-medium"
      >
        {title}
        {count !== undefined && <span className="sidebar-panel-count">{count}</span>}
        {scope && <span className="sidebar-panel-scope min-w-0 truncate">{scope}</span>}
      </h2>
    </Tooltip>
  )
  return (
    <section
      id={id}
      className={
        stage
          ? "sidebar-panel relative flex min-h-0 min-w-0 flex-1 flex-col px-3 pt-1"
          : "sidebar-panel absolute inset-x-3 top-3 bottom-0 flex min-h-0 min-w-0 flex-col opacity-100 visible [transform:translateX(0)] data-[active=false]:pointer-events-none data-[active=false]:invisible data-[active=false]:[transform:translateX(-6px)] data-[active=false]:opacity-0"
      }
      {...(stage
        ? { "data-place": "stage" }
        : { "data-active": active, "aria-hidden": !active, inert: !active })}
      aria-labelledby={`${id}-title`}
    >
      {stage ? (
        <h2 id={`${id}-title`} className="sr-only" tabIndex={-1}>
          {title} {count}
        </h2>
      ) : null}
      <header
        className="sidebar-panel-header flex h-[38px] shrink-0 items-center justify-between gap-3 px-0.5"
        hidden={stage && !actions}
      >
        {stage ? null : titleExtra || titleLead ? (
          <div className="flex min-w-0 items-center gap-2">
            {titleLead}
            {heading}
            {titleExtra}
          </div>
        ) : (
          heading
        )}
        <div className="sidebar-panel-actions ml-auto flex shrink-0 items-center gap-0.5">
          {actions}
          {host.place === "sidebar" && host.detach && (
            <Tooltip content="Open in a window">
              <button
                className="icon-button dim sidebar-detach size-7"
                type="button"
                aria-label={`Open ${title} in a window`}
                onClick={host.detach}
              >
                <AppWindow size={14} strokeWidth={1.6} />
              </button>
            </Tooltip>
          )}
          {host.place === "sidebar" && (
            <Tooltip content="Hide">
              <button
                className="icon-button dim sidebar-close size-7"
                type="button"
                aria-label={`Hide ${title.toLowerCase()}`}
                onClick={onClose}
              >
                <X size={14} strokeWidth={1.6} />
              </button>
            </Tooltip>
          )}
        </div>
      </header>
      <div className="sidebar-panel-content flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {stage ? <PortalInto node={stage.count}>{count}</PortalInto> : null}
    </section>
  )
}
