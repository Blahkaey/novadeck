import { WireError } from "@novadeck/wire"

import { context, describe, expect, it } from "../../test"
import { checkRemoteFolder } from "./check"

/** A runner as the check uses one: the folders it has, and what it was asked to do. */
const runner = (
  options: { folders?: Readonly<Record<string, string>>; removes?: boolean } = {},
) => {
  const { folders = { "/srv/link": "/srv/app" }, removes = true } = options
  const did: string[] = []
  const projects = new Set<string>()
  return {
    did,
    projects,
    connect: () =>
      Promise.resolve({
        projects: {
          create: (input: { id: string; name: string; cwd?: string }) => {
            did.push(`create ${input.cwd}`)
            const cwd = folders[input.cwd ?? ""]
            if (!cwd)
              return Promise.reject(
                new WireError("INVALID_DIRECTORY", "Project directory does not exist"),
              )
            projects.add(input.id)
            return Promise.resolve({ id: input.id, name: input.name, cwd, pinned: false })
          },
          remove: (input: { projectId: string }) => {
            did.push("remove")
            if (!removes) return Promise.reject(new WireError("DISCONNECTED", "Lost."))
            projects.delete(input.projectId)
            return Promise.resolve()
          },
        },
        close: () => {
          did.push("close")
          return Promise.resolve()
        },
      }),
  }
}

describe("checkRemoteFolder", () => {
  it("answers a folder's real path on the runner's machine, and leaves no project there", async () => {
    const { connect, did, projects } = runner()
    await expect(checkRemoteFolder("/srv/link", connect)).resolves.toEqual({ path: "/srv/app" })
    expect(did).toEqual(["create /srv/link", "remove", "close"])
    expect(projects.size).toBe(0)
  })

  context("when the folder can't be opened", () => {
    it("says the runner has no such folder", async () => {
      const { connect, did } = runner()
      await expect(checkRemoteFolder("/srv/nowhere", connect)).resolves.toEqual({
        problem: "No folder has that full path on the runner's machine.",
      })
      expect(did).toEqual(["create /srv/nowhere", "close"])
    })

    it("says the runner is out of reach", async () => {
      const unreachable = () => Promise.reject(new WireError("DISCONNECTED", "No runner."))
      await expect(checkRemoteFolder("/srv/app", unreachable)).resolves.toEqual({
        problem: "The runner could not be reached to check that folder.",
      })
    })

    it("tries once more to remove what it made when the runner stops answering", async () => {
      const { connect, did } = runner({ removes: false })
      await expect(checkRemoteFolder("/srv/link", connect)).resolves.toEqual({
        problem: "The runner could not be asked about that folder.",
      })
      expect(did).toEqual(["create /srv/link", "remove", "remove", "close"])
    })
  })
})
