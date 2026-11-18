import { describe, expect, it } from "vitest"
import type { z } from "zod"

import {
  changeFileDiff,
  companionItem,
  companionLimits,
  itemContent,
  maxChangeSideBytes,
  pageLook,
  pageLookAnswer,
  planUnwritable,
} from "./companions.js"

const lookId = "11111111-1111-4111-8111-111111111111"
const itemId = "22222222-2222-4222-8222-222222222222"
// A dev server's callback, its query holding a token, as long as a page item's address runs.
const longAddress = `http://localhost:3000/callback?state=${"x".repeat(3000)}`

const maxOf = (schema: z.ZodString): number => schema.maxLength!

// A value one schema carries into another must fit the second wherever it fits the first, or
// the runner's check of what it sends fails the call or ends the stream it goes out on.
describe("an address carried from a page item", () => {
  const itemUrl = maxOf(companionItem.shape.url.unwrap())

  it("fits the page's content", () => {
    const page = itemContent.options[0].shape.content.options[2]
    expect(maxOf(page.shape.url)).toBeGreaterThanOrEqual(itemUrl)
  })

  it("fits a look at the page", () => {
    expect(maxOf(pageLook.shape.url)).toBeGreaterThanOrEqual(itemUrl)
  })

  it("fits the look's answer, which says where the page is", () => {
    expect(maxOf(pageLookAnswer.options[0].shape.url)).toBeGreaterThanOrEqual(itemUrl)
  })
})

describe("a look at a page with a long address", () => {
  it("goes out to the client", () => {
    expect(pageLook.parse({ lookId, itemId, shown: 1, url: longAddress }).url).toBe(longAddress)
  })

  it("comes back answered", () => {
    const answer = {
      lookId,
      picture: "data:image/jpeg;base64,AAAA",
      url: longAddress,
      title: "Callback",
      taken: "pane" as const,
      size: { width: 1280, height: 800 },
      troubles: [],
    }
    expect(pageLookAnswer.parse(answer)).toEqual(answer)
  })
})

describe("a change as layers", () => {
  const file = {
    path: "src/a.ts",
    oldPath: null,
    status: "modified" as const,
    added: 1,
    removed: 1,
    reindented: 2,
    binary: false,
    secret: false,
  }
  const layer = {
    id: "a".repeat(64),
    kind: "commit" as const,
    subject: "Move the check",
    time: 1_700_000_000_000,
    added: 1,
    removed: 1,
    files: [file],
    truncated: false,
  }

  it("carries each layer's files with their counts, and no diff, and the files read", () => {
    const ready = {
      state: "ready" as const,
      stamp: "s",
      content: {
        kind: "changes" as const,
        root: "/repo",
        base: "main",
        layers: [layer],
        files: [file],
        read: [file.path],
        truncated: false,
      },
    }
    expect(itemContent.parse(ready)).toEqual(ready)
    expect(
      itemContent.safeParse({
        ...ready,
        content: { ...ready.content, layers: [{ ...layer, files: [{ ...file, hunks: [] }] }] },
      }).success,
    ).toBe(false)
  })

  it("carries one file's run: its hunks and the text of both sides", () => {
    const diff = {
      run: {
        layers: ["uncommitted", layer.id],
        file,
        big: false,
        badName: false,
        hunks: [
          {
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 1,
            lines: [
              { kind: "remove" as const, text: "a" },
              { kind: "add" as const, text: "b" },
            ],
          },
        ],
        before: "a\n",
        after: "b\n",
      },
    }
    expect(changeFileDiff.parse(diff)).toEqual(diff)
    expect(changeFileDiff.parse({ run: null })).toEqual({ run: null })
    expect(changeFileDiff.safeParse({ run: { ...diff.run, layers: [] } }).success).toBe(false)
  })

  it("lets a side be as long as the runner reads, and no longer", () => {
    const run = {
      layers: ["uncommitted"],
      file,
      big: false,
      badName: false,
      hunks: [],
      before: null,
      after: "x".repeat(maxChangeSideBytes),
    }
    expect(changeFileDiff.safeParse({ run }).success).toBe(true)
    expect(changeFileDiff.safeParse({ run: { ...run, after: `${run.after}x` } }).success).toBe(
      false,
    )
  })
})

describe("a file followed to be edited", () => {
  const text = { kind: "text" as const, path: "/p/a.ts", text: "a\r\nb" }
  const ready = (content: unknown) => ({ state: "ready", stamp: "s", content })

  it("carries its whole text, writable, or not with why", () => {
    for (const content of [
      { ...text, writable: true },
      { ...text, writable: false, reason: "outside" },
      { ...text, writable: false, reason: "folder" },
      { ...text, writable: false, reason: "not-a-plan" },
    ])
      expect(itemContent.parse(ready(content))).toEqual(ready(content))
  })

  it("says why only where it can't be saved, and only why it can't up front", () => {
    for (const content of [
      { ...text, writable: true, reason: "outside" },
      { ...text, writable: false },
      { ...text, writable: false, reason: "moved" },
      { ...text, writable: true, text: "x".repeat(companionLimits.plan + 1) },
    ])
      expect(itemContent.safeParse(ready(content)).success).toBe(false)
  })

  it("is its listing, saying why it can't be edited whole", () => {
    const listing = {
      kind: "file",
      path: "/p/big.log",
      firstLine: 1,
      lines: ["a"],
      from: 1,
      to: 1,
      total: null,
      truncated: true,
      clamped: false,
    }
    for (const uneditable of ["too-large", "not-text"])
      expect(itemContent.parse(ready({ ...listing, uneditable }))).toEqual(
        ready({ ...listing, uneditable }),
      )
    expect(itemContent.parse(ready(listing))).toEqual(ready(listing))
    expect(itemContent.safeParse(ready({ ...listing, uneditable: "binary" })).success).toBe(false)
  })

  it("is refused saving, saying why, as an edit made on another file or a file no longer text", () => {
    for (const reason of ["moved", "not-text"])
      expect(planUnwritable.parse({ reason })).toEqual({ reason })
  })
})
