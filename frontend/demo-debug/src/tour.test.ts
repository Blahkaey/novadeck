import type { AgentConnection } from "@novadeck/core/port"
import { createStore } from "@novadeck/core/store"
import { demoTour, demoTourRefusal } from "@novadeck/demo/tour"

import { describe, expect, it } from "./test"
import { tourGroups } from "./tour"

const connected: readonly AgentConnection[] = [
  { agent: "claude", available: true, connected: true, busy: false },
]

const tourOf = () => demoTour(createStore(connected), () => undefined)

describe("the tour group", () => {
  it("offers the tour as the Help menu does", () => {
    const tour = tourOf()
    const asked: string[] = []
    const stop = tour.asked!(() => asked.push("asked"))
    const [group] = tourGroups(tour)
    expect(tour.offered.getSnapshot()).toBe(false)
    void group!.actions.find((each) => each.label === "Offer the tour")!.run({} as never)
    stop()
    expect(asked).toEqual(["asked"])
    expect(tour.offered.getSnapshot()).toBe(true)
    void group!.actions.find((each) => each.label === "Hold the tour back")!.run({} as never)
    expect(tour.offered.getSnapshot()).toBe(false)
    expect(group!.section).toBe("App")
  })

  it("fails only the next start, as a folder of the person's own does", async () => {
    const tour = tourOf()
    const [group] = tourGroups(tour)
    void group!.actions.find((each) => each.label === "Fail next start")!.run({} as never)
    await expect(tour.prepare("claude")).rejects.toThrow(demoTourRefusal)
    await expect(tour.prepare("claude")).resolves.toMatchObject({
      directory: "~/.novadeck/tour",
      brief: "launch",
      model: "haiku",
    })
  })

  it("refuses an agent that isn't connected, and leaves Antigravity's line to the doorbell", async () => {
    const tour = demoTour(
      createStore<readonly AgentConnection[]>([
        { agent: "agy", available: true, connected: true, busy: false },
      ]),
      () => undefined,
    )
    await expect(tour.prepare("claude")).rejects.toThrow()
    await expect(tour.prepare("agy")).resolves.toMatchObject({ brief: "doorbell" })
  })

  it("gives each action a hint that says what appears", () => {
    const [group] = tourGroups(tourOf())
    for (const action of group!.actions) expect(action.hint.length).toBeGreaterThan(20)
  })
})
