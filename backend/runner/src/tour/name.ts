import { execFile } from "node:child_process"
import { userInfo } from "node:os"

/** What the brief calls the person when their name can't be told. */
export const unnamed = "you"

// A name as it may stand in the brief: its letters, with an apostrophe or hyphen inside. The
// brief is an instruction file, so nothing else of a name, which anyone can set, goes into it.
const word = /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/u

// As long as fits the card's heading, "Welcome, <name>", on its 800-wide line.
const longest = 20

const given = (text: string | undefined, split: RegExp): string | undefined => {
  const first = text?.trim().split(split)[0] ?? ""
  const name = word.exec(first)?.[0]
  return name && name.length <= longest ? name : undefined
}

// Accounts that name no person.
const generic = new Set(["root", "admin", "administrator", "user", "guest", "ubuntu", "pi"])

/**
 * What the brief calls the person: the first word of their git name (`git config --global
 * user.name`), else their account's name, capitalized, else "you". The name is written
 * into the tour's folder, and goes on from there: into the teammates' briefs (which Novadeck
 * keeps and shows in Messages), the card the lead writes, and each harness's model provider,
 * through the person's own account.
 */
export const pickName = (gitName: string | undefined, account: string | undefined): string => {
  const fromGit = given(gitName, /\s+/)
  if (fromGit) return fromGit
  const fromAccount = given(account, /[\s._]+/)
  if (fromAccount && !generic.has(fromAccount.toLowerCase()))
    return fromAccount.charAt(0).toUpperCase() + fromAccount.slice(1)
  return unnamed
}

/** The person's global git name, or undefined: none set, no git, or git slower than `timeoutMs`. */
export const readGitName = (
  home: string | undefined,
  timeoutMs = 2000,
): Promise<string | undefined> =>
  new Promise((resolve) => {
    // Git reads the home it is given, so a run on a stand-in home sees that one's file.
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (home !== undefined) {
      env.HOME = home
      env.USERPROFILE = home
      delete env.XDG_CONFIG_HOME
      delete env.GIT_CONFIG_GLOBAL
    }
    env.GIT_TERMINAL_PROMPT = "0"
    try {
      execFile(
        "git",
        ["config", "--global", "user.name"],
        { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 4096 },
        (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined),
      )
    } catch {
      resolve(undefined)
    }
  })

/** The OS account's name, or undefined where the system can't say. */
export const readAccount = (): string | undefined => {
  try {
    return userInfo().username
  } catch {
    return undefined
  }
}
