import { context, describe, expect, it } from "../test"
import { filesShortcutBindings, matchesShortcut, type ShortcutInput } from "./shortcuts"

// Shift+Alt and a key, as a test presses it.
const press = (keys: Partial<ShortcutInput>): ShortcutInput => ({
  key: "C",
  code: "KeyC",
  ctrlKey: false,
  metaKey: false,
  shiftKey: true,
  altKey: true,
  ...keys,
})

describe("the Files panel's keys", () => {
  context("Copy Path", () => {
    const copyPath = filesShortcutBindings("other").copyPath

    it("is Shift+Alt+C, by the letter or by the key's place", () => {
      expect(matchesShortcut(press({}), copyPath)).toBe(true)
      // Option and Shift on a Mac type Ç.
      expect(matchesShortcut(press({ key: "Ç" }), copyPath)).toBe(true)
      // Dvorak's C sits where QWERTY's I is.
      expect(matchesShortcut(press({ code: "KeyI" }), copyPath)).toBe(true)
    })

    it("is not C with other modifiers, nor another key", () => {
      expect(matchesShortcut(press({ altKey: false }), copyPath)).toBe(false)
      expect(matchesShortcut(press({ shiftKey: false }), copyPath)).toBe(false)
      expect(matchesShortcut(press({ ctrlKey: true }), copyPath)).toBe(false)
      expect(matchesShortcut(press({ metaKey: true }), copyPath)).toBe(false)
      expect(matchesShortcut(press({ key: "V", code: "KeyV" }), copyPath)).toBe(false)
    })

    it("shows as the platform names its keys", () => {
      expect(filesShortcutBindings("other").copyPath.display).toEqual(["Shift", "Alt", "C"])
      expect(filesShortcutBindings("mac").copyPath.display).toEqual(["Shift", "⌥", "C"])
    })
  })
})
