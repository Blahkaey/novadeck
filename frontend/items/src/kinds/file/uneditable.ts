import type { FileContent, TextContent } from "@novadeck/core/items"

// Why the project window can't edit the file it shows, as its header says it: a file it
// couldn't have whole, and one it has whole that a save would be refused for.

export const uneditableText: Record<NonNullable<FileContent["uneditable"]>, string> = {
  "too-large": "It's too large to edit here.",
  "not-text": "It isn't UTF-8 text, so it can't be edited here.",
}

export const readOnlyText: Record<Extract<TextContent, { writable: false }>["reason"], string> = {
  outside:
    "Read-only: it's not one of the project's own files, but outside its folder, in Git's own folder or an agent's copy.",
  folder: "Read-only: Novadeck can't write to this file or its folder.",
  "not-a-plan": "Read-only: it can't be edited here.",
}
