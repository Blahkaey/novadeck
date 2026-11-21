import { EnvironmentProvider } from "@ark-ui/react/environment"
import { useCallback, type ReactNode } from "react"
import { createPortal } from "react-dom"

// The document `node` is in, or, while it is in none, the page's own. Each control's menu,
// dialog or tooltip asks as it opens, so it opens in the document its control is in now.
const rootOf = (node: Element): Node => (node.isConnected ? node.getRootNode() : document)

// Renders its children into `node`, an element made for them that whoever shows them puts in
// place and takes away again, in this document or another, without the children mounting anew.
export const PortalInto = ({
  node,
  children,
}: {
  readonly node: Element
  readonly children: ReactNode
}): React.JSX.Element => {
  const root = useCallback(() => rootOf(node), [node])
  return createPortal(<EnvironmentProvider value={root}>{children}</EnvironmentProvider>, node)
}
