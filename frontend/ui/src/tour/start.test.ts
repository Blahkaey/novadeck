import type { Tour, TourRun } from "@novadeck/core/port"

import { describe, expect, it } from "../test"
import { agentShownIn, startTour, tourTitle, type TourEffects } from "./start"

const run = (brief: TourRun["brief"]): TourRun => ({
  directory: "/home/x/.novadeck/tour",
  command: brief === "launch" ? 'claude --model haiku "Start"' : "agy --model flash",
  brief,
  removed: ["old"],
})

// The effects, each recording what it was asked to do, in order.
const effects = (
  prepared: Promise<TourRun>,
  shown: Promise<boolean> = Promise.resolve(true),
): TourEffects & { readonly done: string[] } => {
  const done: string[] = []
  const tour: Tour = {
    prepare: (agent) => {
      done.push(`prepare ${agent}`)
      return prepared
    },
    brief: (terminalId) => {
      done.push(`brief ${terminalId}`)
      return Promise.resolve()
    },
  }
  return {
    done,
    tour,
    openTour: ({ removed }) => void done.push(`open in place of ${removed.join(",")}`),
    add: ({ title, command }) => {
      done.push(`add ${title}: ${command}`)
      return "t1"
    },
    agentShown: (terminalId) => {
      done.push(`wait for ${terminalId}`)
      return shown
    },
  }
}

describe("Starting the tour", () => {
  it("opens its project and starts the agent with its brief on the launch line", async () => {
    const world = effects(Promise.resolve(run("launch")))
    const started = await startTour("claude", world)
    await started.briefed
    expect(started.terminalId).toBe("t1")
    expect(world.done).toEqual([
      "prepare claude",
      "open in place of old",
      `add ${tourTitle}: claude --model haiku "Start"`,
    ])
  })

  it("rings the brief once the agent shows, where the launch line takes none", async () => {
    const world = effects(Promise.resolve(run("doorbell")))
    const started = await startTour("agy", world)
    await started.briefed
    expect(world.done.slice(-2)).toEqual(["wait for t1", "brief t1"])
  })

  it("rings nothing where the terminal closed before its agent showed", async () => {
    const world = effects(Promise.resolve(run("doorbell")), Promise.resolve(false))
    await (
      await startTour("agy", world)
    ).briefed
    expect(world.done).not.toContain("brief t1")
  })

  it("changes nothing in the workspace where the backend refuses", async () => {
    const world = effects(Promise.reject(new Error("not Novadeck's folder")))
    await expect(startTour("claude", world)).rejects.toThrow("not Novadeck's folder")
    expect(world.done).toEqual(["prepare claude"])
  })
})

describe("The tour's agent showing", () => {
  it("shows once its terminal runs an agent, and waits until then", () => {
    expect(agentShownIn([{ id: "t1", state: "running" }], "t1")).toBeUndefined()
    expect(agentShownIn([{ id: "t1", state: "starting" }], "t1")).toBeUndefined()
    expect(agentShownIn([{ id: "t1", state: "running", agent: { working: false } }], "t1")).toBe(
      true,
    )
  })

  it("never shows once its terminal is gone, or its process ended", () => {
    expect(agentShownIn([], "t1")).toBe(false)
    expect(agentShownIn([{ id: "t1", state: "exited" }], "t1")).toBe(false)
    expect(agentShownIn([{ id: "t1", state: "failed" }], "t1")).toBe(false)
  })
})
