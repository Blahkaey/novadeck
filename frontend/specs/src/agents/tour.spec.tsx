import { page, type Locator } from "vitest/browser"

import { openPreferencesOn, preferencesDialog } from "../support/keyboard"
import { workspaceSwitcher } from "../support/sessions"
import { expectSelected, openWorkspace, terminalTabNames } from "../support/workspace"
import { context, describe, expect, it } from "../test"

// Held back from everyone until its story is whole; the demo offers it on `&tour=on`.
const offered = "/?tour=on"

const consent = (): Locator => page.getByRole("dialog", { name: "Take the tour" })
const welcome = (): Locator => page.getByRole("dialog", { name: "Welcome to Novadeck" })
const start = (): Locator => consent().getByRole("button", { name: "Start the tour" })
// Waits for the consent to say `words`, among the rest of what it says.
const consentSays = (words: string): Promise<void> =>
  expect.poll(() => consent().query()?.textContent ?? "").toContain(words)

// The tour is on screen: its own project, with its one terminal, its agent's, selected.
const expectTourOpen = async (): Promise<void> => {
  await expect.poll(() => workspaceSwitcher().element().textContent ?? "").toContain("Tour")
  await expect.poll(() => terminalTabNames().length).toBe(1)
  await expectSelected(terminalTabNames()[0]!)
}

// Offers the tour from Preferences' About, which closes for it; with `connect`, Claude Code
// is connected first, in General (the demo starts with none).
const offerFromAbout = async ({ connect = true } = {}): Promise<void> => {
  await openPreferencesOn("General")
  if (connect) {
    const claude = preferencesDialog().getByRole("switch", { name: "Claude Code" })
    await claude.click()
    await expect.element(claude).toHaveAttribute("aria-checked", "true")
  }
  await preferencesDialog().getByRole("tab", { name: "About" }).click()
  await preferencesDialog().getByRole("button", { name: "Take the tour" }).click()
  await expect.element(preferencesDialog()).not.toBeInTheDocument()
  await expect.element(consent()).toBeVisible()
}

describe("The tour", () => {
  it("isn't offered yet, even in experimental builds", async () => {
    await openWorkspace("/?demo=welcome&channel=experimental")
    await expect.element(welcome()).toBeVisible()
    expect(welcome().getByRole("button", { name: "Take the tour" }).query()).toBeNull()
    await welcome().getByRole("button", { name: "Skip for now" }).click()
    await openPreferencesOn("About")
    expect(preferencesDialog().getByRole("button", { name: "Take the tour" }).query()).toBeNull()
  })

  context("offered from Preferences' About", () => {
    it("asks first, saying what it runs, where, and how to stop it", async () => {
      await openWorkspace(offered)
      await offerFromAbout()
      await consentSays("Runs Claude Code on its cheapest model, on your own account")
      await consentSays("~/.novadeck/tour")
      await consentSays("Close the tour's terminal to stop it")
      await expect.element(start()).toHaveFocus()
    })

    it("opens the Tour project with its agent starting on its cheapest model", async () => {
      await openWorkspace(offered)
      const before = terminalTabNames()
      await offerFromAbout()
      await start().click()
      await expect.element(consent()).not.toBeInTheDocument()
      expect(before).not.toContain("Tour")
      await expectTourOpen()
    })

    it("starts nothing where it was turned down", async () => {
      await openWorkspace(offered)
      const before = terminalTabNames()
      await offerFromAbout()
      await consent().getByRole("button", { name: "Not now" }).click()
      await expect.element(consent()).not.toBeInTheDocument()
      expect(terminalTabNames()).toEqual(before)
    })

    it("says to connect an agent first where none is", async () => {
      await openWorkspace(offered)
      await offerFromAbout({ connect: false })
      await consentSays("Connect Claude Code, Codex or Antigravity")
      expect(start().query()).toBeNull()
      await consent().getByRole("button", { name: "Close" }).click()
      await expect.element(consent()).not.toBeInTheDocument()
    })

    it("says why it couldn't start, staying open to try again", async () => {
      await openWorkspace(`${offered}&tourStart=fails`)
      await offerFromAbout()
      await start().click()
      await consentSays("holds files Novadeck didn't put there")
      // The next try goes, the folder now fine.
      await start().click()
      await expectTourOpen()
    })

    it("opens nothing where it couldn't start", async () => {
      await openWorkspace(`${offered}&tourStart=fails`)
      const before = terminalTabNames()
      await offerFromAbout()
      await start().click()
      await consentSays("holds files Novadeck didn't put there")
      await consent().getByRole("button", { name: "Not now" }).click()
      await expect.element(consent()).not.toBeInTheDocument()
      expect(terminalTabNames()).toEqual(before)
      await expect.element(workspaceSwitcher()).not.toHaveTextContent("Tour")
    })
  })

  it("offers to start an agent that hasn't listed its models yet", async () => {
    await openWorkspace(`${offered}&tourStart=unlisted`)
    await offerFromAbout()
    await start().click()
    await consentSays("hasn't listed its models here yet")
    await consent().getByRole("button", { name: "Start Claude Code" }).click()
    await expect.element(consent()).not.toBeInTheDocument()
    await expectSelected("claude")
  })

  context("taken from the welcome dialog", () => {
    it("applies the choices and offers the tour on the first agent chosen", async () => {
      await openWorkspace(`${offered}&demo=welcome`)
      await welcome().getByRole("checkbox", { name: "Claude Code" }).click()
      await welcome().getByRole("button", { name: "Take the tour" }).click()
      await expect.element(welcome()).not.toBeInTheDocument()
      await consentSays("Runs Codex on its cheapest model")
      await start().click()
      await expectTourOpen()
    })

    it("lets the person pick another connected agent", async () => {
      await openWorkspace(`${offered}&demo=welcome`)
      await welcome().getByRole("button", { name: "Take the tour" }).click()
      await consentSays("Runs Claude Code on its cheapest model")
      // On its visible label, as a person does.
      const agents = consent().getByRole("radiogroup", { name: "Agent for the tour" })
      await agents.getByText("Codex", { exact: true }).click()
      await expect.element(agents.getByRole("radio", { name: "Codex" })).toBeChecked()
      await consentSays("Runs Codex on its cheapest model")
      await start().click()
      await expectTourOpen()
    })
  })
})
