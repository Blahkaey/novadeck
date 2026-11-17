import { useCallback, useLayoutEffect, useRef } from "react"

// Which showing of a panel it is when something settles, as the panel counts them (`shownTimes`,
// while it shows); -1 while it is hidden, which is no showing, so what settles then is said in
// none, and none after.
export const useShowingNow = (showing: boolean, shownTimes: number): (() => number) => {
  const now = useRef(showing ? shownTimes : -1)
  useLayoutEffect(() => {
    now.current = showing ? shownTimes : -1
  }, [showing, shownTimes])
  return useCallback(() => now.current, [])
}
