import type { AttachStream, Exit, TerminalEvent } from "../contract.js"
import type { Store, ViewLink } from "./view-state.js"

// A terminal's shell as following it needs to know it: when it is ready to attach to, when
// a fresh one replaces it, and whether it is gone. The fields are read as they stand, so an
// owner may hand over the live record.
export type Lifecycle = {
  // Resolves once a shell runs, with whether one does.
  readonly ready: Promise<boolean>
  // Resolves once a fresh shell replaces an ended one.
  readonly revived: Promise<void>
  readonly closed: boolean
  // The size a fresh shell starts with.
  readonly size: { readonly cols: number; readonly rows: number }
}

// What the view tells its owner as it goes.
export type ViewEvents<K> = {
  // The stream saw the shell exit, in order with its output.
  readonly exited?: (key: K, exit: Exit) => void
  // The size that fit.
  readonly resized?: (key: K, size: { readonly cols: number; readonly rows: number }) => void
  // The screen's stage: mounted, first screen drawn, or gone.
  readonly stage?: (key: K, stage: "mounted" | "shown" | "gone") => void
  // Why the terminal could not be followed.
  readonly lost?: (key: K, error: unknown) => void
  // The stream, until the returned release; the owner may note it.
  readonly attached?: (key: K, stream: AttachStream) => () => void
}

// What following a terminal asks of its owner. `P` is where the owner's streams stand
// (`AttachStream.position`), which the view hands back without reading it.
export type FollowOptions<K, P = unknown> = {
  // Attaches to the terminal. `after` is where an earlier stream stood after the last event
  // the screen drew, for the stream to go on from with the events since; an owner that can't
  // starts it with a snapshot, as without one.
  readonly attach: (key: K, after?: P) => Promise<AttachStream<P>>
  readonly lifecycle: (key: K) => Lifecycle | undefined
  // How the link is doing; a stream takes up again when it comes back.
  readonly connection: Store<ViewLink>
  // Resolves once the link is reachable again, or closed for good.
  readonly reconnected: () => Promise<void>
  // How an attach that failed should go on: try again shortly while busy, wait for the link
  // while offline, give up and tell of it otherwise.
  readonly classify: (error: unknown) => "busy" | "offline" | "fatal"
  // Whether a shell that exited like this waits for Enter to start again.
  readonly waitsAfter: (exit: Exit) => boolean
  // Counts the promise as outstanding I/O until it settles.
  readonly track?: <T>(work: Promise<T>) => Promise<T>
  readonly on?: ViewEvents<K>
}

// The screen a terminal draws on, reduced to what following it needs.
export type Screen = {
  // Rejects when the emulator could not draw it, which leaves the screen in doubt.
  readonly write: (data: string) => Promise<void>
  readonly reset: () => void
  readonly resize: (size: { readonly cols: number; readonly rows: number }) => void
  // The size that fits the element now; undefined while it has no room, as when hidden.
  readonly fit: () => { readonly cols: number; readonly rows: number } | undefined
  // Called in stream order once the shell has exited, after its last output is drawn,
  // with whether it waits for Enter to start again.
  readonly exited: (waiting: boolean) => void
  // Whether a stream is drawing the current shell: true once its screen arrived, false
  // once a park let go of the stream or it ended, or while it takes up again after a
  // reconnection (`resuming`). Input goes nowhere in between.
  readonly live: (live: boolean, resuming?: boolean) => void
  // How long the screen gathers output before drawing it, in ms; 0 or absent draws each as
  // it comes. Output that arrives meanwhile is drawn in one write, and anything else the
  // stream sends ends the wait, so every event still applies in order after what came first.
  readonly pace?: () => number
  // Resolves once the pace changes, which ends a wait at once, as when the terminal is
  // selected.
  readonly paced?: () => Promise<void>
}

// The most output a paced screen gathers before drawing it: a flood draws in steps, and what
// waits stays small.
const gatherCap = 256 * 1024

// An event as the view read it, with where its stream stood once it had: where the screen
// stands once it has drawn the event.
type Read<P> = { readonly event: TerminalEvent; readonly at: P | undefined }

export type FollowedTerminal = {
  // Sends typed input; dropped while there is no attachment.
  readonly input: (data: string) => void
  // Tells the owner the size that fits now, and the stream if it changed, fitting the screen to
  // it at once, or, while the screen waits for the host's answer, where the host takes it.
  // Whether it sent the stream a size it had not sent before.
  readonly refit: () => boolean
  // Lets go of the stream while no view shows the terminal, so its output costs nothing
  // here while the screen keeps what it last drew; `unpark` attaches again, going on from
  // the last event the screen drew, so the host sends what came since, or its fresh screen
  // where it can't. A fresh shell started meanwhile waits for it too.
  readonly park: () => void
  readonly unpark: () => void
  readonly stop: () => void
}

