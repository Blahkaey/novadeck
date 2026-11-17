import type { MenuItemConstructorOptions } from "electron"

import type { RemoteState } from "../remote/runner.js"

/** The status and settings entry remain available when the app runs its own runner. */
export const runnerMenu = (options: {
  readonly host?: string
  readonly state: RemoteState
  readonly open: () => void
}): MenuItemConstructorOptions => ({
  label: "Runner",
  submenu: [
    {
      label: options.host
        ? `${options.host} · ${options.state === "connected" ? "Connected" : options.state === "connecting" ? "Connecting…" : "Disconnected"}`
        : "This computer",
      enabled: false,
    },
    { label: "Remote Runner…", click: options.open },
  ],
})

/**
 * The application menu on Linux: Electron's default (File, Edit, View and Window, each by
 * its role) with a Quit of its own. The default Quit, Ctrl+Q, quits without telling the
 * app it was the person who asked, which looks like the quit Electron makes of SIGTERM, a
 * desktop logout's; the app installs an update on the first and not on the second, see
 * ../updates/updater.ts. This Quit keeps the same accelerator and calls `quit`, which marks the quit
 * as the person's. The menu bar is hidden, but its accelerators still work.
 */
export const linuxMenu = (quit: () => void): MenuItemConstructorOptions[] => [
  { label: "File", submenu: [{ label: "Quit", accelerator: "CommandOrControl+Q", click: quit }] },
  { role: "editMenu" },
  { role: "viewMenu" },
  { role: "windowMenu" },
]

/**
 * The application menu on macOS: Electron's default, each menu by its role, with Help
 * holding "Open Logs Folder", which shows the folder a bug report attaches.
 * Elsewhere the menu bar is hidden, so Preferences offers the same.
 */
export const macMenu = (openLogs: () => void): MenuItemConstructorOptions[] => [
  { role: "appMenu" },
  { role: "fileMenu" },
  { role: "editMenu" },
  { role: "viewMenu" },
  { role: "windowMenu" },
  {
    role: "help",
    submenu: [{ label: "Open Logs Folder", click: openLogs }],
  },
]
