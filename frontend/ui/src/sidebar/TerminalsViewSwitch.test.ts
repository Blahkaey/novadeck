import { render } from "@novadeck/test-kit/render"
import { createElement } from "react"
import { afterEach } from "vitest"

import { describe, expect, it } from "../test"
import { TerminalsViewSwitch } from "./TerminalsViewSwitch"

const unmounts: (() => void)[] = []
afterEach(() => unmounts.splice(0).forEach((unmount) => unmount()))

const viewSwitch = (sessionsAsk?: string) =>
  createElement(TerminalsViewSwitch, { view: "terminals", sessionsAsk, onView: () => {} })

describe("the Terminals panel's view switch", () => {
  it("marks its Sessions choice with a dot only while another session asks", () => {
    const { container, rerender, unmount } = render(viewSwitch())
    unmounts.push(unmount)
    const dot = () => container.querySelector(".terminals-view-dot")
    const sessions = () => container.querySelector('input[value="sessions"]')!.closest("label")
    expect(dot()).toBeNull()
    rerender(viewSwitch("1 needs you"))
    expect(dot()).not.toBeNull()
    expect(sessions()!.contains(dot())).toBe(true)
    rerender(viewSwitch(undefined))
    expect(dot()).toBeNull()
  })
})
