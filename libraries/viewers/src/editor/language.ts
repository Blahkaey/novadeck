import { Language as Grammar, LanguageSupport, defineLanguageFacet } from "@codemirror/language"

import type { Language } from "../highlight/languages.js"
import { parserFor } from "../highlight/lines.js"

// Each language the editor highlights, made from the parser the code viewer highlights with
// once it has loaded, and kept for every editor after. Only the parser: none of the
// indentation, folding or comment rules a language's own CodeMirror package adds.

const supports = new Map<Language, LanguageSupport>()

/** The language's support, if its parser has loaded already. */
export const loadedSupport = (language: Language): LanguageSupport | undefined =>
  supports.get(language)

/** Loads the language's parser, the first time, and makes its support. */
export const loadSupport = async (language: Language): Promise<LanguageSupport> => {
  const support = new LanguageSupport(
    new Grammar(defineLanguageFacet(), await parserFor(language), [], language),
  )
  supports.set(language, support)
  return support
}
