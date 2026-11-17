import { context, describe, expect, it } from "../test"
import {
  filesShortcutBindings,
  matchesFilesShortcut,
  matchesShortcut,
  type ShortcutInput,
} from "./shortcuts"

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

    it("is Shift+Alt+C, by the letter, or by the key's place where it types no Latin letter", () => {
      expect(matchesFilesShortcut(press({}), copyPath)).toBe(true)
      // Option and Shift on a Mac type Ç.
      expect(matchesFilesShortcut(press({ key: "Ç" }), copyPath)).toBe(true)
      // Dvorak's C sits where QWERTY's I is, and its J where QWERTY's C is.
      expect(matchesFilesShortcut(press({ code: "KeyI" }), copyPath)).toBe(true)
      expect(matchesFilesShortcut(press({ key: "J" }), copyPath)).toBe(false)
    })

    it("is not C with other modifiers, nor another key", () => {
      expect(matchesFilesShortcut(press({ altKey: false }), copyPath)).toBe(false)
      expect(matchesFilesShortcut(press({ shiftKey: false }), copyPath)).toBe(false)
      expect(matchesFilesShortcut(press({ ctrlKey: true }), copyPath)).toBe(false)
      expect(matchesFilesShortcut(press({ metaKey: true }), copyPath)).toBe(false)
      expect(matchesFilesShortcut(press({ key: "V", code: "KeyV" }), copyPath)).toBe(false)
    })

    it("shows as the platform names its keys", () => {
      expect(filesShortcutBindings("other").copyPath.display).toEqual(["Shift", "Alt", "C"])
      expect(filesShortcutBindings("mac").copyPath.display).toEqual(["Shift", "⌥", "C"])
    })
  })

  // A key alone, as a test presses it.
  const key = (keys: Partial<ShortcutInput>): ShortcutInput => ({
    key: "F2",
    code: "F2",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...keys,
  })

  context("Rename", () => {
    it("is F2 alone, on every platform", () => {
      for (const platform of ["mac", "other"] as const) {
        const rename = filesShortcutBindings(platform).rename
        expect(matchesShortcut(key({}), rename)).toBe(true)
        expect(matchesShortcut(key({ shiftKey: true }), rename)).toBe(false)
        expect(rename.display).toEqual(["F2"])
      }
    })
  })

  context("Cut, Copy and Paste", () => {
    const bindings = (platform: "mac" | "other") => {
      const { cut, copy, paste } = filesShortcutBindings(platform)
      return { cut, copy, paste }
    }

    it("are Ctrl with X, C and V, and ⌘ with them on a Mac, by the letter typed", () => {
      for (const [letter, name] of [
        ["X", "cut"],
        ["C", "copy"],
        ["V", "paste"],
      ] as const) {
        const code = `Key${letter}`
        const other = bindings("other")[name]
        const mac = bindings("mac")[name]
        const typed = letter.toLowerCase()
        expect(matchesFilesShortcut(key({ key: typed, code, ctrlKey: true }), other)).toBe(true)
        expect(matchesFilesShortcut(key({ key: typed, code, metaKey: true }), mac)).toBe(true)
        expect(matchesFilesShortcut(key({ key: typed, code, metaKey: true }), other)).toBe(false)
        expect(matchesFilesShortcut(key({ key: typed, code, ctrlKey: true }), mac)).toBe(false)
        expect(
          matchesFilesShortcut(key({ key: typed, code, ctrlKey: true, shiftKey: true }), other),
        ).toBe(false)
        expect([other.display, mac.display]).toEqual([
          ["Ctrl", letter],
          ["⌘", letter],
        ])
      }
    })

    it("are known by the key's place where it types no Latin letter, as on a Russian layout", () => {
      const { copy } = bindings("other")
      expect(matchesFilesShortcut(key({ key: "с", code: "KeyC", ctrlKey: true }), copy)).toBe(true)
    })

    it("follow the letter on a layout of other Latin letters, leaving its place to its letter", () => {
      const { copy, paste } = bindings("mac")
      // Dvorak types j where QWERTY has C, and k where it has V: ⌘K is the workspace's.
      expect(matchesFilesShortcut(key({ key: "j", code: "KeyC", metaKey: true }), copy)).toBe(false)
      expect(matchesFilesShortcut(key({ key: "k", code: "KeyV", metaKey: true }), paste)).toBe(
        false,
      )
      expect(matchesFilesShortcut(key({ key: "c", code: "KeyI", metaKey: true }), copy)).toBe(true)
    })
  })

  context("Delete", () => {
    it("is Delete alone, and ⌘ with a Mac's Delete key, Backspace", () => {
      const other = filesShortcutBindings("other").delete
      const mac = filesShortcutBindings("mac").delete
      expect(matchesShortcut(key({ key: "Delete", code: "Delete" }), other)).toBe(true)
      expect(matchesShortcut(key({ key: "Backspace", code: "Backspace" }), other)).toBe(false)
      expect(
        matchesShortcut(key({ key: "Backspace", code: "Backspace", metaKey: true }), mac),
      ).toBe(true)
      expect(matchesShortcut(key({ key: "Backspace", code: "Backspace" }), mac)).toBe(false)
      expect([other.display, mac.display]).toEqual([["Delete"], ["⌘", "⌫"]])
    })
  })
})
