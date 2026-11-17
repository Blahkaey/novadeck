import { createScreen, readScreen, type Screen } from "@novadeck/emulator/headless"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import type { AttachStream, TerminalEvent } from "../contract.js"
import { nativeStandIn } from "../testing.js"
import { followTerminal } from "../view/follow.js"
import { createStore, type ViewLink } from "../view/view-state.js"
import { createTerminal } from "./terminal.js"

type Size = { readonly cols: number; readonly rows: number }

const emulator = (): Screen => {
  const screen = createScreen({ cols: 80, rows: 24, scrollback: 1000 })
  onTestFinished(() => screen.dispose())
  return screen
}

const write = (screen: Screen, data: string) =>
  new Promise<void>((resolve) => screen.write(data, resolve))

// Everything a screen holds, its scrollback too, row by row, and where its cursor is.
const contents = (screen: Screen) => {
  const buffer = screen.buffer.active
  return {
    size: `${screen.cols}x${screen.rows}`,
    rows: Array.from({ length: buffer.length }, (_, row) =>
      buffer.getLine(row)?.translateToString(true),
    ),
    cursor: readScreen(screen).cursor,
  }
}

const visible = (screen: Screen) => readScreen(screen).rows.join("\n")

// A terminal hosted at 80x24 over a stand-in program, followed by a view whose screen is a
// headless emulator in a pane of `pane`'s size. The view's streams are the host's attachments,
// each event acknowledged as the next is asked for, standing at the last one's sequence; what
// each yielded is kept, in turn.
const followed = () => {
  const program = nativeStandIn()
  const terminal = createTerminal({
    eventBytes: (event) => Buffer.byteLength(JSON.stringify(event)),
    limits: {
      historyBytes: 1024 * 1024,
      subscriberBytes: 4 * 1024 * 1024,
      ackWindowBytes: 256 * 1024,
      snapshotBytes: 32 * 1024 * 1024,
    },
    spec: { file: "shell", args: [], cwd: "/", env: {}, cols: 80, rows: 24 },
    scrollback: 1000,
    controller: undefined,
    pty: { native: program.spawn, platform: "linux" },
  })
  onTestFinished(() => terminal.dispose())
  const streams: TerminalEvent[][] = []
  const attach = async (_key: string, after?: number): Promise<AttachStream<number>> => {
    const attachment = await terminal.enqueue(() =>
      terminal.attach("view", { after, mode: "control" }),
    )
    const yielded: TerminalEvent[] = []
    streams.push(yielded)
    let last: number | undefined
    return {
      mode: "control",
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<TerminalEvent>> => {
          if (last !== undefined) terminal.ack("view", last)
          const event = await attachment.next()
          if (!event) return { done: true, value: undefined }
          yielded.push(event)
          last = event.sequence
          return { done: false, value: event }
        },
      }),
      write: async (data) => terminal.input(data),
      resize: async (cols, rows) => terminal.resize(cols, rows, "view"),
      close: () => terminal.release("view"),
      position: () => last,
    }
  }
  const screen = emulator()
  let pane: Size | undefined = { cols: 80, rows: 24 }
  const view = followTerminal(
    {
      attach,
      lifecycle: () => ({
        ready: Promise.resolve(true),
        revived: new Promise<void>(() => {}),
        closed: false,
        size: { cols: 80, rows: 24 },
      }),
      connection: createStore<ViewLink>("connected"),
      reconnected: async () => {},
      classify: () => "fatal",
      waitsAfter: () => false,
    },
    "t",
    {
      write: (data) => write(screen, data),
      reset: () => screen.reset(),
      resize: ({ cols, rows }) => screen.resize(cols, rows),
      fit: () => pane,
      exited: () => {},
      live: () => {},
    },
  )
  onTestFinished(() => view.stop())
  // The program draws `text`, which the host has drawn once this resolves.
  const draws = async (text: string) => {
    program.draw(text)
    await terminal.enqueue(() => {})
  }
  // The screen a viewer attaching now is sent, drawn afresh.
  const snapshot = async () => {
    const attachment = await terminal.enqueue(() => terminal.attach("fresh", { mode: "observe" }))
    const event = await attachment.next()
    terminal.release("fresh")
    if (event?.type !== "snapshot") throw new Error("A fresh attachment opens with its screen.")
    const fresh = emulator()
    fresh.resize(event.cols, event.rows)
    await write(fresh, event.data)
    return contents(fresh)
  }
  return {
    program,
    view,
    screen,
    streams,
    draws,
    snapshot,
    sized: (size: Size | undefined) => {
      pane = size
    },
  }
}

// A TUI's frame for a screen of `cols` by `rows`: lines that scroll, then a status line on its
// bottom row and a mark at its right-hand edge, placed by cursor position, as an agent draws.
const frame = (label: string, { cols, rows }: Size) =>
  `${Array.from({ length: 30 }, (_, line) => `${label} ${line}\r\n`).join("")}` +
  `\x1b[${rows};1Hstatus ${label}\x1b[1;${cols - 4}HEDGE`

describe("a hosted terminal's screen shown again after it parked", () => {
  it("draws what came since at the size it was made for, then takes the pane's where the host did", async () => {
    const { program, view, screen, streams, draws, snapshot, sized } = followed()
    await draws("$ before\r\n")
    await vi.waitFor(() => expect(visible(screen)).toContain("$ before"))
    view.park()
    await draws(frame("parked", { cols: 80, rows: 24 }))
    // Shown again in a pane of another size, as a Grid tile opened in Focus is.
    sized({ cols: 100, rows: 30 })
    view.unpark()
    await vi.waitFor(() => expect(program.calls).toContain("resize 100x30"))
    await draws(frame("resized", { cols: 100, rows: 30 }))
    await vi.waitFor(() => expect(visible(screen)).toContain("status resized"))
    // It went on from what it kept: what came since, with no screen of the host's.
    expect(streams).toHaveLength(2)
    expect(streams[1]!.map((event) => event.type)).not.toContain("snapshot")
    expect(contents(screen)).toEqual(await snapshot())
  })

  it("goes on with no resize where the pane kept its size", async () => {
    const { program, view, screen, streams, draws, snapshot } = followed()
    await draws("$ before\r\n")
    await vi.waitFor(() => expect(visible(screen)).toContain("$ before"))
    view.park()
    await draws(frame("parked", { cols: 80, rows: 24 }))
    view.unpark()
    await vi.waitFor(() => expect(visible(screen)).toContain("status parked"))
    expect(streams[1]!.map((event) => event.type)).not.toContain("snapshot")
    expect(program.calls.filter((call) => call.startsWith("resize"))).toEqual([])
    expect(contents(screen)).toEqual(await snapshot())
  })
})
