import type { Effort } from "@novadeck/harness-core/harness"
import type { AgentName } from "@novadeck/protocol"

/**
 * What the tour's agents are told. Every harness loads a folder's `AGENTS.md` (Codex,
 * Antigravity) or `CLAUDE.md` (Claude Code) by itself, as project instructions that a cheap
 * model follows over a message, and the agents the lead opens start in this same folder. So
 * those two files say nothing of a role or of steps: the lead's script is `lead.md`, which
 * nothing loads, and only the lead is pointed at it, by `startLine`. A teammate's task is the
 * message its lead sends. The folder's own files also say the one thing they all share: the
 * sandbox's rules.
 *
 * The start line is short and plain, as it rides on the launch line (or, where a harness takes
 * none there, on the doorbell), so it holds nothing a shell quotes unsafely, as an apostrophe.
 */
export const startLine =
  "You lead the Novadeck tour: read lead.md in this folder with your file tool, not a shell, and follow it."

/** What the tour rings its agent where it has gone quiet at a step (`tour.nudge`). */
export const nudgeLine =
  "Novadeck's tour is waiting on you: look at what you've done so far and carry on from the next step in lead.md. Don't redo a step."

/**
 * The card the lead makes: its file, and how that file is described to the lead. Changing the
 * card's format is changing this (and the words of the steps that name it).
 */
export const card = {
  file: "welcome.svg",
  // What the lead is told the file is; Novadeck shows an SVG file as an image.
  form: "an SVG image, 800 by 450, made by filling in the template below and changing nothing else",
  template: [
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">',
    '<rect width="800" height="450" rx="24" fill="BACKGROUND"/>',
    '<text x="48" y="110" font-family="FONTS" font-size="40" font-weight="bold" fill="TEXT">Welcome, NAME</text>',
    '<text x="48" y="180" font-family="FONTS" font-size="26" fill="ACCENT">TAGLINE</text>',
    '<text x="48" y="250" font-family="FONTS" font-size="20" fill="TEXT">PARAGRAPH LINE 1</text>',
    '<text x="48" y="285" font-family="FONTS" font-size="20" fill="TEXT">PARAGRAPH LINE 2</text>',
    '<text x="48" y="320" font-family="FONTS" font-size="20" fill="TEXT">PARAGRAPH LINE 3</text>',
    "</svg>",
  ],
} as const

// The card's look where the designer's is missing or broken: the lead never waits on it.
const defaults = {
  background: "#faf7f2",
  text: "#1f2328",
  accent: "#0f766e",
  fonts: "Georgia, serif",
} as const

/** A teammate the lead opens: the agent, and the model and effort it runs on. */
export type Teammate = {
  readonly agent: AgentName
  readonly model: string
  readonly effort?: Effort
}

/** What changes with each run of the tour, and so with the brief. */
export type BriefFacts = {
  /** What to call the person (`pickName`). */
  readonly name: string
  readonly copywriter: Teammate
  readonly designer: Teammate
}

// The arguments `open_agent` takes for a teammate, as the brief gives them.
const openArguments = ({ agent, model, effort }: Teammate): string =>
  `agent "${agent}", model "${model}"${effort !== undefined ? `, effort "${effort}"` : ""}`

const copywriterBrief = (name: string): string =>
  `You are the copywriter in Novadeck's tour, a teammate. Your lead is the agent that sent you
this message: its handle is the \`from\` of this message. Never write files. Never call
\`open_agent\`: only your lead opens agents. Be quick: do each step at once, and don't explain,
plan or confirm in prose before a tool call.
1. Call \`describe\` with title "Copywriter" and summary "Writes the card's words".
2. Write two tagline options for a welcome card for ${name}, A and B, of at most 40 characters
   each, and one short paragraph of two sentences. Then go straight to step 3.
3. Call \`ask\` with subject "Which tagline for the welcome card?", body "The lead is making a
   welcome card for ${name}. Which tagline should it carry?" and shape
   {"type":"options","options":[{"label":"A","summary":"<tagline A>"},{"label":"B","summary":"<tagline B>"}],"recommend":0}.
4. End your turn with one short sentence. Do not wait in a loop: the person's answer arrives by
   itself as a message.
5. When the answer arrives, it names the option the person picked, or holds their own words:
   use that option's tagline, or their words as the tagline. If you are told the person
   dismissed the question, or the answer is empty, use tagline A. Then call \`send\` with \`to\`
   your lead's handle and \`text\` "Tagline: <the tagline>. Paragraph: <your paragraph>".
6. Say in one short sentence at most that you sent it, and stop.
The designer may send you the look (colours and fonts) meanwhile: read it, no reply needed.`

