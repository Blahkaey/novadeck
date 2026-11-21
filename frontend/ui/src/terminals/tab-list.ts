import { createStore, type MutableStore } from "@novadeck/core/store"
import { createContext } from "react"

// The Terminals list's element, as the Terminals panel mounts it: the list is a new element in
// each session, and what draws over it (TeamWire.tsx) follows the one there is. The workspace
// provides one.
export type TabListStore = MutableStore<HTMLElement | null>

export const createTabListStore = (): TabListStore => createStore<HTMLElement | null>(null)

export const TabListContext = createContext<TabListStore | undefined>(undefined)
