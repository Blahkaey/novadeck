import type { Install, Model } from "@novadeck/harness-core/harness"
import type { AgentName } from "@novadeck/protocol"

import { harnesses } from "../harnesses/registry.js"
import { commandWords } from "../terminals/commands.js"
import { describe, expect, it } from "../test.js"
import { tourChoice, tourLaunch } from "./launch.js"

// Where a harness lives, for the model lists the tour picks from: Novadeck's own lists ignore it.
const install: Install = { env: {}, home: "/home/x", platform: "linux", plugin: "/plugins" }

const codexModels: readonly Model[] = [
  { id: "gpt-6.1-sol", efforts: ["low", "medium", "high"] },
  { id: "gpt-6-luna", efforts: ["low", "medium"] },
  { id: "gpt-5.6-luna", efforts: ["low"] },
]

const launchOf = async (agent: AgentName, models?: readonly Model[]) =>
  tourLaunch(agent, { models: models ?? (await harnesses[agent].launch.models(install)) })

describe("the tour's model", () => {
  it("is Claude Code's haiku at low effort", async () => {
    expect(tourChoice("claude", await harnesses.claude.launch.models(install))).toEqual({
      model: "haiku",
      effort: "low",
    })
  })

  it("is Antigravity's flash at low, the one effort that model takes", async () => {
    expect(tourChoice("agy", await harnesses.agy.launch.models(install))).toEqual({
      model: "gemini-3.8-flash-low",
      effort: "low",
    })
  })

  it("is Codex's newest luna at its lowest effort", () => {
    expect(tourChoice("codex", codexModels)).toEqual({ model: "gpt-6-luna", effort: "low" })
  })

  it("is the last model Codex lists where none is a luna", () => {
    const models = codexModels.filter(({ id }) => !id.endsWith("-luna"))
    expect(tourChoice("codex", [...models, { id: "gpt-5-old", efforts: [] }])).toEqual({
      model: "gpt-5-old",
    })
  })

  it("is none where Codex lists nothing, so it starts on its own", () => {
    expect(tourChoice("codex", [])).toEqual({})
  })
})

describe("the tour's launch line", () => {
  it("starts Claude Code on haiku, taking edits, with no prompt, its brief left to the doorbell", async () => {
    const launch = await launchOf("claude")
    expect(launch).toMatchObject({ brief: "doorbell", model: "haiku" })
    expect(commandWords(launch.command, "linux")).toEqual([
      "claude",
      "--model",
      "haiku",
      "--effort",
      "low",
      "--permission-mode",
      "acceptEdits",
    ])
  })

  it("starts Codex in its workspace-write sandbox, with no prompt, its brief left to the doorbell", async () => {
    const launch = await launchOf("codex", codexModels)
    expect(launch).toMatchObject({ brief: "doorbell", model: "gpt-6-luna" })
    expect(commandWords(launch.command, "linux")).toEqual([
      "codex",
      "--model",
      "gpt-6-luna",
      "-c",
      "model_reasoning_effort=low",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "on-request",
    ])
  })

  it("starts Antigravity plain, taking edits, its brief left to the doorbell", async () => {
    const launch = await launchOf("agy")
    expect(launch).toMatchObject({ brief: "doorbell", model: "gemini-3.8-flash-low" })
    expect(commandWords(launch.command, "linux")).toEqual([
      "agy",
      "--model",
      "gemini-3.8-flash-low",
      "--effort",
      "low",
      "--mode",
      "accept-edits",
    ])
  })

  it("reads the same in Windows' shells", async () => {
    const launch = await launchOf("claude")
    expect(commandWords(launch.command, "win32").at(-1)).toBe("acceptEdits")
  })
})
