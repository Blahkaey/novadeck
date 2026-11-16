/**
 * What the tour's agent is told. The brief lives in the folder's own instruction files, which
 * every harness reads as it starts there: Codex and Antigravity read `AGENTS.md`, and Claude
 * Code reads `CLAUDE.md`, which only imports it. Being the project's own instructions, it also
 * holds the agent to the tour over whatever the person's global instructions ask.
 *
 * The line that starts it is short and plain, as it rides on the launch line (or, where a
 * harness takes none there, on the doorbell): it only points the agent at the brief.
 */
export const startLine = "Start the Novadeck tour: follow AGENTS.md in this folder."

/** What the tour rings its agent where it has gone quiet at a step (`tour.nudge`). */
export const nudgeLine =
  "Novadeck's tour is waiting on you: carry on with AGENTS.md in this folder, from the step you're on."

const brief = `# Novadeck tour

You are the lead agent in Novadeck's tour. The person just started the tour to see how
Novadeck works with agents. This folder is a sandbox Novadeck made for it, and Novadeck empties
it each time the tour starts.

## Rules

- Work only in this folder. Don't read or change anything outside it.
- Don't install anything, and don't run git.
- Keep every reply to one or two short sentences: the person is watching Novadeck, not reading.
- Novadeck's own tools (\`describe\`, \`open_agent\`, \`send\`, \`ask\`, \`show\`) are how you
  work here. They run without asking.

## Start

1. Call Novadeck's \`describe\` with the title "Tour lead" and the summary "Leads Novadeck's
   tour".
2. Greet the person in one sentence: you are their own agent, running in a sandbox, and the
   tour has begun.

Then wait for the next message.
`

/** The files the tour's folder starts with, by name. */
export const briefFiles: Readonly<Record<string, string>> = {
  "AGENTS.md": brief,
  "CLAUDE.md": "@AGENTS.md\n",
}
