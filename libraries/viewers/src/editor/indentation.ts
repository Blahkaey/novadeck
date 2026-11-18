// The unit a file indents by, which Tab adds and Enter writes the line's indentation in: a
// tab where tab-indented lines outnumber space-indented ones, else the step of spaces the
// file goes in by, two where it shows none. A Makefile's recipes must start with a tab, so a
// Makefile indents with tabs whatever it holds, an empty one too.

const makefiles = new Set(["GNUmakefile", "makefile", "Makefile"])

const isMakefile = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf("/") + 1)
  return makefiles.has(name) || name.endsWith(".mk")
}

// The widest step taken for one: deeper is alignment, not indentation.
const widest = 8

export const indentUnitOf = (text: string, path: string): string => {
  if (isMakefile(path)) return "\t"
  let tabbed = 0
  let spaced = 0
  // How often each step in, from one line to the next deeper one, of lines indented with
  // spaces alone. A step of one is a doc comment's ` * `, not indentation.
  const steps = new Map<number, number>()
  let previous = 0
  for (const line of text.split("\n")) {
    const indent = /^[ \t]*/.exec(line)![0]
    // A blank line tells nothing.
    if (indent.length === line.length) continue
    if (indent.startsWith("\t")) tabbed++
    else if (indent.startsWith(" ")) spaced++
    if (/\t/.test(indent)) continue
    const step = indent.length - previous
    if (step >= 2 && step <= widest) steps.set(step, (steps.get(step) ?? 0) + 1)
    previous = indent.length
  }
  if (tabbed > spaced) return "\t"
  // The step taken most, the smaller of two taken as often.
  let unit = 2
  let most = 0
  for (const [step, count] of steps)
    if (count > most || (count === most && step < unit)) [unit, most] = [step, count]
  return " ".repeat(unit)
}
