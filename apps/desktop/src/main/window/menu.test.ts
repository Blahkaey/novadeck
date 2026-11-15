import type { MenuItemConstructorOptions } from "electron"

import { describe, expect, it } from "../../test"
import { linuxMenu, macMenu } from "./menu"

describe("the Linux application menu", () => {
  it("keeps the default menus, Edit, View and Window, by their roles", () => {
    const menu = linuxMenu(() => {})
    expect(menu.map((item) => item.role ?? item.label)).toEqual([
      "File",
      "editMenu",
      "viewMenu",
      "windowMenu",
    ])
  })

  it("quits with Ctrl+Q through the app's own handler, and has no other Quit", () => {
    const quits: string[] = []
    const [file] = linuxMenu(() => void quits.push("quit"))
    const items = file!.submenu as MenuItemConstructorOptions[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: "Quit", accelerator: "CommandOrControl+Q" })
    expect(items[0]!.role).toBeUndefined()
    ;(items[0]!.click as () => void)()
    expect(quits).toEqual(["quit"])
  })
})

describe("the macOS application menu", () => {
  it("keeps the default menus by their roles", () => {
    expect(
      macMenu(
        () => {},
        () => {},
      ).map((item) => item.role),
    ).toEqual(["appMenu", "fileMenu", "editMenu", "viewMenu", "windowMenu", "help"])
  })

  it("offers the tour from Help, then opens the logs folder", () => {
    const opened: string[] = []
    const help = macMenu(
      () => void opened.push("logs"),
      () => void opened.push("tour"),
    ).at(-1)!
    const [tour, logs] = help.submenu as MenuItemConstructorOptions[]
    expect(tour).toMatchObject({ label: "Take the Tour" })
    expect(logs).toMatchObject({ label: "Open Logs Folder" })
    ;(tour!.click as () => void)()
    ;(logs!.click as () => void)()
    expect(opened).toEqual(["tour", "logs"])
  })

  it("leaves the tour out where it isn't offered", () => {
    const help = macMenu(() => {}).at(-1)!
    expect((help.submenu as MenuItemConstructorOptions[]).map((item) => item.label)).toEqual([
      "Open Logs Folder",
    ])
  })
})
