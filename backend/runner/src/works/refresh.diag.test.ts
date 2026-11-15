/* eslint-disable no-await-in-loop, no-unmodified-loop-condition -- A diagnostic that polls what a stream sets. */
// DIAGNOSTIC, not to merge: how often the works read a checkout, and how long a change takes to
// be told, with the runner's own timings (every 3 s, slow past 1 s), on repositories of a few
// sizes. Prints one WORKS-REFRESH block per size.
import { execFileSync } from "node:child_process"
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { timing } from "../checkouts/git.js"
import { Snapshots } from "../checkouts/snapshots.js"
import { describe, it } from "../test.js"
import { Works } from "./works.js"

const terminalId = "00000000-0000-4000-8000-000000000001"
const project = "22222222-2222-4222-8222-222222222222"

const repository = (files: number): { root: string; done: () => void } => {
  const holder = realpathSync.native(mkdtempSync(join(tmpdir(), "novadeck-works-refresh-")))
  const config = join(holder, "gitconfig")
  writeFileSync(config, "[core]\n\tautocrlf = false\n")
  const root = join(holder, "repo")
  mkdirSync(root)
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...args], {
      cwd: root,
      env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" },
      stdio: "ignore",
    })
  git("init", "--quiet", "-b", "main")
  for (let at = 0; at < files; at += 1) {
    const folder = join(root, `d${at % 50}`)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, `f${at}.txt`), `file ${at}\n`)
  }
  git("add", "-A")
  git("commit", "--quiet", "-m", "first")
  return { root, done: () => rmSync(holder, { recursive: true, force: true, maxRetries: 5 }) }
}

const sizes = [2, 1000, 5000] as const

describe("DIAGNOSTIC works refresh", () => {
  for (const files of sizes)
    it(`reads a repository of ${files} files`, { timeout: 240_000 }, async ({ resources }) => {
      const made = Date.now()
      const { root, done } = repository(files)
      resources.defer(done)
      const setupMs = Date.now() - made
      const start = performance.now()
      const ms = () => Math.round(performance.now() - start)
      // Each pass starts by asking for the presences; each git run between two passes is a read.
      const passes: { at: number; gits: number; lastGit: number }[] = []
      const before = timing.saw
      timing.saw = () => {
        const pass = passes.at(-1)
        if (pass) {
          pass.gits += 1
          pass.lastGit = ms()
        }
      }
      resources.defer(() => {
        timing.saw = before
      })
      const snapshots = new Snapshots({ held: () => () => false })
      const works = new Works({
        tracked: () => [{ root, projectId: project, terminalId, createdAt: 50 }],
        presences: async () => {
          passes.push({ at: ms(), gits: 0, lastGit: ms() })
          return [{ terminalId, root, working: false }]
        },
        show: async () => "item",
        remove: async () => ({ ok: true, branchDeleted: false }),
        firstMs: 200_000,
        coldMs: 200_000,
        snapshots,
      })
      resources.defer(async () => {
        await works.close()
        await snapshots.close()
      })
      const stop = new AbortController()
      resources.defer(() => stop.abort())
      let added = -1
      let synced = false
      const told: { at: number; added: number }[] = []
      void (async () => {
        for await (const change of works.watch("owner", stop.signal)) {
          if (change.type === "synced") synced = true
          if (change.type === "changed") {
            added = change.work.added
            told.push({ at: ms(), added })
          }
        }
      })()
      while (!synced) await new Promise((resolve) => setTimeout(resolve, 20))
      const samples = files >= 5000 ? 4 : 8
      const latencies: number[] = []
      for (let sample = 0; sample < samples; sample += 1) {
        // A change at some moment of the poll's cycle, as a person's edit comes.
        await new Promise((resolve) => setTimeout(resolve, 700 * ((sample * 3) % 5)))
        const wrote = ms()
        appendFileSync(join(root, "d0", "f0.txt"), `edit ${sample}\n`)
        const want = sample + 1
        while (added < want && ms() - wrote < 60_000)
          await new Promise((resolve) => setTimeout(resolve, 10))
        latencies.push(ms() - wrote)
      }
      stop.abort()
      const reads = passes.filter((pass) => pass.gits > 0)
      const readMs = reads.map((pass) => pass.lastGit - pass.at)
      const between = reads.slice(1).map((pass, at) => pass.at - reads[at]!.at)
      console.log(
        `WORKS-REFRESH ${JSON.stringify({
          platform: process.platform,
          files,
          setupMs,
          passes: passes.length,
          reads: reads.length,
          gitsPerRead: reads.map((pass) => pass.gits),
          readMs,
          betweenReadsMs: between,
          changeToToldMs: latencies,
        })}`,
      )
    })
})
