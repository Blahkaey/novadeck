import type { Item } from "@novadeck/core/items"
import type { WorkspaceTarget } from "@novadeck/core/types"
import type { ComponentType, ReactNode } from "react"

import { ProjectFile } from "../../kinds/file/ProjectFile"
import { registrationOf } from "../../registry"
import type { ItemStore } from "../../store/item-store"

// The session's project window: the one file the person opened from Files, a file edited
// where it's read (or read-only, saying why), an image, or the secrets gate as its kind draws
// it. It is theirs, so it has no bar to dock back to and no actions of an agent's: only the
// body. Focus leaving the window saves its file's edits at once. A file opened to preview
// what the agents' work merges to is drawn by `Preview` instead, which is given the file as
// the window draws it (`fallback`) to show where it has nothing to preview.
export const ProjectWindow = ({
  itemStore,
  target,
  item,
  Preview,
}: {
  itemStore: ItemStore
  target: WorkspaceTarget
  // Undefined while the backend hasn't reported it: the window shows nothing meanwhile.
  item: Item | undefined
  Preview?: ComponentType<{ readonly fallback: ReactNode }> | undefined
}): React.JSX.Element => {
  const registration = item && registrationOf(item)
  const file =
    item?.kind === "file" ? (
      <ProjectFile item={item} itemStore={itemStore} target={target} actions={undefined} />
    ) : item && registration ? (
      <registration.View item={item} itemStore={itemStore} target={target} actions={undefined} />
    ) : null
  return (
    <div
      className="artifact-window"
      onBlur={(event) => {
        if (item?.kind !== "file" || item.path === null) return
        if (!event.currentTarget.contains(event.relatedTarget))
          itemStore.file(target, item.id, item.path).flush()
      }}
    >
      {Preview ? <Preview fallback={file} /> : file}
    </div>
  )
}
