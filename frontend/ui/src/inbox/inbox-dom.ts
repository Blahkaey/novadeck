// Where the Inbox's rows and sheet are on the page. `page` is the document the Inbox is drawn in:
// the page's own, or that of the Inbox's window of its own, where its sheet opens too.

// Where an Inbox row is: its sheet sits beside it, and the keyboard follows it.
export const rowOf = (id: string | null, page: Document): HTMLElement | null =>
  id === null
    ? null
    : (Array.from(page.querySelectorAll<HTMLElement>("[data-inbox-row]")).find(
        (element) => element.dataset.inboxRow === id,
      ) ?? null)

// What Tab stops at: a menu's rows other than the one its cursor is on take no stop of their own.
const controls =
  'a[href], button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

// The controls of the sheet's page in tab order, not the buttons of its title bar, which
// come before them. The first is where Tab from its row lands.
export const sheetControls = (sheet: ParentNode): HTMLElement[] => {
  const page = sheet.querySelectorAll<HTMLElement>(`.inbox-sheet-scroll :is(${controls})`)
  return Array.from(page)
}

// Moves focus to the first control of the open sheet; false where there is none yet.
export const focusSheet = (page: Document): boolean => {
  const first =
    sheetControls(page)[0] ?? page.querySelector<HTMLElement>(".inbox-sheet-head button")
  first?.focus()
  return first !== undefined && first !== null
}

// Focus for a sheet just opened from the keyboard, once it has mounted: its title, which
// does nothing, so a key pressed twice on a row answers nothing; Tab goes on to the controls.
export const focusSheetSoon = (page: Document, frames = 12): void => {
  ;(page.defaultView ?? window).requestAnimationFrame(() => {
    const title = page.querySelector<HTMLElement>(".inbox-sheet-title")
    if (title) title.focus()
    else if (frames > 0) focusSheetSoon(page, frames - 1)
  })
}

// Moves focus to the Inbox panel's Hide button, where a header button that goes leaves it: in
// a window of its own, to its way back to the sidebar in Hide's place, and in a window on the
// stage, which has neither in the panel, to the panel's heading.
export const focusPanelClose = (page: Document): void => {
  ;(
    page.querySelector<HTMLElement>("#inbox-panel :is(.sidebar-close, .sidebar-return)") ??
    page.getElementById("inbox-panel-title")
  )?.focus()
}

// The select button of the row after a row's; none where it is the last.
export const nextRowButton = (id: string, page: Document): HTMLElement | null => {
  const rows = Array.from(page.querySelectorAll<HTMLElement>("[data-inbox-row]"))
  const at = rows.findIndex((row) => row.dataset.inboxRow === id)
  const row = rows[at + 1]
  return row?.querySelector<HTMLElement>(".inbox-row-select") ?? null
}
