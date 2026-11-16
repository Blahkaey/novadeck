// A mark that something was used once, kept under `key` in localStorage: a footer chip shows its
// word until then and is the icon alone from then on. Storage may be unavailable (a private
// window, blocked site data): the mark then reads as unset and the word stays for the session.

export const readFirstUse = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === "1"
  } catch {
    return false
  }
}

export const writeFirstUse = (key: string): void => {
  try {
    localStorage.setItem(key, "1")
  } catch {
    /* The word stays for this session when storage is unavailable. */
  }
}
