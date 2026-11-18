import { describe, expect, it } from "../test"
import { blockedText, unreadableText } from "./SaveNotice"

describe("why edits can't be saved", () => {
  it.each([
    ["gone", "This file was deleted, so your edits can't be saved."],
    ["folder", "Novadeck can't write to this file or its folder, so your edits can't be saved."],
    ["too-large", "This file is too large for Novadeck to save your edits."],
    [
      "not-a-plan",
      "Novadeck saves only the file the project window shows, so your edits can't be saved.",
    ],
    [
      "outside",
      "Novadeck saves only the project's own files, and this one is outside its folder, in Git's own folder or an agent's copy, so your edits can't be saved.",
    ],
    ["moved", "The window shows another file now, so your edits can't be saved into this one."],
    ["not-text", "This file is no longer text Novadeck can edit, so your edits can't be saved."],
    ["transcript", "Novadeck can't write to this file, so your edits can't be saved."],
  ] as const)("says it of a file for %s, keeping the edits there", (reason, said) => {
    expect(blockedText(reason, { kind: "file" })).toBe(
      `${said} Your edits are kept here until you close this file.`,
    )
  })

  it.each([
    ["gone", "This plan's file was deleted, so your edits can't be saved."],
    ["folder", "Novadeck can't write to this plan's folder, so your edits can't be saved."],
    ["too-large", "This plan is too large for Novadeck to save your edits."],
    [
      "not-a-plan",
      "Novadeck can't write to this, since it isn't a plan file, so your edits can't be saved.",
    ],
    [
      "outside",
      "Novadeck saves plans only in the project's folder or the agent's own plans folder, and this one is elsewhere, so your edits can't be saved.",
    ],
    ["moved", "This plan now points at another file, so your edits can't be saved into it."],
    [
      "not-text",
      "This plan's file is no longer text Novadeck can edit, so your edits can't be saved.",
    ],
  ] as const)("says it of a plan for %s, keeping the edits there", (reason, said) => {
    expect(blockedText(reason, { kind: "plan", agent: "Codex" })).toBe(
      `${said} Your edits are kept here until you close this plan.`,
    )
  })

  it("reads a plan in its agent's messages as read-only from the start", () => {
    expect(blockedText("transcript", { kind: "plan", agent: "Codex" })).toBe(
      "Read-only: this plan lives in Codex's messages, not a file, so notes can't go in it.",
    )
  })

  it("says a file that can't be read now is that file", () => {
    expect(unreadableText("file")).toBe(
      "Novadeck can't read this file right now, so your edits can't be saved. Your edits are kept here until you close this file.",
    )
  })
})
