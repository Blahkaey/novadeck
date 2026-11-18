import type { FilesExclude } from "@novadeck/core/files"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

// Where the backend keeps the project's own patterns for hiding files: how to read them, and
// replace them whole.
export type ProjectExcludeSource = {
  readonly read: () => Promise<FilesExclude>
  readonly save: (patterns: FilesExclude) => Promise<void>
}

// The project's patterns once read, and how to write them. Each write waits for the ones asked
// for before it to answer, and rejects with the backend's reason, leaving them as they were.
export type ExcludeEditing = {
  readonly patterns: FilesExclude
  // Replaces them whole with `patterns`, whatever the backend holds by then.
  readonly save: (patterns: FilesExclude) => Promise<void>
  // Replaces them with what `update` makes of them as the backend holds them when this write's
  // turn comes, read then, so what another window or an earlier write saved stays.
  readonly change: (update: (current: FilesExclude) => FilesExclude) => Promise<void>
}

// The project's own patterns, read whenever the panel is shown, as its folders are, and on
// `reread`: undefined until a read answers, so nothing is offered to change before then. A read
// that fails leaves them as they were. A write that goes through is what they are from then on,
// and a read that began before it answers too late to count, as it may bring back what the write
// replaced.
export const useProjectExclude = (
  source: ProjectExcludeSource | undefined,
  showing: boolean,
): { readonly editing: ExcludeEditing | undefined; readonly reread: () => void } => {
  const [patterns, setPatterns] = useState<FilesExclude | undefined>()
  // How many writes went through, which a read compares with the count when it began.
  const saves = useRef(0)
  // The last write asked for, settled either way, which the next one waits for.
  const writes = useRef<Promise<void>>(Promise.resolve())
  const reread = useCallback((): void => {
    if (!source) return
    const before = saves.current
    source.read().then(
      (read) => {
        if (saves.current === before) setPatterns(read)
      },
      () => {},
    )
  }, [source])
  useEffect(() => {
    if (showing) reread()
  }, [showing, reread])
  const editing = useMemo((): ExcludeEditing | undefined => {
    if (!source || !patterns) return undefined
    // Runs `next`'s write once the writes before it have answered, and keeps what it saved.
    const write = (next: () => Promise<FilesExclude>): Promise<void> => {
      const done = writes.current.then(async () => {
        const saved = await next()
        saves.current += 1
        setPatterns(saved)
      })
      writes.current = done.catch(() => {})
      return done
    }
    return {
      patterns,
      save: (next) =>
        write(async () => {
          await source.save(next)
          return next
        }),
      change: (update) =>
        write(async () => {
          const next = update(await source.read())
          await source.save(next)
          return next
        }),
    }
  }, [source, patterns])
  return { editing, reread }
}