// Resolves after `ms` milliseconds.
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// How long a screen that failed to draw waits before it attaches again: the first, doubling
// with each failure in a row up to the most. A failure `apart` after the one before it is the
// first again. One that fails on every snapshot, or soon after each, settles at a redraw every
// `most`: short, as the screen shows "Loading output…" meanwhile, and a snapshot costs little.
const redrawMs = { first: 250, most: 5_000, apart: 60_000 }

// Attaches to the terminal, draws what it sends, and passes input and size back until
// stopped. When its shell exits, or the host loses it, the view waits for a fresh
// shell and attaches again. A terminal another window controls is reported instead. A
// screen that failed to draw lets go of the stream and attaches again, for a fresh screen
// from the host: the shell is fine, only what this screen shows is in doubt.
export const followTerminal = <K, P = unknown>(
  options: FollowOptions<K, P>,
  key: K,
  screen: Screen,
): FollowedTerminal => {
  const { on, lifecycle, connection } = options
  const track = options.track ?? (<T>(work: Promise<T>): Promise<T> => work)
  let stopped = false
  let stop: (() => void) | undefined
  const halted = new Promise<void>((resolve) => {
    stop = resolve
  })
  let attachment: AttachStream<P> | undefined
  // The size last sent, or told by the host.
  let sent: string | undefined
  // The host's size as of the last event drawn: a snapshot's, or the last resize's.
  let hostSize: string | undefined
  // Resolves once the stream may attach, as it may unless parked.
  let unparked: Promise<void> | undefined
  let wake: (() => void) | undefined
  // A park ended the stream: the same shell runs on, so it attaches again, even when
  // shown before the stream wound down.
  let cut = false
  // Where the stream stood after the last event the screen drew, which the attach after a
  // park goes on from. None once the screen is in doubt, or once a stream ended other than by
  // a park: an exited, replaced or lost shell has nothing to go on from.
  let drawnTo: P | undefined
  // A stream that went on from what the screen kept, until it draws its first resize: one made
  // in another window while this screen was parked, which it takes the pane's size back from,
  // as a snapshot's fit does.
  let reclaim = false
  // While set, the screen takes no size of its own, only the host's: what the host sends before
  // it takes the pane's size was made at the size before, so the screen takes the pane's at the
  // `resized` the host answers with (`awaited`), in its place among the events. Set as a stream
  // that went on from what the screen kept starts, and as it takes a size back; over once the
  // pane is the host's size, the host answers, a snapshot comes, or the stream ends.
  let holding = false
  let awaited: string | undefined
  // The failures to draw in a row, and when the last was.
  let failures = 0
  let failedAt = 0
  const refit = (): boolean => {
    const size = screen.fit()
    if (size) on?.resized?.(key, size)
    if (!size || !attachment) return false
    if (!holding) screen.resize(size)
    const next = `${size.cols}x${size.rows}`
    if (next === sent) {
      holding &&= awaited !== undefined
      return false
    }
    sent = next
    if (holding) awaited = next
    const attached = attachment
    void attached.resize(size.cols, size.rows).catch(() => {
      sent = undefined
      // Busy or reconnecting: try again while this stream lasts.
      setTimeout(() => {
        if (attachment === attached) refit()
      }, 500)
    })
    return true
  }
  // The stream draws the current shell on the screen, whose input goes to it from now on.
  const shown = (): void => {
    // A park that came meanwhile has let go of this stream already.
    if (!unparked) screen.live(true)
    on?.stage?.(key, "shown")
  }
  const apply = async (event: TerminalEvent): Promise<void> => {
    if (event.type === "snapshot") {
      screen.reset()
      screen.resize(event)
      sent = hostSize = `${event.cols}x${event.rows}`
      // The host's screen as it is, at its size: nothing before it waits to be drawn.
      holding = false
      awaited = undefined
      await screen.write(event.data)
      shown()
      if (event.exit) {
        on?.exited?.(key, event.exit)
        screen.exited(options.waitsAfter(event.exit))
      }
      refit()
    } else if (event.type === "output") await screen.write(event.data)
    else if (event.type === "exited") {
      on?.exited?.(key, event.exit)
      screen.exited(options.waitsAfter(event.exit))
    } else if (event.type === "resized") {
      sent = hostSize = `${event.cols}x${event.rows}`
      screen.resize(event)
      if (sent === awaited) {
        holding = false
        awaited = undefined
      }
      if (reclaim) {
        reclaim = false
        holding = true
        refit()
      }
    }
  }
  const wanted = (entry: Lifecycle): boolean => !stopped && !unparked && !entry.closed
  // Attaches, going on after `after` where given, retrying after the host comes back;
  // undefined when it cannot, or once parked, which marks the stream cut.
  const open = async (
    entry: Lifecycle,
    after: P | undefined,
  ): Promise<AttachStream<P> | undefined> => {
    while (wanted(entry)) {
      try {
        // eslint-disable-next-line no-await-in-loop -- Retry after the host comes back.
        const attached = await options.attach(key, after)
        if (wanted(entry)) return attached
        cut ||= Boolean(unparked)
        // Release before giving up.
        attached.close()
        return undefined
      } catch (error) {
        const failure = options.classify(error)
        if (failure === "busy") {
          // Too many calls in flight: try again shortly.
          // eslint-disable-next-line no-await-in-loop -- Back off before trying again.
          await Promise.race([pause(300), halted])
          continue
        }
        if (failure !== "offline") {
          on?.lost?.(key, error)
          return undefined
        }
        // eslint-disable-next-line no-await-in-loop -- Wait for the host to come back.
        await Promise.race([options.reconnected(), halted])
      }
    }
    cut ||= Boolean(unparked)
    return undefined
  }
  // Follows the stream until it ends; whether the screen failed to draw it. One that goes on
  // from what the screen kept (`resumed`) brings no snapshot to make it live: it is once
  // granted. It sends the pane's size where the pane changed meanwhile, and keeps drawing at
  // the host's until the host answers (`holding`). A resize made elsewhere meanwhile comes
  // among the events since (`reclaim`).
  const follow = async (attached: AttachStream<P>, resumed: boolean): Promise<boolean> => {
    attachment = attached
    reclaim = resumed
    holding = resumed
    awaited = undefined
    const release = on?.attached?.(key, attached)
    if (resumed) {
      shown()
      // Where the host stood at the last event drawn, whatever was sent after it.
      sent = hostSize
      refit()
    }
    let failed = false
    try {
      // Read by hand, so a paced screen can look ahead for output to draw with what it has.
      const events = attached[Symbol.asyncIterator]()
      let ahead: Promise<Read<P> | undefined> | undefined
      // Where the stream stands is taken as each read lands, before the next is asked for.
      const pull = (): Promise<Read<P> | undefined> =>
        (ahead ??= events
          .next()
          .then((read) =>
            read.done ? undefined : { event: read.value, at: attached.position?.() },
          ))
      // The events to apply next, from `first`: on a paced screen, its output with what
      // follows it within the pace, up to the first event of another kind, which comes after.
      // Output drawn as one stands where the last of it did.
      const gather = async (
        first: Read<P>,
      ): Promise<{ readonly batch: readonly Read<P>[]; readonly ended: boolean }> => {
        const ms = screen.pace?.() ?? 0
        if (first.event.type !== "output" || !ms) return { batch: [first], ended: false }
        let output = first.event
        let { at } = first
        const deadline = Date.now() + ms
        const changed = screen.paced?.() ?? new Promise<void>(() => {})
        while (output.data.length < gatherCap) {
          let timer: ReturnType<typeof setTimeout> | undefined
          const waited = new Promise<"waited">((resolve) => {
            timer = setTimeout(() => resolve("waited"), Math.max(0, deadline - Date.now()))
          })
          try {
            // eslint-disable-next-line no-await-in-loop -- One event after another, until the pace is up.
            const next = await Promise.race([
              pull(),
              waited,
              changed.then(() => "waited" as const),
              halted.then(() => "waited" as const),
            ])
            if (next === "waited") break
            ahead = undefined
            if (!next) return { batch: [{ event: output, at }], ended: true }
            if (next.event.type !== "output")
              return { batch: [{ event: output, at }, next], ended: false }
            output = { ...next.event, data: output.data + next.event.data }
            at = next.at
          } finally {
            clearTimeout(timer)
          }
        }
        return { batch: [{ event: output, at }], ended: false }
      }
      let ended = false
      try {
        // `stopped` changes through `stop`, out of the loop's sight.
        const going = (): boolean => !stopped && !ended && !failed
        while (going()) {
          // eslint-disable-next-line no-await-in-loop -- Drawing paces acknowledgement.
          const read = await pull()
          ahead = undefined
          if (!read) break
          // eslint-disable-next-line no-await-in-loop -- As above.
          const gathered = await gather(read)
          ended = gathered.ended
          for (const { event, at } of gathered.batch) {
            if (stopped) break
            try {
              // eslint-disable-next-line no-await-in-loop -- Drawing paces acknowledgement.
              await apply(event)
            } catch {
              // The screen is in doubt; the emulator threw the error again, for the page's log.
              failed = !stopped
              drawnTo = undefined
              break
            }
            drawnTo = at
          }
        }
      } finally {
        // As a for-await loop left early does: the stream is told it is no longer read.
        if (!ended) void events.return?.()
      }
    } catch (error) {
      if (!stopped) on?.lost?.(key, error)
    } finally {
      release?.()
      // Held for an answer that never came, as a terminal that exited while parked gives none:
      // the screen takes the pane's size, as it would have after a snapshot. One parked again
      // keeps the host's, which the events it goes on from next were made at.
      const size = holding && !cut && screen.fit()
      if (size) screen.resize(size)
      attachment = undefined
      screen.live(false)
    }
    if (failed) attached.close()
    return failed
  }
  // A function, as the loop's condition changes through `stop`, out of its sight.
  const running = (): boolean => !stopped
  const run = async (): Promise<void> => {
    while (running()) {
      const entry = lifecycle(key)
      if (!entry || entry.closed) return
      // eslint-disable-next-line no-await-in-loop -- Parked, it attaches once shown again.
      if (unparked) await Promise.race([unparked, halted])
      // Taken before attaching, so a fresh shell started meanwhile is not missed; and after
      // a park, so one started while parked, which it attaches to, doesn't count again.
      const { revived } = entry
      // eslint-disable-next-line no-await-in-loop -- The shell must exist first.
      const ready = await Promise.race([entry.ready, halted])
      // Parked while it started: it attaches once shown.
      if (unparked) continue
      const after = drawnTo
      // eslint-disable-next-line no-await-in-loop -- Then attach to it.
      const attached = ready && (await track(open(entry, after)))
      // eslint-disable-next-line no-await-in-loop -- One attachment at a time.
      const failed = attached && (await follow(attached, after !== undefined))
      if (!cut) drawnTo = undefined
      if (cut || unparked) {
        cut = false
        continue
      }
      if (failed) {
        const now = Date.now()
        failures = now - failedAt >= redrawMs.apart ? 1 : failures + 1
        failedAt = now
        const wait = Math.min(redrawMs.first * 2 ** (failures - 1), redrawMs.most)
        // eslint-disable-next-line no-await-in-loop -- Back off before drawing again.
        await Promise.race([pause(wait), halted])
        continue
      }
      // eslint-disable-next-line no-await-in-loop -- Wait for a fresh shell.
      await Promise.race([revived, halted])
    }
  }
  void run()
  // After a reconnection the attachment takes up again on its own, without a new screen.
  // Until a call through it succeeds, input would be lost, so the view stays locked;
  // re-sending the current size is a harmless call to find out.
  let resumes = 0
  const resume = async (attached: AttachStream<P>): Promise<void> => {
    const turn = (resumes += 1)
    screen.live(false, true)
    const current = (): boolean =>
      !stopped && !unparked && attachment === attached && turn === resumes
    while (current()) {
      const size = lifecycle(key)?.size ?? screen.fit()
      try {
        // eslint-disable-next-line no-await-in-loop -- One probe at a time.
        if (size) await attached.resize(size.cols, size.rows)
        if (current()) screen.live(true)
        return
      } catch {
        // eslint-disable-next-line no-await-in-loop -- Still reattaching; look again soon.
        await Promise.race([pause(200), halted])
      }
    }
  }
  let previous = connection.getSnapshot()
  const unsubscribe = connection.subscribe(() => {
    const state = connection.getSnapshot()
    const back = previous !== "connected" && state === "connected"
    previous = state
    if (back && attachment) void resume(attachment)
  })
  return {
    input: (data) => {
      const entry = lifecycle(key)
      if (!attachment || !entry || entry.closed) return
      void attachment.write(data).catch(() => {})
    },
    refit,
    park: () => {
      if (stopped || unparked) return
      unparked = new Promise((resolve) => {
        wake = resolve
      })
      if (!attachment) return
      cut = true
      // Nothing draws it from now on, though the stream ends a moment later.
      screen.live(false)
      attachment.close()
    },
    unpark: () => {
      if (!unparked) return
      unparked = undefined
      wake?.()
    },
    stop: () => {
      unsubscribe()
      stopped = true
      stop?.()
      const attached = attachment
      attachment = undefined
      attached?.close()
    },
  }
}
