// PROBE, not a test of Novadeck: what Antigravity's input box shows at its idle prompt under
// each `--mode`: the "<Mode> mode: … (shift+tab to cycle)" hint, whether its cells are dim,
// and whether a typed word replaces it. Runs only with NOVADECK_E2E_PROBES=1, by path;
// writes $PROBE_OUT/agy-mode-hint-<pin|latest>.json, each state a `ScreenRecord` plus the
// style runs of the box's row; the adapter's fixtures/mode-hint.probe.json is a copy.
/* eslint-disable no-await-in-loop -- A probe's steps run in order, each after the screen settles. */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createScreen, readScreen } from "@novadeck/emulator/headless"
import { screenRecord } from "@novadeck/harness-core/testing/probes"

import { agy } from "../agents/agy.js"
import { describe, e2e, supported } from "../fixture.js"
import { prompted } from "../scenarios.js"
import { probing, sleep } from "./support.js"

describe.skipIf(!supported || !probing)(`probe: mode hint of ${agy.name}`, () => {
  const it = e2e(agy)
  it(
    "each mode's idle box, empty and with a typed word",
    { timeout: 300_000 },
    async ({ e2e: run }) => {
      const out: Record<string, unknown> = {}
      for (const mode of ["default", "accept-edits", "plan", "auto"]) {
        const t = await run.deck.open(`agy --mode ${mode}`)
        await t.reached("ready", { timeoutMs: 60_000 }).catch(() => undefined)
        await prompted(t, agy).catch(() => undefined)
        const raw = (data: string) => run.deck.terminals.write({ terminalId: t.id, data }, "e2e")
        const look = async (label: string) => {
          const { terminals } = run.deck
          const controller = new AbortController()
          const stream = terminals.attach(
            { terminalId: t.id, mode: "observe" },
            "reader",
            controller.signal,
          )
          try {
            for await (const event of stream) {
              if (event.type !== "snapshot") continue
              const { cols, rows } = terminals.get(t.id)
              const screen = createScreen({ cols, rows, scrollback: 0 })
              await new Promise<void>((resolve) => screen.write(event.data, resolve))
              const buffer = screen.buffer.active
              const styles: Record<number, unknown[]> = {}
              const cell = buffer.getNullCell()
              for (let row = 0; row < rows; row += 1) {
                const line = buffer.getLine(buffer.viewportY + row)
                if (!line || line.translateToString(true).trim() === "") continue
                const runs: { text: string; style: string }[] = []
                for (let column = 0; column < cols; column += 1) {
                  const at = line.getCell(column, cell)
                  if (!at || at.getWidth() === 0) continue
                  const style = [
                    at.isDim() ? "dim" : "",
                    at.isBold() ? "bold" : "",
                    at.isInverse() ? "inv" : "",
                    at.isItalic() ? "ital" : "",
                    at.isFgDefault() ? "" : `fg${at.isFgPalette() ? "p" : "rgb"}${at.getFgColor()}`,
                    at.isBgDefault() ? "" : `bg${at.isBgPalette() ? "p" : "rgb"}${at.getBgColor()}`,
                  ]
                    .filter(Boolean)
                    .join(",")
                  const last = runs.at(-1)
                  if (last && last.style === style) last.text += at.getChars() || " "
                  else runs.push({ text: at.getChars() || " ", style })
                }
                styles[row] = runs
              }
              out[label] = { ...screenRecord(readScreen(screen)), styles }
              screen.dispose()
              return
            }
          } finally {
            controller.abort()
            await stream.return(undefined)
          }
        }
        await sleep(2000)
        await look(`${mode} empty`)
        raw("hello")
        await sleep(1000)
        await look(`${mode} typed`)
        await run.deck.terminals.close({ terminalId: t.id })
      }
      const dir = process.env.PROBE_OUT ?? join(run.sandbox.root, "probe-out")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, `agy-mode-hint-${process.env.NOVADECK_E2E_HARNESS ?? "pin"}.json`),
        JSON.stringify(out, null, 2),
      )
    },
  )
})
