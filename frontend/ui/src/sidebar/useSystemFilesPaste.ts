import type { FilePasteResult } from "@novadeck/core/files"
import { useRef, useState, useSyncExternalStore } from "react"

import type { EntryChanges } from "./files-edit"

const noEvents = (): (() => void) => () => {}
const ready = (): boolean => true

/** Keeps the panel's clipboard marker and the progress of its current Finder paste. */
export const useSystemFilesPaste = (source: EntryChanges["clipboard"]) => {
  const marker = useRef<string | undefined>(undefined)
  const marking = useRef(Promise.resolve())
  const running = useRef(false)
  const [progress, setProgress] = useState<string | null>(null)
  const available = useSyncExternalStore(
    source?.available?.subscribe ?? noEvents,
    source?.available?.getSnapshot ?? ready,
  )

  const mark = (refused: () => void): void => {
    if (!source) return
    const copied = crypto.randomUUID()
    marker.current = copied
    marking.current = marking.current
      .then(() => source.mark(copied))
      .catch(() => {
        if (marker.current === copied) {
          marker.current = undefined
          refused()
        }
      })
  }

  const paste = (
    into: string,
    hasClip: boolean,
    uploading: () => void,
  ): Promise<FilePasteResult> | undefined => {
    if (!source || running.current) return
    running.current = true
    let started = false
    setProgress("Preparing paste…")
    const expected = hasClip ? marker.current : undefined
    return marking.current
      .then(() =>
        source.paste(into, expected === marker.current ? expected : undefined, (sent, total) => {
          if (!started) {
            started = true
            uploading()
          }
          setProgress(
            sent < total
              ? `Pasting files… ${Math.floor((sent / total) * 100)}%`
              : "Saving pasted files…",
          )
        }),
      )
      .finally(() => {
        running.current = false
        setProgress(null)
      })
  }

  return { available: source !== undefined && available, mark, paste, progress }
}
