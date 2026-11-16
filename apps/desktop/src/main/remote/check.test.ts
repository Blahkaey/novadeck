import type { FolderBrowse } from "@novadeck/protocol"
import { WireError } from "@novadeck/wire"

import { context, describe, expect, it } from "../../test"
import { remoteFolders } from "./check"

const home: FolderBrowse = {
  path: "/home/ana",
  parent: "/home",
  folders: ["code"],
  truncated: false,
}

/** A runner as the browser uses one: the folders it has, and what it was asked to do. */
const runner = (
  options: {
    folders?: Readonly<Record<string, FolderBrowse>>
    reachable?: () => boolean
    fails?: unknown
  } = {},
) => {
  const { folders = { "/srv/link": { ...home, path: "/srv/app", parent: "/srv" } } } = options
  const did: string[] = []
  return {
    did,
    connect: () => {
      did.push("connect")
      if (options.reachable && !options.reachable())
        return Promise.reject(new WireError("DISCONNECTED", "No runner."))
      return Promise.resolve({
        projects: {
          browse: (input: { path?: string }) => {
            did.push(`browse ${input.path ?? "home"}`)
            if (options.fails) return Promise.reject(options.fails)
            if (input.path === undefined) return Promise.resolve(home)
            const found = folders[input.path]
            return found
              ? Promise.resolve(found)
              : Promise.reject(new WireError("INVALID_DIRECTORY", "No folder has that path."))
          },
          list: () => {
            did.push("list")
            return Promise.resolve([
              { id: "p", name: "Storefront", cwd: "/home/ana/code/storefront", pinned: false },
            ])
          },
        },
        close: () => {
          did.push("close")
          return Promise.resolve()
        },
      })
    },
  }
}

describe("remoteFolders", () => {
  it("looks at folders over one connection, makes nothing, and closes it once done", async () => {
    const { connect, did } = runner()
    const folders = remoteFolders(connect)

    await expect(folders.browse(undefined)).resolves.toEqual(home)
    await expect(folders.browse("/srv/link")).resolves.toMatchObject({ path: "/srv/app" })
    folders.close()
    await Promise.resolve()

    expect(did).toEqual(["connect", "browse home", "browse /srv/link", "close"])
  })

  it("offers the runner's projects as places to start from", async () => {
    const { connect } = runner()
    await expect(remoteFolders(connect).places()).resolves.toEqual([
      { name: "Storefront", path: "/home/ana/code/storefront" },
    ])
  })

  context("when the folder can't be shown", () => {
    it("says why, in the runner's words", async () => {
      const { connect } = runner()
      await expect(remoteFolders(connect).browse("/srv/nowhere")).resolves.toEqual({
        problem: "No folder has that path.",
      })
    })

    it("says the runner is out of reach, and reaches for it again next time", async () => {
      let reachable = false
      const { connect, did } = runner({ reachable: () => reachable })
      const folders = remoteFolders(connect)

      await expect(folders.browse(undefined)).resolves.toEqual({
        problem: "The runner could not be reached to look at that folder.",
      })
      reachable = true
      await expect(folders.browse(undefined)).resolves.toEqual(home)
      expect(did).toEqual(["connect", "connect", "browse home"])
    })

    it("says the runner could not be asked when it fails otherwise", async () => {
      const { connect } = runner({ fails: new WireError("DISCONNECTED", "Lost.") })
      await expect(remoteFolders(connect).browse("/srv/link")).resolves.toEqual({
        problem: "The runner could not be asked about that folder.",
      })
    })
  })
})
