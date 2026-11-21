import { context, describe, expect, it } from "../test"
import { dressOwnWindow } from "./own-window-document"

// The page, at its address, with a linked sheet and a style, and a blank window of its own.
const documents = () => {
  const owner = document.implementation.createHTMLDocument("Novadeck")
  owner.head.innerHTML =
    '<base href="http://127.0.0.1:5181/"><link rel="stylesheet" href="/assets/app.css"><style>.a { color: red }</style>'
  owner.documentElement.setAttribute("data-theme", "coolant")
  owner.documentElement.setAttribute("class", "dark")
  owner.documentElement.setAttribute("lang", "en")
  owner.body.setAttribute("class", "loaded")
  const page = document.implementation.createHTMLDocument("")
  return { owner, page }
}

// What the window's head holds, in order.
const head = (page: Document): string[] =>
  [...page.head.children].map((each) =>
    each.localName === "link"
      ? `link ${each.getAttribute("href")}`
      : each.localName === "style"
        ? `style ${each.textContent}`
        : each.localName,
  )

// Lets the observers hear what changed.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe("dressing a panel's window of its own", () => {
  it("copies the page's sheets, in order, a linked one by its whole address", () => {
    const { owner, page } = documents()
    dressOwnWindow(owner, page)
    expect(head(page)).toEqual([
      "title",
      "link http://127.0.0.1:5181/assets/app.css",
      "style .a { color: red }",
    ])
  })

  it("wears what the page's root wears, and its body's classes", () => {
    const { owner, page } = documents()
    dressOwnWindow(owner, page)
    expect(page.documentElement.getAttribute("data-theme")).toBe("coolant")
    expect(page.documentElement.getAttribute("class")).toBe("dark")
    expect(page.documentElement.getAttribute("lang")).toBe("en")
    expect(page.body.getAttribute("class")).toBe("loaded")
  })

  context("as the page changes", () => {
    it("follows a theme switched, and leaves the window's own body style alone", async () => {
      const { owner, page } = documents()
      dressOwnWindow(owner, page)
      page.body.style.overflow = "hidden"

      owner.documentElement.setAttribute("data-theme", "phosphor")
      owner.documentElement.removeAttribute("class")
      owner.body.style.pointerEvents = "none"
      await settled()

      expect(page.documentElement.getAttribute("data-theme")).toBe("phosphor")
      expect(page.documentElement.hasAttribute("class")).toBe(false)
      expect(page.body.style.overflow).toBe("hidden")
      expect(page.body.style.pointerEvents).toBe("")
    })

    it("follows styles that come, change and go, as Vite's do while developing", async () => {
      const { owner, page } = documents()
      dressOwnWindow(owner, page)
      const added = owner.createElement("style")
      added.textContent = ".b { color: blue }"
      owner.head.prepend(added)
      await settled()
      expect(head(page).slice(1)).toEqual([
        "style .b { color: blue }",
        "link http://127.0.0.1:5181/assets/app.css",
        "style .a { color: red }",
      ])

      added.textContent = ".b { color: green }"
      owner.head.querySelector("link")!.remove()
      await settled()

      expect(head(page).slice(1)).toEqual(["style .b { color: green }", "style .a { color: red }"])
    })
  })

  context("with what the window has of its own after the copies, as its title", () => {
    it("leaves the copies in place as the page's sheets change, loading none again", async () => {
      const { owner } = documents()
      // A window named only once dressed, its title coming after the copies.
      const blank = document.implementation.createHTMLDocument()
      blank.head.replaceChildren()
      dressOwnWindow(owner, blank)
      blank.head.append(blank.createElement("title"))
      const moved: Node[] = []
      new MutationObserver((records) => {
        for (const record of records) moved.push(...record.removedNodes)
      }).observe(blank.head, { childList: true })

      owner.head.append(owner.createElement("style"))
      await settled()

      expect(moved).toEqual([])
      expect(head(blank)).toEqual([
        "link http://127.0.0.1:5181/assets/app.css",
        "style .a { color: red }",
        "title",
        "style ",
      ])
    })
  })

  it("takes its copies away once stopped, and follows nothing more", async () => {
    const { owner, page } = documents()
    const stop = dressOwnWindow(owner, page)
    stop()
    owner.documentElement.setAttribute("data-theme", "phosphor")
    await settled()
    expect(head(page)).toEqual(["title"])
    expect(page.documentElement.getAttribute("data-theme")).toBe("coolant")
  })
})
