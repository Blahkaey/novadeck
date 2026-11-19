import { setups } from "./agents/index.js"
import type { DeckTerminal } from "./deck.js"
import { describe, e2e, expect, supported, type E2E } from "./fixture.js"
import { asked, tool } from "./model/script.js"
import { own, result, sends, sent, start, through } from "./scenarios.js"

// Notes the person asks an agent for (docs/agent-messaging.md, "Notes the person asks for"):
// in a turn the person's own prompt started, the agent's `note` adds a todo first in the To do
// column of the project's Todo board, marked as that agent's; in a turn another agent's message woke it for,
// the runner refuses it and adds nothing. The same for every harness (see messaging.e2e.ts
// for the rule on parity). The model here is a script, so this checks that each harness
// offers `note` and that the runner's check holds, not what a real model makes of the
// tool's description.

const asking = "Add a todo: revisit the retry logic"

// The notes of the project the terminal is in, as the runner keeps them.
const notesOf = (run: E2E, terminal: DeckTerminal) =>
  run.deck.notes.list(run.deck.store.session(terminal.summary().sessionId).projectId)

for (const setup of setups) {
  describe.skipIf(!supported)(setup.name, () => {
    const it = e2e(setup)

    it("adds the todo the person asked for, first in their notes, marked as its agent's", async ({
      e2e: run,
    }) => {
      let answered: string | undefined
      run.model.use(
        own((call) => {
          const note = tool(call, "note")
          return note && asked(call, asking)
            ? { calls: [{ name: note, input: { notes: [{ text: "Revisit the retry logic" }] } }] }
            : undefined
        }),
        own((call) => {
          const text = result(call)
          if (!text?.includes("Todo board")) return undefined
          answered = text
          return { text: "Noted." }
        }),
      )
      const t1 = await start(run, setup)
      const mark = t1.mark()

      await t1.submit(asking)
      await t1.until("Noted.")
      await through(t1, ["settled"], { after: mark })

      expect(answered).toContain("Added a todo to the To do column of the user's Todo board.")
      // The session's first prompt is theirs in every harness, where Codex and Antigravity
      // bind the session at that prompt too.
      expect(run.deck.store.terminal(t1.id)?.work).toMatchObject({
        first: asking,
        firstByPerson: true,
      })
      expect(notesOf(run, t1)).toEqual([
        expect.objectContaining({
          text: "Revisit the retry logic",
          todo: true,
          doneAt: null,
          by: { agent: setup.agent, handle: t1.summary().handle },
        }),
      ])
    })

    it("refuses a note in a turn another agent's message woke it for", async ({ e2e: run }) => {
      let refused: string | undefined
      run.model.use(
        sends("Ask fox to note it", "fox", "Add a todo: ship it"),
        own((call) => (sent(call, "fox") ? { text: "Asked." } : undefined)),
        // fox, rung for moth's message, tries to note what the message asked.
        own((call) => {
          const note = tool(call, "note")
          return note && asked(call, "Add a todo: ship it")
            ? { calls: [{ name: note, input: { notes: [{ text: "Ship it" }] } }] }
            : undefined
        }),
        own((call) => {
          const text = result(call)
          if (!text?.includes("Notes are the user's own")) return undefined
          refused = text
          return { text: "Said so instead." }
        }),
      )
      const t1 = await start(run, setup)
      const t2 = await start(run, setup)
      const from2 = t2.mark()

      await t1.submit("Ask fox to note it")
      await t2.until("Said so instead.")
      await through(t2, ["ringing", "working", "settled"], { after: from2 })

      expect(refused).toContain("Say in your reply what you would have noted.")
      expect(notesOf(run, t1)).toEqual([])
    })
  })
}
