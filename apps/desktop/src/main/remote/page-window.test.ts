import type { BrowserWindow } from "electron"

import { describe, expect, it } from "../../test"
import { addressOf, answerAt, escaped, page, pageAddress, pageWindowOptions } from "./page-window"

describe("escaped", () => {
  it("shows markup and quotes as text, in an element or an attribute", () => {
    expect(escaped(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    )
  })
})

describe("addressOf", () => {
  it("percent-encodes what it carries, so no character of it ends the address or its attribute", () => {
    const address = addressOf("https://x.invalid", "/browse", { path: `/a b/"<'>&#?%` })
    expect(address).not.toMatch(/[ "<>'#]/)
    expect(new URL(address).searchParams.get("path")).toBe(`/a b/"<'>&#?%`)
    expect(addressOf("https://x.invalid", "/cancelled")).toBe("https://x.invalid/cancelled")
  })
})

describe("answerAt", () => {
  it("reads an address of the window's own, and nothing else", () => {
    expect(answerAt("https://x.invalid", "https://x.invalid/open?path=%2F")?.pathname).toBe("/open")
    expect(answerAt("https://x.invalid", "https://x.invalid.example/open")).toBeUndefined()
    expect(answerAt("https://x.invalid", "not an address")).toBeUndefined()
  })
})

describe("page", () => {
  it("runs no script and loads nothing, whatever it shows", () => {
    const shown = page("<Title>", "", "<p>Hello</p>")
    expect(shown).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`)
    expect(shown).toContain("<title>&lt;Title&gt;</title>")
    expect(
      decodeURIComponent(pageAddress(shown).replace(/^data:text\/html;charset=utf-8,/, "")),
    ).toBe(shown)
  })
})

describe("pageWindowOptions", () => {
  it("is a modal window over the app's, without script, a preload, Node or a session on disk", () => {
    const parent = {} as BrowserWindow
    const options = pageWindowOptions(parent, {
      title: "Ask",
      width: 400,
      height: 300,
      partition: "ask",
    })
    expect(options).toMatchObject({
      parent,
      modal: true,
      width: 400,
      height: 300,
      resizable: false,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        partition: "ask",
      },
    })
    expect(options.webPreferences?.preload).toBeUndefined()
  })
})
