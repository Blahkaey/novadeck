import { harnesses, type AgentName } from "@novadeck/core/harnesses"
import type { Backend } from "@novadeck/core/port"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { beginRun, coachNow, nextTick, stepRun, type TourEvent, type TourRun } from "../tour/driver"
import { sameSignals, tourSignals, type TourSignals } from "../tour/signals"
import type { TourStarted } from "../tour/start"
import { tourSteps, type Coach, type TourMove } from "../tour/steps"
import { useWorkspaceServices, useWorkspaceState } from "./controller/context"

// How long the tour waits on its agent at a step before nudging it, unless the backend says.
const defaultPatienceMs = 90_000
// How soon it rings an agent's first line again where the backend refused it, and how many
// times before it gives up: a refusal that stands (a terminal outside the tour's folder) isn't
// asked again forever.
const briefRetryMs = 2_000
const briefTries = 5

// Where a run is kept, in this window's session storage: a reload while the tour runs follows
// it again, as its terminal survives the reload.
const storageKey = "novadeck.tour"

const isRun = (value: unknown): value is TourRun => {
  if (typeof value !== "object" || value === null) return false
  const run = value as Record<string, unknown>
  return (
    typeof run.terminalId === "string" &&
    harnesses.some(({ id }) => id === run.agent) &&
    (run.brief === "launch" || run.brief === "doorbell") &&
    typeof run.step === "number" &&
    typeof run.waitingSince === "number" &&
    ["nudged", "briefed", "paused", "entered"].every((key) => typeof run[key] === "boolean")
  )
}

export const readTourRun = (): TourRun | null => {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "null")
    return isRun(stored) ? stored : null
  } catch {
    return null
  }
}

const writeTourRun = (run: TourRun | null): void => {
  try {
    if (run) sessionStorage.setItem(storageKey, JSON.stringify(run))
    else sessionStorage.removeItem(storageKey)
  } catch {
    // Without storage, a run isn't followed again after a reload.
  }
}

const noSignals: TourSignals = { lead: { kind: "gone" }, onScreen: false }

export type TourDriver = {
  // Follows a run the person just started.
  readonly begin: (agent: AgentName, started: TourStarted) => void
  // The run followed now, with what it shows; null while none runs.
  readonly shown: {
    readonly terminalId: string
    readonly coach: Coach | null
    readonly step: number
    readonly steps: number
    readonly paused: boolean
    readonly away: boolean
  } | null
  readonly pause: () => void
  readonly resume: () => void
  readonly skip: () => void
  readonly end: () => void
  // Brings the tour's project, and its lead, back on screen.
  readonly back: () => void
}

/**
 * Follows a run of the tour: reads its signals off the workspace, moves it on with each change
 * and as its waits end, makes each step's moves once as it begins, and rings its lead its
 * first line, or a nudge, through the backend. It never takes the person's view back: a step's
 * moves are made once, and only while the tour's project is on screen.
 */
