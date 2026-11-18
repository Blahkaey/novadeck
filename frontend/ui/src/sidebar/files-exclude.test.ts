import type { FilesExclude } from "@novadeck/core/files"

import { context, describe, expect, it } from "../test"
import { exactPattern, hiddenUnder, hidesOf, hidingPattern } from "./files-exclude"

// Which of `paths` the patterns hide, the person's for every project and the project's over them.
const hidden = (
  paths: readonly string[],
  everywhere: FilesExclude,
  project: FilesExclude = {},
): string[] => {
  const hides = hidesOf(everywhere, project)
  return paths.filter((path) => hides(path))
}

describe("Hiding files by pattern", () => {
  context("with each part of a pattern", () => {
    it("matches any characters within one name with *", () => {
      expect(hidden(["app.log", "app.log.gz", "logs/app.log"], { "*.log": true })).toEqual([
        "app.log",
      ])
    })

    it("matches one character within a name with ?", () => {
      expect(hidden(["a.ts", "ab.ts", "a/b.ts"], { "?.ts": true })).toEqual(["a.ts"])
    })

    it("matches any number of folders with **, none included", () => {
      expect(hidden(["src/x.ts", "src/a/b/x.ts", "lib/x.ts"], { "src/**/x.ts": true })).toEqual([
        "src/x.ts",
        "src/a/b/x.ts",
      ])
      expect(
        hidden(["node_modules", "packages/ui/node_modules", "node_modules_old"], {
          "**/node_modules": true,
        }),
      ).toEqual(["node_modules", "packages/ui/node_modules"])
    })

    it("matches either of {a,b}", () => {
      expect(hidden(["a.js", "a.ts", "a.md"], { "*.{js,ts}": true })).toEqual(["a.js", "a.ts"])
    })

    it("matches one of the characters in [ab]", () => {
      expect(hidden(["a.ts", "b.ts", "c.ts"], { "[ab].ts": true })).toEqual(["a.ts", "b.ts"])
    })

    it("matches a leading ! and @(…) as themselves, as VS Code does", () => {
      expect(hidden(["!draft.md", "notes.md"], { "!draft.md": true })).toEqual(["!draft.md"])
      expect(hidden(["@(a|b)", "a"], { "@(a|b)": true })).toEqual(["@(a|b)"])
    })
  })

  context("with names that start with a dot", () => {
    it("matches them as any other name", () => {
      expect(hidden([".env", "src/.env", ".github"], { "*": true })).toEqual([".env", ".github"])
      expect(hidden([".DS_Store", "src/assets/.DS_Store"], { "**/.DS_Store": true })).toEqual([
        ".DS_Store",
        "src/assets/.DS_Store",
      ])
    })
  })

  context("against the path from the project's root", () => {
    it("hides a pattern without ** only at the root", () => {
      expect(hidden(["dist", "packages/ui/dist"], { dist: true })).toEqual(["dist"])
      expect(hidden(["dist", "packages/ui/dist"], { "**/dist": true })).toEqual([
        "dist",
        "packages/ui/dist",
      ])
    })

    it("hides what is inside a hidden folder, though no pattern names it", () => {
      const hides = hidesOf({ "**/node_modules": true }, {})

      expect(hides("web/node_modules/react/index.js")).toBe(false)
      expect(hiddenUnder(hides, "web/node_modules/react/index.js")).toBe(true)
      expect(hiddenUnder(hides, "web/src/index.js")).toBe(false)
    })
  })

  context("with patterns switched off", () => {
    it("hides nothing with a pattern that is off", () => {
      expect(hidden(["a.log"], { "*.log": false })).toEqual([])
    })

    it("lets a project switch off a pattern of every project, there only", () => {
      const paths = ["a.log", "dist"]
      const everywhere = { "*.log": true, dist: true }

      expect(hidden(paths, everywhere, { "*.log": false })).toEqual(["dist"])
      expect(hidden(paths, everywhere)).toEqual(["a.log", "dist"])
    })

    it("lets a project hide more of its own, and turn on one that is off everywhere", () => {
      expect(
        hidden(["a.log", "b.tmp"], { "*.log": false }, { "*.log": true, "*.tmp": true }),
      ).toEqual(["a.log", "b.tmp"])
    })
  })

  context("with an exact path", () => {
    it("hides that path alone, whatever glob characters its names hold", () => {
      const paths = [
        "src/app/[id]/page.tsx",
        "src/app/i/page.tsx",
        "src/app/d/page.tsx",
        "a{b}.ts",
        "ab.ts",
        "*.md",
        "README.md",
        "a,b?.txt",
        "ab.txt",
        "a,bc.txt",
        "notes\\draft.md",
        "notes\\\\draft.md",
        "notesdraft.md",
        "!keep",
        "(group)/x.ts",
        'a"b.txt',
        'a"[b].txt',
        'a"b".txt',
      ]
      for (const path of paths)
        expect(hidden(paths, {}, { [exactPattern(path)]: true })).toEqual([path])
    })

    it("escapes the glob characters only, and puts a backslash in brackets", () => {
      expect(exactPattern("src/app/[id]/page.tsx")).toBe("src/app/\\[id\\]/page.tsx")
      expect(exactPattern('a"b.txt')).toBe('a\\"b.txt')
      expect(exactPattern("notes\\draft.md")).toBe("notes[\\\\]draft.md")
      expect(exactPattern("src/cart/useCart.ts")).toBe("src/cart/useCart.ts")
    })
  })

  context("when naming the pattern that hides a path", () => {
    it("names the first pattern on that matches it, or a folder above it", () => {
      const everywhere = { "**/*.log": true, "**/dist": true }
      expect(hidingPattern(everywhere, {}, "logs/app.log")).toBe("**/*.log")
      expect(hidingPattern(everywhere, {}, "web/dist/main.js")).toBe("**/dist")
      expect(hidingPattern(everywhere, { "web/**": true }, "web/dist/main.js")).toBe("**/dist")
    })

    it("names none where every pattern that matches is switched off, or none matches", () => {
      expect(hidingPattern({ "**/*.log": true }, { "**/*.log": false }, "app.log")).toBeUndefined()
      expect(hidingPattern({ "**/*.log": true }, {}, "src/app.ts")).toBeUndefined()
    })
  })
})
