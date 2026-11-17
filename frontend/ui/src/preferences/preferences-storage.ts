import { defaultFilesExclude, filesExcludeLimits, type FilesExclude } from "@novadeck/core/files"
import { viewModes } from "@novadeck/core/state"
import type { PreferencesValue } from "@novadeck/core/types"

import { soundChoiceOf } from "../sounds"
import { appearancePreferenceOf, defaultPreference } from "../theme/apply"
import { themes } from "../theme/themes"

export const preferencesStorageKey = "novadeck.preferences"

// The patterns for hiding files in every project as they were saved: the default where none were,
// as before there were any; a pattern's switch where it has one, under a pattern as long as a
// pattern may be. Anything else, as a `when` clause, is dropped and the rest kept.
const filesExcludeOf = (saved: unknown): FilesExclude =>
  typeof saved === "object" && saved !== null && !Array.isArray(saved)
    ? Object.fromEntries(
        Object.entries(saved).filter(
          ([pattern, on]) =>
            typeof on === "boolean" &&
            pattern.length > 0 &&
            pattern.length <= filesExcludeLimits.pattern,
        ),
      )
    : defaultFilesExclude

export const readPreferences = (): PreferencesValue => {
  const defaults: PreferencesValue = {
    fontSize: 13,
    enabledViews: [...viewModes],
    appearance: defaultPreference(themes),
    notifyNeeds: true,
    notifyFinished: true,
    sound: true,
    soundVolume: 0.6,
    soundChoice: "theme",
    ligatures: false,
    chatView: false,
    agentAvatars: false,
    filesExclude: defaultFilesExclude,
  }
  try {
    const saved = JSON.parse(
      localStorage.getItem(preferencesStorageKey) ?? "null",
    ) as Partial<PreferencesValue> | null
    const enabledViews = Array.isArray(saved?.enabledViews)
      ? viewModes.filter((mode) => saved.enabledViews!.includes(mode))
      : defaults.enabledViews
    return {
      enabledViews: enabledViews.length ? enabledViews : defaults.enabledViews,
      fontSize: [12, 13, 15].includes(saved?.fontSize ?? 0) ? saved!.fontSize! : defaults.fontSize,
      appearance: appearancePreferenceOf(saved?.appearance, themes),
      notifyNeeds:
        typeof saved?.notifyNeeds === "boolean" ? saved.notifyNeeds : defaults.notifyNeeds,
      notifyFinished:
        typeof saved?.notifyFinished === "boolean" ? saved.notifyFinished : defaults.notifyFinished,
      sound: typeof saved?.sound === "boolean" ? saved.sound : defaults.sound,
      soundVolume:
        typeof saved?.soundVolume === "number" && Number.isFinite(saved.soundVolume)
          ? Math.min(1, Math.max(0, saved.soundVolume))
          : defaults.soundVolume,
      soundChoice: soundChoiceOf(saved?.soundChoice),
      ligatures: typeof saved?.ligatures === "boolean" ? saved.ligatures : defaults.ligatures,
      chatView: typeof saved?.chatView === "boolean" ? saved.chatView : defaults.chatView,
      agentAvatars:
        typeof saved?.agentAvatars === "boolean" ? saved.agentAvatars : defaults.agentAvatars,
      filesExclude: filesExcludeOf(saved?.filesExclude),
    }
  } catch {
    return defaults
  }
}

export const writePreferences = (preferences: PreferencesValue): void => {
  try {
    localStorage.setItem(preferencesStorageKey, JSON.stringify(preferences))
  } catch {
    /* Preferences still apply when storage is unavailable. */
  }
}