export const useTourDriver = (tour: Backend["tour"]): TourDriver => {
  const { commands, workspace } = useWorkspaceServices()
  const [run, setRun] = useState<TourRun | null>(readTourRun)
  // The run as the last event left it, which the next one moves on from, so a burst of events
  // in one frame each builds on the one before.
  const current = useRef(run)
  // A ring of the first line to try again, for the run it was for, and how many were tried.
  const retry = useRef<{ timer?: ReturnType<typeof setTimeout>; tries: number }>({ tries: 0 })
  const dropRetry = useCallback((): void => {
    clearTimeout(retry.current.timer)
    retry.current = { tries: 0 }
  }, [])
  const patienceMs = tour?.patienceMs ?? defaultPatienceMs
  const signals = useWorkspaceState(
    (state) => (run ? tourSignals(state, run.terminalId) : noSignals),
    sameSignals,
  )

  const make = useCallback(
    (terminalId: string, moves: readonly TourMove[]): void => {
      for (const move of moves)
        if (move.kind === "view") commands.changeView(move.view)
        else if (move.kind === "reveal") commands.reveal(terminalId)
        else if (move.kind === "sidebar") commands.reveal(terminalId, move.panel)
        else commands.showInbox()
    },
    [commands],
  )

  // Moves the run on by one event and acts on what follows: a step's moves, and ringing the
  // lead its first line (again, a little later, where the backend refused) or a nudge.
  const dispatch = useCallback(
    function dispatch(event: TourEvent): void {
      const before = current.current
      if (!before) return
      const outcome = stepRun(before, tourSteps, event, patienceMs)
      current.current = outcome.run
      writeTourRun(outcome.run)
      setRun(outcome.run)
      if (!outcome.run) dropRetry()
      const { terminalId } = before
      make(terminalId, outcome.moves)
      // Only for the run it was for: one ended or begun anew since lets it go.
      const again = (): void => {
        if (current.current?.terminalId !== terminalId) return
        dispatch({
          type: "signals",
          signals: tourSignals(workspace.getSnapshot(), terminalId),
          now: Date.now(),
        })
      }
      if (outcome.brief)
        tour?.brief(terminalId).then(
          () => dropRetry(),
          (error: unknown) => {
            console.error("Novadeck couldn't give the tour's agent its brief:", error)
            if (current.current?.terminalId !== terminalId) return
            if (retry.current.tries >= briefTries) return
            dispatch({ type: "brief-failed" })
            clearTimeout(retry.current.timer)
            retry.current = {
              tries: retry.current.tries + 1,
              timer: setTimeout(again, briefRetryMs),
            }
          },
        )
      if (outcome.nudge)
        tour
          ?.nudge?.(terminalId)
          .catch((error: unknown) =>
            console.error("Novadeck couldn't nudge the tour's agent:", error),
          )
    },
    [tour, patienceMs, make, workspace, dropRetry],
  )

  // A retry left waiting goes with the page.
  useEffect(() => dropRetry, [dropRetry])

  // Each change of its signals moves it on.
  useEffect(() => {
    if (current.current) dispatch({ type: "signals", signals, now: Date.now() })
  }, [signals, dispatch])

  // And so does the end of a wait.
  const tickAt = run ? nextTick(run, tourSteps, signals, patienceMs) : null
  useEffect(() => {
    if (tickAt === null) return
    const timer = setTimeout(
      () => dispatch({ type: "tick", signals, now: Date.now() }),
      Math.max(0, tickAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [tickAt, signals, dispatch])

  const begin = useCallback(
    (agent: AgentName, started: TourStarted): void => {
      dropRetry()
      const next = beginRun(
        { terminalId: started.terminalId, agent, brief: started.run.brief },
        Date.now(),
      )
      current.current = next
      writeTourRun(next)
      setRun(next)
    },
    [dropRetry],
  )

  const projectOf = useWorkspaceState(
    (state) =>
      run
        ? (state.projects.find((project) =>
            project.history.some((session) =>
              session.state.roster.terminals.some(({ id }) => id === run.terminalId),
            ),
          )?.id ?? null)
        : null,
    Object.is,
  )

  const shown = useMemo(
    () =>
      run && {
        terminalId: run.terminalId,
        coach: coachNow(run, tourSteps, signals),
        step: run.step,
        steps: tourSteps.length,
        paused: run.paused,
        away: !signals.onScreen,
      },
    [run, signals],
  )

  return useMemo(
    () => ({
      begin,
      shown,
      pause: () => dispatch({ type: "pause" }),
      // Resumed, it makes the moves a step begun while paused held back.
      resume: () => {
        dispatch({ type: "resume", now: Date.now() })
        const terminalId = current.current?.terminalId
        if (terminalId)
          dispatch({
            type: "signals",
            signals: tourSignals(workspace.getSnapshot(), terminalId),
            now: Date.now(),
          })
      },
      skip: () => dispatch({ type: "skip", now: Date.now() }),
      end: () => dispatch({ type: "end" }),
      back: () => {
        if (run && projectOf) commands.revealTerminal(run.terminalId, projectOf)
      },
    }),
    [begin, shown, dispatch, run, projectOf, commands, workspace],
  )
}
