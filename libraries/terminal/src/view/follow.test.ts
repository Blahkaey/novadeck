import { afterEach, beforeEach, describe as context, describe, expect, it, vi } from "vitest"

import type { AttachStream } from "../contract.js"
import {
  exited,
  later,
  optionsOf,
  output,
  resized,
  shell,
  snapshot,
  streamOf,
} from "./fakes.test-support.js"
import { busyToldMs, followTerminal, type FollowOptions } from "./follow.js"

const key = "t"

// The screen a followed terminal draws on, recording what is drawn.
const drawing = (drawn: string[]) => ({
  write: async (data: string) => void drawn.push(data),
  reset: () => void drawn.push("reset"),
  resize: () => {},
  fit: () => undefined,
  exited: () => {},
  live: () => {},
})

// Runs whatever the view has waiting, its timers' too, so what hasn't happened by then
// would not: a check that nothing happened can't pass by being early.
const idle = () => vi.advanceTimersByTimeAsync(5_000)

// A mock attach, given its streams by each test.
const attaching = () => vi.fn<FollowOptions<string>["attach"]>()

describe("following a terminal", () => {
  it("reports an exit only after drawing the output that came before it", async () => {
    const drawn: string[] = []
    const exit = { code: null, signal: "SIGKILL", ranMs: 500 }
    const { attached } = streamOf([output("kill -9", 1), output(" $$\r\n", 2), exited(exit, 3)], {
      ends: true,
    })
    const followed = followTerminal(
      optionsOf({
        attach: async () => attached,
        waitsAfter: () => true,
        on: { exited: (_key, reported) => void drawn.push(`owner:${reported.signal}`) },
      }),
      key,
      {
        write: async (data) => void drawn.push(data),
        reset: () => {},
        resize: () => {},
        fit: () => undefined,
        exited: (waits) => drawn.push(`hint:${waits}`),
        live: () => {},
      },
    )
    await vi.waitFor(() => expect(drawn).toHaveLength(4))
    followed.stop()
    expect(drawn).toEqual(["kill -9", " $$\r\n", "owner:SIGKILL", "hint:true"])
  })

  context("parked out of sight", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }))
    afterEach(() => vi.useRealTimers())

    it("lets go of the stream, and draws the host's screen as it is once shown again", async () => {
      const first = streamOf([snapshot("$ before")])
      const second = streamOf([snapshot("$ after")])
      const attach = attaching()
        .mockResolvedValueOnce(first.attached)
        .mockResolvedValue(second.attached)
      const drawn: string[] = []
      const followed = followTerminal(optionsOf({ attach }), key, drawing(drawn))
      await vi.waitFor(() => expect(drawn).toEqual(["reset", "$ before"]))
      followed.park()
      expect(first.close).toHaveBeenCalled()
      await idle()
      expect(attach).toHaveBeenCalledTimes(1)
      followed.unpark()
      await vi.waitFor(() => expect(drawn).toEqual(["reset", "$ before", "reset", "$ after"]))
      followed.stop()
    })

    it("attaches again when shown before the parked stream wound down", async () => {
      const first = streamOf([snapshot("$ before")])
      const second = streamOf([snapshot("$ after")])
      const attach = attaching()
        .mockResolvedValueOnce(first.attached)
        .mockResolvedValue(second.attached)
      const drawn: string[] = []
      const followed = followTerminal(optionsOf({ attach }), key, drawing(drawn))
      await vi.waitFor(() => expect(drawn).toEqual(["reset", "$ before"]))
      followed.park()
      followed.unpark()
      await vi.waitFor(() => expect(drawn).toEqual(["reset", "$ before", "reset", "$ after"]))
      followed.stop()
    })

    it("attaches once when shown again before its shell had started", async () => {
      let start: (ready: boolean) => void = () => {}
      const entry = shell({
        ready: new Promise<boolean>((resolve) => {
          start = resolve
        }),
      })
      const exit = { code: 1, signal: null, ranMs: 5_000 }
      const attach = attaching().mockResolvedValue(
        streamOf([snapshot("$ exit 1", exit)], { ends: true }).attached,
      )
      const drawn: string[] = []
      const followed = followTerminal(
        optionsOf({ attach, lifecycle: () => entry }),
        key,
        drawing(drawn),
      )
      followed.park()
      followed.unpark()
      start(true)
      await vi.waitFor(() => expect(drawn).toEqual(["reset", "$ exit 1"]))
      await idle()
      expect(attach).toHaveBeenCalledTimes(1)
      followed.stop()
    })

    it("attaches again when parked while attaching, once shown", async () => {
      let land: (attached: AttachStream) => void = () => {}
      const first = streamOf([snapshot("$ before")])
      const second = streamOf([snapshot("$ after")])
      const attach = attaching()
        .mockReturnValueOnce(
          new Promise((resolve) => {
            land = resolve
          }),
        )
        .mockResolvedValue(second.attached)
      const drawn: string[] = []
      const followed = followTerminal(optionsOf({ attach }), key, drawing(drawn))
      await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(1))
      followed.park()
      land(first.attached)
      await vi.waitFor(() => expect(first.close).toHaveBeenCalled())
      followed.unpark()
      await vi.waitFor(() => expect(drawn).toEqual(["reset", "$ after"]))
      followed.stop()
    })

    it("attaches once to a shell restarted while parked, after it exits", async () => {
      let revive: () => void = () => {}
      const entry = shell({
        revived: new Promise<void>((resolve) => {
          revive = resolve
        }),
      })
      const exit = { code: 1, signal: null, ranMs: 5_000 }
      const first = streamOf([snapshot("$ before")])
      const attach = attaching()
        .mockResolvedValueOnce(first.attached)
        .mockResolvedValue(streamOf([snapshot("$ fresh exited", exit)], { ends: true }).attached)
      const drawn: string[] = []
      const followed = followTerminal(
        optionsOf({ attach, lifecycle: () => entry }),
        key,
        drawing(drawn),
      )
      await vi.waitFor(() => expect(drawn).toEqual(["reset", "$ before"]))
      followed.park()
      await idle()
      // A fresh shell while parked: its revival resolves and the next one takes its place.
      const revived = revive
      Object.assign(entry, {
        revived: new Promise<void>((resolve) => {
          revive = resolve
        }),
      })
      revived()
      await idle()
      followed.unpark()
      await vi.waitFor(() =>
        expect(drawn).toEqual(["reset", "$ before", "reset", "$ fresh exited"]),
      )
      await idle()
      expect(attach).toHaveBeenCalledTimes(2)
      followed.stop()
    })

    it("holds a fresh shell started out of sight until shown", async () => {
      let revive: () => void = () => {}
      const entry = shell({
        revived: new Promise<void>((resolve) => {
          revive = resolve
        }),
      })
      const exit = { code: 1, signal: null, ranMs: 5_000 }
      const fresh = streamOf([snapshot("$ fresh")])
      const attach = attaching()
        .mockResolvedValueOnce(streamOf([snapshot("$ exit 1", exit)], { ends: true }).attached)
        .mockResolvedValue(fresh.attached)
      const drawn: string[] = []
      const followed = followTerminal(
        optionsOf({ attach, lifecycle: () => entry }),
        key,
        drawing(drawn),
      )
      await vi.waitFor(() => expect(drawn).toEqual(["reset", "$ exit 1"]))
      followed.park()
      Object.assign(entry, { revived: new Promise<void>(() => {}) })
      revive()
      await idle()
      expect(attach).toHaveBeenCalledTimes(1)
      followed.unpark()
      await vi.waitFor(() => expect(drawn).toEqual(["reset", "$ exit 1", "reset", "$ fresh"]))
      followed.stop()
    })
  })

  context("shown again after it parked", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }))
    afterEach(() => vi.useRealTimers())

    // Where the attaches asked to go on from, in turn.
    const asked = (attach: ReturnType<typeof attaching>) =>
      attach.mock.calls.map(([, after]) => after)

    it("goes on from the last event it drew: live, shown and fitted once granted, then the events since", async () => {
      const first = streamOf([snapshot("$ before"), output(" one", 2)], { placed: true })
      const second = streamOf([output(" two", 3)], { placed: true })
      const attach = attaching()
        .mockResolvedValueOnce(first.attached)
        .mockResolvedValue(second.attached)
      const drawn: string[] = []
      const followed = followTerminal(
        optionsOf({ attach, on: { stage: (_key, stage) => void drawn.push(stage) } }),
        key,
        {
          ...drawing(drawn),
          resize: ({ cols, rows }) => void drawn.push(`size:${cols}x${rows}`),
          fit: () => ({ cols: 80, rows: 24 }),
          live: (live) => void drawn.push(`live:${live}`),
        },
      )
      await vi.waitFor(() => expect(drawn.at(-1)).toBe(" one"))
      followed.park()
      await idle()
      drawn.length = 0
      followed.unpark()
      await vi.waitFor(() => expect(drawn.at(-1)).toBe(" two"))
      expect(asked(attach)).toEqual([undefined, 2])
      // No fresh screen: the screen it kept goes live and takes what came since, at its size.
      expect(drawn).toEqual(["live:true", "shown", " two"])
      // The pane is the size the host last had, which it isn't sent again.
      expect(first.resized).toEqual([])
      expect(second.resized).toEqual([])
      followed.stop()
    })

    type Size = { readonly cols: number; readonly rows: number }

    // Follows a terminal on a pane of 80x24, on a screen that records what it draws and each
    // size it takes, parks it once the first stream's events are drawn, and shows it again in a
    // pane of `fit` by then (none: one with no room), on the streams `next` in turn.
    const resuming = async (fit: Size | undefined, ...next: ReturnType<typeof streamOf>[]) => {
      const first = streamOf([snapshot("$ "), output("x", 2)], { placed: true })
      const attach = attaching().mockResolvedValueOnce(first.attached)
      for (const stream of next) attach.mockResolvedValueOnce(stream.attached)
      const drawn: string[] = []
      let pane: Size | undefined = { cols: 80, rows: 24 }
      const followed = followTerminal(optionsOf({ attach }), key, {
        ...drawing(drawn),
        resize: ({ cols, rows }) => void drawn.push(`size:${cols}x${rows}`),
        fit: () => pane,
      })
      await idle()
      followed.park()
      await idle()
      drawn.length = 0
      pane = fit
      followed.unpark()
      await idle()
      expect(asked(attach)).toEqual([undefined, 2])
      return { followed, attach, drawn, sized: (size: Size) => void (pane = size) }
    }

    it("draws what came since at the size it was made for, and takes the pane's where the host did", async () => {
      const second = streamOf([output("y", 3)], { placed: true })
      const { followed, drawn, sized } = await resuming({ cols: 100, rows: 30 }, second)
      expect(second.resized).toEqual(["100x30"])
      expect(drawn).toEqual(["y"])
      // Fitted again meanwhile, as a mount placing it does: the size is on its way already.
      expect(followed.refit()).toBe(false)
      second.push(resized(100, 30, 4))
      second.push(output("z", 5))
      await idle()
      expect(drawn).toEqual(["y", "size:100x30", "z"])
      expect(second.resized).toEqual(["100x30"])
      // Answered, it fits the pane at once again, as any stream does.
      sized({ cols: 120, rows: 40 })
      followed.refit()
      expect(drawn.at(-1)).toBe("size:120x40")
      expect(second.resized).toEqual(["100x30", "120x40"])
      followed.stop()
    })

    it("fits the pane at once later on, where it kept the host's size", async () => {
      const second = streamOf([], { placed: true })
      const { followed, drawn, sized } = await resuming({ cols: 80, rows: 24 }, second)
      sized({ cols: 100, rows: 30 })
      followed.refit()
      expect(drawn).toEqual(["size:100x30"])
      expect(second.resized).toEqual(["100x30"])
      followed.stop()
    })

    it("takes the pane's size back from a resize made elsewhere while it was parked, where the host did, and only that one", async () => {
      const second = streamOf([resized(120, 40, 3), output("q", 4)], { placed: true })
      const { followed, drawn } = await resuming({ cols: 80, rows: 24 }, second)
      expect(second.resized).toEqual(["80x24"])
      expect(drawn).toEqual(["size:120x40", "q"])
      // Its own size coming back, then another window's later on, as any stream follows it.
      second.push(resized(80, 24, 5))
      second.push(resized(132, 43, 6))
      await idle()
      expect(drawn).toEqual(["size:120x40", "q", "size:80x24", "size:132x43"])
      expect(second.resized).toEqual(["80x24"])
      followed.stop()
    })

    it("takes the pane's size once its stream ends with no answer, as one of a shell that exited while parked does", async () => {
      const exit = { code: 0, signal: null, ranMs: 5_000 }
      const second = streamOf([output("bye", 3), exited(exit, 4)], { ends: true, placed: true })
      const { followed, drawn } = await resuming({ cols: 100, rows: 30 }, second)
      expect(drawn).toEqual(["bye", "size:100x30"])
      followed.stop()
    })

    it("keeps the host's size when parked again before the host answered, and asks again once shown", async () => {
      const second = streamOf([], { placed: true })
      const third = streamOf([], { placed: true })
      const { followed, drawn } = await resuming({ cols: 100, rows: 30 }, second, third)
      expect(second.resized).toEqual(["100x30"])
      followed.park()
      await idle()
      followed.unpark()
      await idle()
      expect(drawn).toEqual([])
      expect(third.resized).toEqual(["100x30"])
      followed.stop()
    })

    it("holds the first size it fits where its pane had no room once granted", async () => {
      const second = streamOf([output("y", 3)], { placed: true })
      const { followed, drawn, sized } = await resuming(undefined, second)
      expect(second.resized).toEqual([])
      sized({ cols: 100, rows: 30 })
      expect(followed.refit()).toBe(true)
      second.push(output("z", 4))
      second.push(resized(100, 30, 5))
      await idle()
      expect(drawn).toEqual(["y", "z", "size:100x30"])
      followed.stop()
    })

    it("fits the pane at once where the host sends its screen instead of what came since", async () => {
      const second = streamOf([snapshot("$ all", null, 3)], { placed: true })
      const { followed, drawn } = await resuming({ cols: 100, rows: 30 }, second)
      expect(drawn).toEqual(["reset", "size:80x24", "$ all", "size:100x30"])
      // Sent again, as the host's screen came at the size before the first reached it.
      expect(second.resized).toEqual(["100x30", "100x30"])
      followed.stop()
    })

    it("goes on from where the last of the output it drew as one stood, on a paced screen", async () => {
      // The screen gathers output for 250 ms, so "a" and "b" are drawn in one write.
      const first = streamOf([snapshot("$ "), output("a", 2), output("b", 3)], { placed: true })
      const attach = attaching()
        .mockResolvedValueOnce(first.attached)
        .mockResolvedValue(streamOf([], { placed: true }).attached)
      const drawn: string[] = []
      const followed = followTerminal(optionsOf({ attach }), key, {
        ...drawing(drawn),
        pace: () => 250,
      })
      await idle()
      expect(drawn).toEqual(["reset", "$ ", "ab"])
      followed.park()
      await idle()
      followed.unpark()
      await idle()
      expect(asked(attach)).toEqual([undefined, 3])
      followed.stop()
    })

    it("goes on from after the output it read ahead, drawn as the park wound its stream down", async () => {
      // The first stream's output is drawn in one write, on a screen that gathers it for
      // 250 ms; the write of it waits, and output that comes meanwhile is read while it does.
      const first = streamOf([snapshot("$ "), output("a", 2), output("b", 3)], { placed: true })
      const attach = attaching()
        .mockResolvedValueOnce(first.attached)
        .mockResolvedValue(streamOf([], { placed: true }).attached)
      const drawn: string[] = []
      const writing = later<void>()
      const followed = followTerminal(optionsOf({ attach }), key, {
        ...drawing(drawn),
        pace: () => 250,
        write: async (data) => {
          drawn.push(data)
          if (data === "ab") await writing.promise
        },
      })
      await idle()
      expect(drawn).toEqual(["reset", "$ ", "ab"])
      first.push(output("c", 4))
      await idle()
      // Parked with "c" read and "ab" not yet drawn: both are drawn as the stream winds down.
      followed.park()
      writing.give()
      await idle()
      expect(drawn).toEqual(["reset", "$ ", "ab", "c"])
      followed.unpark()
      await idle()
      expect(asked(attach)).toEqual([undefined, 4])
      followed.stop()
    })

    it("attaches afresh once a draw failed, with nothing to go on from", async () => {
      const failing = streamOf([snapshot("$ "), output("garbled", 2)], { placed: true })
      const fresh = streamOf([snapshot("$ fresh", null, 3)], { placed: true })
      const attach = attaching()
        .mockResolvedValueOnce(failing.attached)
        .mockResolvedValueOnce(fresh.attached)
        .mockResolvedValue(streamOf([], { placed: true }).attached)
      const followed = followTerminal(optionsOf({ attach }), key, {
        ...drawing([]),
        write: async (data) => {
          if (data === "garbled") throw new Error("no such row")
        },
      })
      await idle()
      expect(asked(attach)).toEqual([undefined, undefined])
      // The fresh screen it drew is one to go on from again.
      followed.park()
      await idle()
      followed.unpark()
      await idle()
      expect(asked(attach)).toEqual([undefined, undefined, 3])
      followed.stop()
    })

    it("attaches afresh once a draw failed as the park wound its stream down", async () => {
      const garbling = later<void>()
      const attach = attaching()
        .mockResolvedValueOnce(
          streamOf([snapshot("$ "), output("garbled", 2)], { placed: true }).attached,
        )
        .mockResolvedValue(streamOf([], { placed: true }).attached)
      const followed = followTerminal(optionsOf({ attach }), key, {
        ...drawing([]),
        write: async (data) => {
          if (data !== "garbled") return
          await garbling.promise
          throw new Error("no such row")
        },
      })
      await idle()
      followed.park()
      garbling.give()
      await idle()
      followed.unpark()
      await idle()
      expect(asked(attach)).toEqual([undefined, undefined])
      followed.stop()
    })

    it("attaches afresh to a shell started after the one it drew had exited", async () => {
      let revive: () => void = () => {}
      const entry = shell({
        revived: new Promise<void>((resolve) => {
          revive = resolve
        }),
      })
      const exit = { code: 1, signal: null, ranMs: 5_000 }
      const attach = attaching()
        .mockResolvedValueOnce(
          streamOf([snapshot("$ "), output("bye", 2), exited(exit, 3)], {
            ends: true,
            placed: true,
          }).attached,
        )
        .mockResolvedValue(streamOf([snapshot("$ fresh", null, 5)], { placed: true }).attached)
      const followed = followTerminal(
        optionsOf({ attach, lifecycle: () => entry }),
        key,
        drawing([]),
      )
      await idle()
      followed.park()
      Object.assign(entry, { revived: new Promise<void>(() => {}) })
      revive()
      await idle()
      followed.unpark()
      await idle()
      expect(asked(attach)).toEqual([undefined, undefined])
      followed.stop()
    })

    it("attaches afresh where its stream can't say where it stands", async () => {
      const attach = attaching()
        .mockResolvedValueOnce(streamOf([snapshot("$ "), output("x", 2)]).attached)
        .mockResolvedValue(streamOf([snapshot("$ x")]).attached)
      const drawn: string[] = []
      const followed = followTerminal(optionsOf({ attach }), key, drawing(drawn))
      await idle()
      followed.park()
      await idle()
      followed.unpark()
      await idle()
      expect(asked(attach)).toEqual([undefined, undefined])
      expect(drawn).toEqual(["reset", "$ ", "x", "reset", "$ x"])
      followed.stop()
    })
  })

  context("when the screen fails to draw", () => {
    // A screen whose writes of `failing` reject, as the emulator's do once its buffer is in
    // doubt, recording what is drawn and whether a stream draws it.
    const failingOn = (failing: string, drawn: string[]) => ({
      ...drawing(drawn),
      write: async (data: string) => {
        drawn.push(data)
        if (data === failing) throw new Error("no such row")
      },
      live: (live: boolean) => void drawn.push(`live:${live}`),
    })

    it("lets go of the stream and draws the host's screen afresh, its shell not lost", async () => {
      const first = streamOf([snapshot("$ garbled")])
      const second = streamOf([snapshot("$ fresh")])
      const attach = attaching()
        .mockResolvedValueOnce(first.attached)
        .mockResolvedValue(second.attached)
      const lost = vi.fn<(key: string, error: unknown) => void>()
      const drawn: string[] = []
      const followed = followTerminal(
        optionsOf({ attach, on: { lost } }),
        key,
        failingOn("$ garbled", drawn),
      )
      await vi.waitFor(() =>
        expect(drawn).toEqual([
          "reset",
          "$ garbled",
          "live:false",
          "reset",
          "$ fresh",
          "live:true",
        ]),
      )
      expect(first.close).toHaveBeenCalled()
      expect(lost).not.toHaveBeenCalled()
      followed.stop()
    })

    it("draws afresh after output it failed to draw", async () => {
      const first = streamOf([snapshot("$ before"), output("garbled", 2), output("after", 3)])
      const attach = attaching()
        .mockResolvedValueOnce(first.attached)
        .mockResolvedValue(streamOf([snapshot("$ fresh")]).attached)
      const drawn: string[] = []
      const followed = followTerminal(optionsOf({ attach }), key, failingOn("garbled", drawn))
      await vi.waitFor(() => expect(drawn.at(-1)).toBe("live:true"))
      await vi.waitFor(() => expect(drawn.slice(-3)).toEqual(["reset", "$ fresh", "live:true"]))
      // The output after the one it failed is not drawn over the screen in doubt.
      expect(drawn).not.toContain("after")
      followed.stop()
    })

    it("waits longer after each failure in a row", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
      try {
        const attach = attaching().mockImplementation(
          async () => streamOf([snapshot("$ garbled")]).attached,
        )
        const followed = followTerminal(optionsOf({ attach }), key, failingOn("$ garbled", []))
        await vi.advanceTimersByTimeAsync(0)
        expect(attach).toHaveBeenCalledTimes(1)
        // 250 ms, then 500, then 1000.
        const waited = async (ms: number, calls: number): Promise<void> => {
          await vi.advanceTimersByTimeAsync(ms - 1)
          expect(attach).toHaveBeenCalledTimes(calls - 1)
          await vi.advanceTimersByTimeAsync(1)
          expect(attach).toHaveBeenCalledTimes(calls)
        }
        await waited(250, 2)
        await waited(500, 3)
        await waited(1000, 4)
        followed.stop()
      } finally {
        vi.useRealTimers()
      }
    })

    it("waits the least again after a minute without failing", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
      try {
        const streams: ReturnType<typeof streamOf>[] = []
        const attach = attaching().mockImplementation(async () => {
          const stream = streamOf([snapshot("$ fine")])
          streams.push(stream)
          return stream.attached
        })
        const drawn: string[] = []
        const followed = followTerminal(optionsOf({ attach }), key, failingOn("garbled", drawn))
        const fail = async (): Promise<void> => {
          streams.at(-1)!.push(output("garbled", 2))
          await vi.advanceTimersByTimeAsync(0)
        }
        await vi.advanceTimersByTimeAsync(0)
        // Two failures in a row: the second waits 500 ms.
        await fail()
        await vi.advanceTimersByTimeAsync(250)
        await fail()
        await vi.advanceTimersByTimeAsync(499)
        expect(attach).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(1)
        expect(attach).toHaveBeenCalledTimes(3)
        // A minute later, the next waits 250 ms again.
        await vi.advanceTimersByTimeAsync(60_000)
        await fail()
        await vi.advanceTimersByTimeAsync(249)
        expect(attach).toHaveBeenCalledTimes(3)
        await vi.advanceTimersByTimeAsync(1)
        expect(attach).toHaveBeenCalledTimes(4)
        followed.stop()
      } finally {
        vi.useRealTimers()
      }
    })

    it("waits no longer than 5 s", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
      try {
        const attach = attaching().mockImplementation(
          async () => streamOf([snapshot("$ garbled")]).attached,
        )
        const followed = followTerminal(optionsOf({ attach }), key, failingOn("$ garbled", []))
        await vi.advanceTimersByTimeAsync(0)
        // 250 + 500 + 1000 + 2000 + 4000 ms, then 5000 each.
        await vi.advanceTimersByTimeAsync(7_750)
        expect(attach).toHaveBeenCalledTimes(6)
        await vi.advanceTimersByTimeAsync(4_999)
        expect(attach).toHaveBeenCalledTimes(6)
        await vi.advanceTimersByTimeAsync(1)
        expect(attach).toHaveBeenCalledTimes(7)
        followed.stop()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

describe("following over the terminal library's stream", () => {
  // A stream of its own: events, then open until closed, recording what is sent through it.
  const stream = (events: readonly string[]) => {
    const queue = events.map((data) => snapshot(data))
    const sent: string[] = []
    let end: (() => void) | undefined
    const closed = new Promise<void>((resolve) => (end = resolve))
    const attached: AttachStream = {
      mode: "control",
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (queue.length) return { value: queue.shift()!, done: false }
          await closed
          return { value: undefined, done: true }
        },
      }),
      write: async (data) => void sent.push(`write ${data}`),
      resize: async (cols, rows) => void sent.push(`resize ${cols}x${rows}`),
      close: () => {
        sent.push("close")
        end?.()
      },
    }
    return { attached, sent }
  }

  it("asks its owner for the stream by key, and tells it how the stream goes", async () => {
    const { attached, sent } = stream(["$ "])
    const told: string[] = []
    const options: FollowOptions<string> = {
      attach: async (name) => {
        told.push(`attach ${name}`)
        return attached
      },
      lifecycle: () => shell(),
      connection: { getSnapshot: () => "connected", subscribe: () => () => {} },
      reconnected: async () => {},
      classify: () => "fatal",
      waitsAfter: () => false,
      on: {
        attached: (name) => {
          told.push(`attached ${name}`)
          return () => void told.push(`released ${name}`)
        },
        stage: (name, stage) => void told.push(`${name} ${stage}`),
        resized: (name, size) => void told.push(`${name} ${size.cols}x${size.rows}`),
      },
    }
    const drawn: string[] = []
    const followed = followTerminal(options, "mine", {
      ...drawing(drawn),
      fit: () => ({ cols: 100, rows: 30 }),
    })
    await vi.waitFor(() => expect(sent).toEqual(["resize 100x30"]))
    followed.input("ls\r")
    expect(sent).toEqual(["resize 100x30", "write ls\r"])
    expect(drawn).toEqual(["reset", "$ "])
    followed.stop()
    expect(sent.at(-1)).toBe("close")
    await vi.waitFor(() => expect(told).toContain("released mine"))
    expect(told).toEqual([
      "attach mine",
      "attached mine",
      "mine shown",
      "mine 100x30",
      "released mine",
    ])
  })

  it("lets the owner's classification decide whether a failed attach waits, retries or is lost", async () => {
    const lost: unknown[] = []
    const failure = new Error("no such terminal")
    const followed = followTerminal<string>(
      {
        attach: async () => {
          throw failure
        },
        lifecycle: () => shell(),
        connection: { getSnapshot: () => "connected", subscribe: () => () => {} },
        reconnected: async () => {},
        classify: () => "fatal",
        waitsAfter: () => false,
        on: { lost: (_name, error) => void lost.push(error) },
      },
      "mine",
      drawing([]),
    )
    await vi.waitFor(() => expect(lost).toEqual([failure]))
    followed.stop()
  })

  it("tells the owner once that an attach refused as busy has waited a while, and goes on asking", async () => {
    vi.useFakeTimers()
    try {
      const waiting: unknown[] = []
      const lost: unknown[] = []
      const refusal = new Error("in use")
      let attempts = 0
      const { attached } = streamOf([snapshot("$ ")], { ends: false })
      const followed = followTerminal<string>(
        {
          attach: async () => {
            attempts += 1
            if (attempts < 30) throw refusal
            return attached
          },
          lifecycle: () => shell(),
          connection: { getSnapshot: () => "connected", subscribe: () => () => {} },
          reconnected: async () => {},
          classify: () => "busy",
          waitsAfter: () => false,
          on: {
            waiting: (_key, error) => void waiting.push(error),
            lost: (_key, error) => void lost.push(error),
          },
        },
        "t",
        drawing([]),
      )
      await vi.advanceTimersByTimeAsync(busyToldMs - 500)
      expect(waiting).toEqual([])
      await vi.advanceTimersByTimeAsync(1_000)
      expect(waiting).toEqual([refusal])
      await vi.advanceTimersByTimeAsync(5_000)
      // Once, however long it takes, and never as lost.
      expect(waiting).toHaveLength(1)
      expect(lost).toEqual([])
      expect(attempts).toBeGreaterThan(10)
      followed.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
