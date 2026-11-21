import { afterEach, vi } from "vitest"

import { context, describe, expect, it } from "../test"
import {
  chatBoxBeside,
  classifyKeyTarget,
  focusPanel,
  focusSidebarToggle,
  focusZenCreate,
  insideOwnKeys,
} from "./dom"

afterEach(() => document.body.replaceChildren())

const mount = (html: string): HTMLElement => {
  document.body.innerHTML = html
  return document.querySelector<HTMLElement>("[data-target]")!
}

describe("key targets", () => {
  context("inside a region that takes its own keys", () => {
    it("leaves its keys and clicks to it, as it does for a field", () => {
      const target = mount(
        '<aside data-own-keys><button data-target type="button">Go</button></aside>',
      )
      expect(classifyKeyTarget(target).editing).toBe(true)
    })

    it("claims clicks off its controls too, as on its header", () => {
      const target = mount("<aside data-own-keys><header data-target>Debug</header></aside>")
      expect(insideOwnKeys(target)).toBe(true)
    })
  })

  context("in a panel's window of its own", () => {
    it("knows a field there for a field, though that window's elements are its own", () => {
      const frame = document.createElement("iframe")
      document.body.append(frame)
      const other = frame.contentDocument!
      other.body.innerHTML = '<textarea aria-label="Add a note…"></textarea>'
      const field = other.querySelector("textarea")!
      expect(field instanceof Element).toBe(false)
      expect(classifyKeyTarget(field)).toMatchObject({ editing: true, textEntry: true })
    })
  })

  context("on a plain button in the page's chrome", () => {
    it("lets the workspace take its keys", () => {
      const target = mount('<header><button data-target type="button">Go</button></header>')
      expect(classifyKeyTarget(target).editing).toBe(false)
      expect(insideOwnKeys(target)).toBe(false)
    })
  })
})

describe("text entry", () => {
  it("is a field or editor, not a menu, popover or switcher around it", () => {
    expect(classifyKeyTarget(mount('<input data-target type="text" />')).textEntry).toBe(true)
    expect(classifyKeyTarget(mount("<textarea data-target></textarea>")).textEntry).toBe(true)
    expect(classifyKeyTarget(mount("<div contenteditable data-target></div>")).textEntry).toBe(true)
    for (const html of [
      '<div role="dialog"><button data-target type="button">Go</button></div>',
      '<div role="listbox"><div data-target role="option">A</div></div>',
      '<div role="menu"><div data-target role="menuitem">A</div></div>',
      '<div data-scope="popover" data-state="open"><button data-target>Go</button></div>',
    ]) {
      const classified = classifyKeyTarget(mount(html))
      expect(classified.editing).toBe(true)
      expect(classified.textEntry).toBe(false)
    }
  })
})

describe("a modal dialog", () => {
  it("is an app dialog or a confirmation, not a popover or the terminal switcher", () => {
    for (const html of [
      '<div data-scope="dialog" data-part="content" role="dialog"><button data-target>Go</button></div>',
      '<div role="alertdialog"><button data-target>Remove</button></div>',
    ]) {
      expect(classifyKeyTarget(mount(html)).modal).toBe(true)
    }
    for (const html of [
      '<div data-scope="popover" data-part="content" role="dialog" data-state="open"><button data-target>Go</button></div>',
      '<section role="dialog" aria-modal="true"><div data-target role="option">A</div></section>',
    ]) {
      expect(classifyKeyTarget(mount(html)).modal).toBe(false)
    }
  })
})

describe("focusing Zen's controls after they mount", () => {
  it("focuses the control when focus was left on the page", () => {
    mount('<button data-workspace-zen-create data-target type="button">New</button>')
    focusZenCreate()
    expect(document.activeElement).toBe(document.querySelector("[data-target]"))
  })

  it("takes it from the control it replaces, as it unmounts", () => {
    mount(
      '<button data-workspace-zen-create data-target type="button">New</button><button data-workspace-zen-enter type="button">Zen</button>',
    )
    document.querySelector<HTMLElement>("[data-workspace-zen-enter]")!.focus()
    focusZenCreate()
    expect(document.activeElement).toBe(document.querySelector("[data-target]"))
  })

  it("takes it from a control that became inert", () => {
    mount(
      '<button data-workspace-zen-create data-target type="button">New</button><div inert><button data-other type="button">Prefs</button></div>',
    )
    const hidden = document.querySelector<HTMLElement>("[data-other]")!
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => hidden })
    try {
      focusZenCreate()
    } finally {
      delete (document as { activeElement?: unknown }).activeElement
    }
    expect(document.activeElement).toBe(document.querySelector("[data-target]"))
  })

  it("takes it from a control that became disabled", () => {
    mount(
      '<button data-workspace-zen-create data-target type="button">New</button><button data-other disabled type="button">Switch</button>',
    )
    const disabled = document.querySelector<HTMLElement>("[data-other]")!
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => disabled })
    try {
      focusZenCreate()
    } finally {
      delete (document as { activeElement?: unknown }).activeElement
    }
    expect(document.activeElement).toBe(document.querySelector("[data-target]"))
  })

  it("leaves focus where a key moved it before the frame", () => {
    mount(
      '<button data-workspace-zen-create type="button">New</button><button data-target type="button">Other</button>',
    )
    document.querySelector<HTMLElement>("[data-target]")!.focus()
    focusZenCreate()
    expect(document.activeElement).toBe(document.querySelector("[data-target]"))
  })
})