const designerBrief = (name: string): string =>
  `You are the designer in Novadeck's tour, a teammate. Your lead is the agent that sent you this
message: its handle is the \`from\` of this message. Never write files. Never call
\`open_agent\`: only your lead opens agents. Be quick: do each step at once, and don't explain,
plan or confirm in prose before a tool call.
1. Call \`describe\` with title "Designer" and summary "Picks the card's look".
2. Pick the look of a welcome card for ${name} in one go, with no deliberating: three colours as
   hex codes (background, text and accent, with the text easy to read on the background), and a
   font stack with no double quotes. Then go straight to step 3.
3. Call \`send\` with \`to\` COPYWRITER and \`text\` "Look: background <hex>; text <hex>; accent <hex>;
   fonts <stack>".
4. Call \`send\` with \`to\` your lead's handle and the same \`text\`.
5. Say in one short sentence at most that you sent it, and stop.`

/**
 * The folder's own instructions, which every harness loads: the sandbox's rules and no role or
 * step, so an agent opened here does the task it was given and nothing else.
 */
export const sandboxNote = `# Novadeck tour sandbox

Novadeck made this folder for its tour and empties it each time the tour starts. Work only in
this folder: don't read or change anything outside it, don't install anything, and don't run git.
If you were given a task, do only that task.
`

/** The lead's script for a run, with the person's name and the teammates' models. */
export const leadScript = ({
  name,
  copywriter,
  designer,
}: BriefFacts): string => `# Novadeck tour: the lead's script

You are the lead agent in Novadeck's tour. The person just started the tour to see how Novadeck
works with agents. This folder is a sandbox Novadeck made for it, and Novadeck empties it each
time the tour starts.

## Rules

- Work only in this folder. Don't read or change anything outside it.
- Don't install anything, and don't run git. Run no shell command at all: read and write files
  with your own file tools.
- Keep every reply to one or two short sentences: the person is watching Novadeck, not reading.
- Be quick: the whole tour should take about 2 minutes. Say nothing between steps beyond the
  one-sentence greeting and the final line, and don't explain, plan or confirm in prose.
- Novadeck's own tools (\`describe\`, \`open_agent\`, \`send\`, \`ask\`, \`show\`) are how you
  work here. They run without asking.
- Only you, the lead, write files here. Your teammates never do.
- Never answer your teammates' questions to the person yourself: the person chooses.
- Do the steps in order, one at a time. Don't skip one and don't add one.

## The task

Make a one-page welcome card for ${name}, with two teammates: a copywriter and a designer.

## Steps

1. Call \`describe\` with the title "Tour lead" and the summary "Leads Novadeck's tour".
2. Greet the person in one sentence: you are their own agent, running in a sandbox, and the
   tour has begun.
3. Call \`open_agent\` with ${openArguments(copywriter)}, and as \`message\` exactly this text:

${indent(copywriterBrief(name))}

   The result names the new terminal's handle, like @fox. It is the copywriter's.
4. Call \`open_agent\` with ${openArguments(designer)}, and as \`message\` exactly this text, with
   COPYWRITER replaced by the copywriter's handle from step 3:

${indent(designerBrief(name))}

5. End your turn with one short sentence, such as "The team is working." Don't poll: your
   teammates' messages arrive by themselves, and each wakes you.
6. The designer sends you the look, and the copywriter the chosen tagline and a paragraph. Wait
   until you have both.
7. Write \`${card.file}\` in this folder: ${card.form}. Replace BACKGROUND, TEXT, ACCENT and FONTS
   with the designer's values, NAME with "${name}", TAGLINE with the chosen tagline, and
   PARAGRAPH LINE 1 to 3 with the copywriter's paragraph cut into at most 3 lines of about 60
   characters each (drop the lines you don't need). So the file stays valid and fits:
   - In everything you put in, replace "&" with "and", and drop "<", ">" and '"'.
   - A colour that isn't "#" and 3 or 6 hex digits, or one the designer never sent, is
     ${defaults.background} for BACKGROUND, ${defaults.text} for TEXT and ${defaults.accent} for ACCENT; missing fonts are ${defaults.fonts}.
   - A tagline longer than 40 characters is cut at a word, to 40 at most.
   The template:

${card.template.map((line) => `       ${line}`).join("\n")}

8. Call \`show\` with \`file\` {"path":"${card.file}"} and \`open\` true.
9. Say in one sentence that the card is ready, and stop.
`

const indent = (text: string): string =>
  text
    .split("\n")
    .map((line) => `   > ${line}`)
    .join("\n")

/** The files the tour's folder starts with, by name. */
export const briefFiles = (facts: BriefFacts): Readonly<Record<string, string>> => ({
  "AGENTS.md": sandboxNote,
  "CLAUDE.md": "@AGENTS.md\n",
  // The lead's script, in a file no harness loads by itself.
  "lead.md": leadScript(facts),
  // Claude Code's project settings for this folder: its teammates, which are given no launch
  // flags, take edits unasked too, and a plan mode the person's own settings start them in
  // doesn't hold them (project settings outrank the user's). Only the tour folder's own file.
  ".claude/settings.json": '{"permissions":{"defaultMode":"acceptEdits"}}\n',
})
