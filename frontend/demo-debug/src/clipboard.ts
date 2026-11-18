// The browser's clipboard, refused for the page as where the browser denies it the clipboard:
// every copy rejects, as the Plan, Files and File editing groups ask, until it is given back.
// Each boot of the demo gives it back, as a variant without those groups has no way to.

// Undoes the refusal, while there is one.
let restore: (() => void) | undefined

export const refuseClipboard = (): void => {
  if (restore) return
  const own = Object.getOwnPropertyDescriptor(navigator, "clipboard")
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: () => Promise.reject(new Error("The clipboard refused the copy.")) },
    configurable: true,
  })
  restore = () => {
    if (own) Object.defineProperty(navigator, "clipboard", own)
    else Reflect.deleteProperty(navigator, "clipboard")
    restore = undefined
  }
}

export const restoreClipboard = (): void => restore?.()
