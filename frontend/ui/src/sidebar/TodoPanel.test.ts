import type { Note } from "@novadeck/core/notes"
import { render } from "@novadeck/test-kit/render"
import { act, createElement } from "react"
import { afterEach, vi } from "vitest"

import { describe, expect, it } from "../test"
import { TodoPanel } from "./TodoPanel"

// jsdom lays nothing out, and has no ResizeObserver of its own: every board measures wide,
// so Done shows beside the other columns.
Object.assign(globalThis, {
  ResizeObserver: class {
    constructor(private readonly report: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.report(
        [{ target, contentRect: { width: 800 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    }
    unobserve(): void {}
    disconnect(): void {}
  },
})
afterEach(() => {
  vi.useRealTimers()
})

// Checked off at 9:05 on 19 November.
const done: Note = {
  id: "d",
  projectId: "storefront",
  text: "Ship it",
  body: "",
  todo: true,
  doneAt: new Date(2026, 10, 19, 9, 5).getTime(),
  createdAt: 0,
}

// The panel over that card, shown or not.
const show = (active: boolean) => {
  const props = (shown: boolean) => ({
    projectId: "storefront",
    notes: [done],
    failed: false,
    active: shown,
    showing: shown,
    onClose: () => {},
    onAdd: () => {},
    onChange: () => {},
    onPlace: undefined,
    onRemove: () => {},
  })
  const page = render(createElement(TodoPanel, props(active)))
  return {
    date: () => page.container.querySelector(".todo-card-date")?.textContent,
    activate: () => page.rerender(createElement(TodoPanel, props(true))),
  }
}

describe("The Todo panel", () => {
  it("tells its done cards the time again as it shows, so yesterday's read as a date", () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 19, 15, 0) })
    const { date, activate } = show(false)
    expect(date()).toMatch(/^Done .*9.05/)

    vi.setSystemTime(new Date(2026, 10, 20, 8, 0))
    activate()
    expect(date()).toMatch(/^Done .*\b19\b/)
    expect(date()).not.toMatch(/05/)
  })

  it("tells them the time every minute while it shows, and the day turns under them", () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 19, 23, 59, 30) })
    const { date } = show(true)
    expect(date()).toMatch(/^Done .*9.05/)

    act(() => vi.advanceTimersByTime(60_000))
    expect(date()).toMatch(/^Done .*\b19\b/)
  })

  it("keeps no time while it is hidden", () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 19, 23, 59, 30) })
    const { date } = show(false)

    act(() => vi.advanceTimersByTime(60_000))
    expect(date()).toMatch(/^Done .*9.05/)
  })
})
