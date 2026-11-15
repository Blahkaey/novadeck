import type { AgentName } from "@novadeck/core/harnesses"
import type { AgentConnection, Backend } from "@novadeck/core/port"
import type { Store } from "@novadeck/core/store"
import type { Workspace } from "@novadeck/core/types"
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"

import {
  chooseAgent,
  connectingAgent,
  followAgents,
  offerTour,
  startingTour,
  tourAgents,
  tourFailed,
  type TourConsent,
} from "../tour/consent"
import { agentShownIn, startTour, type TourEffects } from "../tour/start"
import { useWorkspaceServices } from "./controller/context"

// Every terminal of the workspace, in every project and session.
const everyTerminal = (workspace: Workspace) =>
  workspace.projects.flatMap((project) =>
    project.history.flatMap((session) => session.state.roster.terminals),
  )

// Resolves once the terminal's agent shows in the workspace, true, or once the terminal is
// gone, false: a signal, however long it takes.
const whenAgentShows = (workspace: Store<Workspace>, terminalId: string): Promise<boolean> =>
  new Promise((resolve) => {
    const check = (): boolean => {
      const shown = agentShownIn(everyTerminal(workspace.getSnapshot()), terminalId)
      if (shown === undefined) return false
      resolve(shown)
      return true
    }
    if (check()) return
    const unsubscribe = workspace.subscribe(() => {
      if (check()) unsubscribe()
    })
  })

// A store that never changes, for a backend without one.
const never = (): (() => void) => () => {}

export type TourOffer = {
  // The consent while it is offered, null otherwise.
  readonly consent: TourConsent | null
  // The agents the tour can run now.
  readonly agents: readonly AgentName[]
  // Whether the consent's agent is still being connected, so it can't start yet.
  readonly connecting: boolean
  // Offers the tour, on `preferred` where it can run it.
  readonly offer: (preferred?: AgentName) => void
  readonly choose: (agent: AgentName) => void
  readonly start: () => void
  // Starts the agent the tour needs started first, in a terminal of the project on screen, for
  // the person to sign in to; the consent closes, to be offered again once it has.
  readonly startAgent: (agent: AgentName) => void
  readonly close: () => void
}

/**
 * The tour as the app offers it: the consent, and starting the run once the person agrees.
 * The consent closes once the tour's project and terminal are open; one the backend refused
 * stays open with its reason. Absent (`undefined`) where the backend has no tour.
 */
export const useTour = (
  backend: Pick<Backend, "tour">,
  connections: readonly AgentConnection[],
): TourOffer | undefined => {
  const { commands, workspace } = useWorkspaceServices()
  const [offered, setConsent] = useState<TourConsent | null>(null)
  // Held back until the tour's story is whole (`Tour.offered`).
  const held = useSyncExternalStore(
    backend.tour?.offered?.subscribe ?? never,
    () => backend.tour?.offered?.getSnapshot() !== true,
  )
  const tour = held ? undefined : backend.tour
  // As the connections stand now: an agent that disconnects while it is offered is no longer
  // offered, and the one it was offered on is taken once it connects.
  const consent = useMemo(
    () => offered && followAgents(offered, connections),
    [offered, connections],
  )
  const offer = useCallback(
    // One already starting stays as it is: the app's menu may ask again meanwhile.
    (preferred?: AgentName) =>
      setConsent((current) => (current?.starting ? current : offerTour(connections, preferred))),
    [connections],
  )
  // The app's menu offers it as Preferences does.
  useEffect(() => tour?.asked?.(() => offer()), [tour, offer])
  const start = useCallback(() => {
    if (!tour || !consent?.agent || consent.starting) return
    if (connectingAgent(connections, consent.agent)) return
    setConsent(startingTour(consent))
    const effects: TourEffects = {
      tour,
      openTour: commands.openTour,
      add: (options) => commands.add(options),
      agentShown: (terminalId) => whenAgentShows(workspace, terminalId),
    }
    startTour(consent.agent, effects).then(
      ({ briefed }) => {
        setConsent(null)
        briefed.catch((error: unknown) =>
          console.error("Novadeck couldn't give the tour's agent its brief:", error),
        )
      },
      (error: unknown) => setConsent((current) => current && tourFailed(current, error)),
    )
  }, [tour, consent, connections, commands, workspace])
  const agents = useMemo(() => tourAgents(connections), [connections])
  const connecting = connectingAgent(connections, consent?.agent ?? null)
  return useMemo(
    () =>
      tour && {
        consent,
        agents,
        connecting,
        offer,
        choose: (agent: AgentName) =>
          setConsent((current) => current && chooseAgent(current, agent)),
        start,
        startAgent: (agent: AgentName) => {
          setConsent(null)
          commands.add({ command: agent })
        },
        close: () => setConsent((current) => (current?.starting ? current : null)),
      },
    [tour, consent, agents, connecting, offer, start, commands],
  )
}
