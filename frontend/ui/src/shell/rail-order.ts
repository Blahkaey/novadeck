import { panelNamed, railPanelOf, railPanels, type RailPanel } from "@novadeck/core/types"

// The rail's toggles in the order the person left them, from what was stored: the ones they
// placed, as they placed them (a panel stored under a former id in its place), then any never
// placed (one new to the rail), in its own order. Sessions had a toggle of its own before it
// became a view of Terminals: an order that placed it keeps Terminals where Terminals stood,
// or takes Sessions' place for Terminals where only Sessions was placed.
export const railOrder = (stored: readonly string[]): readonly RailPanel[] => {
  const named = stored.map(panelNamed)
  const terminalsPlaced = named.includes("terminals")
  const placed = named
    .flatMap((each) =>
      each === undefined || (each === "sessions" && terminalsPlaced) ? [] : [railPanelOf(each)],
    )
    .filter((each, index, all) => all.indexOf(each) === index)
  return [...placed, ...railPanels.filter((panel) => !placed.includes(panel))]
}

// The order with the toggle shown at `from` moved to `to` among those shown; a toggle this
// backend doesn't show keeps its place, for a backend that does.
export const movedPanel = (
  order: readonly RailPanel[],
  shown: readonly RailPanel[],
  from: number,
  to: number,
): readonly RailPanel[] => {
  const moved = [...shown]
  const [panel] = moved.splice(from, 1)
  if (panel === undefined) return order
  moved.splice(to, 0, panel)
  let next = 0
  return order.map((each) => (shown.includes(each) ? (moved[next++] ?? each) : each))
}
