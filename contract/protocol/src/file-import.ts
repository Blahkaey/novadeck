import { z } from "zod"

import { entryPath, maxEntryPathLength } from "./projects.js"

export const fileImportLimits = {
  bytes: 512 * 1024 * 1024,
  entries: 10_000,
  partBytes: 144 * 1024,
  pathCharacters: maxEntryPathLength,
} as const

// Parents arrive before their children. A null size represents a directory, including an
// empty one. Parts of a file arrive before the next entry starts.
export const fileImportEntry = z.strictObject({
  path: entryPath.min(1),
  size: z.int().min(0).max(fileImportLimits.bytes).nullable(),
})

export type FileImportEntry = z.infer<typeof fileImportEntry>

export const fileImportWrite = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("entry"), entry: fileImportEntry }),
  z.strictObject({
    kind: z.literal("part"),
    offset: z.int().min(0).max(fileImportLimits.bytes),
    data: z
      .base64()
      .min(4)
      .max((fileImportLimits.partBytes / 3) * 4),
  }),
  z.strictObject({ kind: z.literal("cancel") }),
])

export type FileImportWrite = z.infer<typeof fileImportWrite>
