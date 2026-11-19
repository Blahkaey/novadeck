// Where a note goes among its list's as the person moves it, said as the port's `place` takes
// it: the note it then stands before, or null for last. `ids` is the list in its order, the
// moved note among them.

export type Spot = {
  // The note it stands before; null for last.
  readonly before: string | null
  // Its place in the list once moved, from 0.
  readonly index: number
}

// One place up (-1) or down (1) from where `id` stands; undefined at that end of the list, or
// for a note not in it.
export const stepSpot = (ids: readonly string[], id: string, by: -1 | 1): Spot | undefined => {
  const at = ids.indexOf(id)
  const index = at + by
  if (at === -1 || index < 0 || index >= ids.length) return undefined
  return { before: by === -1 ? ids[index]! : (ids[at + 2] ?? null), index }
}

// At `index` among the others, as a drag leaves it; undefined where that is where it stood.
export const indexSpot = (ids: readonly string[], id: string, index: number): Spot | undefined => {
  const rest = ids.filter((each) => each !== id)
  const to = Math.max(0, Math.min(rest.length, index))
  if (ids.indexOf(id) === to) return undefined
  return { before: rest[to] ?? null, index: to }
}

// Its place, from 0, in a list it joins before `before` (null for last), and how many the list
// then holds; `ids` is the list without it.
export const spotIn = (
  ids: readonly string[],
  before: string | null,
): { readonly index: number; readonly count: number } => {
  const at = before === null ? -1 : ids.indexOf(before)
  return { index: at === -1 ? ids.length : at, count: ids.length + 1 }
}
