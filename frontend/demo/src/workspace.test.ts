import type { Workspace } from "@novadeck/core/types"

import { describe, expect, it } from "./test"
import { windowFileOf } from "./workspace"

describe("the file a session's project window shows", () => {
  const target = { projectId: "storefront", workspaceSessionId: "initial" }
  // A workspace whose storefront session's project window shows the item at `path`, if any.
  const workspace = (path?: string): Workspace =>
    ({
      activeProjectId: "storefront",
      projects: [
        {
          id: "storefront",
          directory: "~/projects/storefront",
          activeSessionId: "initial",
          history: [
            {
              id: "initial",
              state: {
                roster: {
                  terminals: [],
                  windows: path === undefined ? [] : [{ id: "w", home: "project", itemId: "i" }],
                },
                items: path === undefined ? [] : [{ id: "i", path }],
              },
            },
          ],
        },
      ],
    }) as unknown as Workspace

  it("is named by its path from the project's root, and by its own outside the project's folder", () => {
    expect(windowFileOf(workspace("~/projects/storefront/src/App.tsx"), target)).toEqual({
      projectId: "storefront",
      path: "src/App.tsx",
      at: "~/projects/storefront/src/App.tsx",
      itemId: "i",
    })
    expect(windowFileOf(workspace("~/elsewhere/App.tsx"), target)).toMatchObject({
      path: "~/elsewhere/App.tsx",
      at: "~/elsewhere/App.tsx",
    })
  })

  it("is none while the session has no project window", () => {
    expect(windowFileOf(workspace(), target)).toBeUndefined()
    expect(windowFileOf(undefined, target)).toBeUndefined()
  })
})