describe("the sidebar toggle's focus as the sidebar hides", () => {
  const page = `
    <nav class="sidebar-tools"><button id="terminals-toggle" type="button">Terminals</button></nav>
    <aside id="terminal-sidebar"><button id="inside" type="button">Close</button></aside>
    <textarea id="terminal"></textarea>`

  it("takes the focus the sidebar held, or none held", () => {
    document.body.innerHTML = page
    document.getElementById("inside")!.focus()
    focusSidebarToggle("terminals")
    expect(document.activeElement?.id).toBe("terminals-toggle")
    ;(document.activeElement as HTMLElement).blur()
    focusSidebarToggle("terminals")
    expect(document.activeElement?.id).toBe("terminals-toggle")
  })

  it("leaves typing in a terminal where it is", () => {
    document.body.innerHTML = page
    document.getElementById("terminal")!.focus()
    focusSidebarToggle("terminals")
    expect(document.activeElement?.id).toBe("terminal")
  })
})

describe("the chat box beside a terminal's taskbar", () => {
  const terminalWindow = (chat: string, split = ""): HTMLElement =>
    mount(
      `<div data-terminal="t1"><div class="pane-split"${split}><div data-workspace-chat>${chat}<textarea data-terminal-input aria-label="box"></textarea></div></div><div data-taskbar><button data-target type="button">Plan</button></div></div>`,
    )

  it("is the box of the chat in the same window", () => {
    expect(chatBoxBeside(terminalWindow(""))?.getAttribute("aria-label")).toBe("box")
  })

  it("is none while the agent's own rows take the keys", () => {
    expect(
      chatBoxBeside(terminalWindow('<section class="chat-live" data-takes-keys></section>')),
    ).toBe(null)
  })

  it("is the box while the rows are a menu the box passes keys to", () => {
    expect(chatBoxBeside(terminalWindow('<section class="chat-live"></section>'))).not.toBe(null)
  })

  it("is none while a pane covers the terminal", () => {
    expect(chatBoxBeside(terminalWindow("", ' style="--_pane-cover: 1"'))).toBe(null)
  })

  it("is none for a terminal without a chat", () => {
    expect(
      chatBoxBeside(mount('<div data-terminal="t1"><button data-target></button></div>')),
    ).toBe(null)
  })
})

describe("focusing a panel as it comes to the sidebar or opens in a window", () => {
  // The panel's frame (SidebarPanel.tsx): its heading, its header's controls and its body.
  const panel = (header: string, body: string): string => `
    <section id="notes-panel">
      <h2 id="notes-panel-title" tabindex="-1">Notes</h2>
      <header class="sidebar-panel-header">${header}</header>
      <div class="sidebar-panel-content">${body}</div>
    </section>`
  // The frames the browser would run, run here one at a time.
  const frames = (): (() => void) => {
    const waiting: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => waiting.push(frame))
    return () => waiting.shift()?.(performance.now())
  }

  it("focuses the first control in its body", () => {
    mount(panel('<button type="button">Hide</button>', "<textarea data-target></textarea>"))
    focusPanel("notes")
    expect(document.activeElement).toBe(document.querySelector("[data-target]"))
  })

  it("focuses a control in its header when its body has none", () => {
    mount(panel('<button data-target type="button">Hide</button>', "<p>No notes yet.</p>"))
    focusPanel("notes")
    expect(document.activeElement).toBe(document.querySelector("[data-target]"))
  })

  it("focuses its heading when it has no control at all, as in a window with nothing listed", () => {
    mount(panel("", "<p>Nothing closed yet.</p>"))
    focusPanel("notes")
    expect(document.activeElement).toBe(document.getElementById("notes-panel-title"))
  })

  it("passes over a control it can't use yet, in a panel still inert", () => {
    mount(`<div inert>${panel("", '<button type="button">Add</button>')}</div>`)
    const frame = frames()
    focusPanel("notes")
    expect(document.activeElement).toBe(document.body)
    document.querySelector("[inert]")!.removeAttribute("inert")
    frame()
    expect(document.activeElement).toBe(document.querySelector("#notes-panel button"))
  })

  it("tries again on the next frames while the panel isn't there yet", () => {
    const frame = frames()
    focusPanel("notes")
    frame()
    mount(panel("", "<textarea data-target></textarea>"))
    frame()
    expect(document.activeElement).toBe(document.querySelector("[data-target]"))
  })

  it("focuses it in the document it is in, as its window of its own", () => {
    const frame = document.createElement("iframe")
    document.body.append(frame)
    const other = frame.contentDocument!
    other.body.innerHTML = panel("", "<textarea data-target></textarea>")
    focusPanel("notes", other)
    expect(other.activeElement).toBe(other.querySelector("[data-target]"))
  })

  it("gives up once the person moves the focus meanwhile", () => {
    const frame = frames()
    focusPanel("notes")
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button id="elsewhere" type="button">Go</button>',
    )
    document.getElementById("elsewhere")!.focus()
    document.body.insertAdjacentHTML("beforeend", panel("", "<textarea></textarea>"))
    frame()
    expect(document.activeElement).toBe(document.getElementById("elsewhere"))
  })
})
