import { filesExcludeLimits, type FilesExclude } from "@novadeck/core/files"
import { Checkbox } from "@novadeck/toolkit/Checkbox"
import { X } from "lucide-react"
import { useState } from "react"

const rowClasses = "settings-row flex min-h-10 items-center gap-2.5 px-3 py-1.5 text-body"

// A list of patterns for hiding files, each with its switch: checked hides what it matches,
// unchecked keeps the pattern but hides nothing with it, which in a project's list lifts the
// same pattern of the list for every project. Given `onChange`, a row's × removes it and the
// field under the rows adds one, switched on (or switches it on again); without, the list only
// shows them. Preferences edits the list for every project with it, and the Files panel's
// dialog a project's own, keeping the field's text to save what was typed and not added.
export const FilesExcludeList = ({
  patterns,
  label,
  onChange,
  inputId,
  field,
}: {
  readonly patterns: FilesExclude
  // The list's name, as a screen reader says it.
  readonly label: string
  readonly onChange?: ((patterns: FilesExclude) => void) | undefined
  // The id of the field that adds a pattern, for a label or focus to find it.
  readonly inputId?: string | undefined
  // The field's text, where its owner keeps it; the list keeps it otherwise.
  readonly field?: { readonly text: string; readonly onText: (text: string) => void } | undefined
}): React.JSX.Element => {
  const [own, setOwn] = useState("")
  const typed = field ? field.text : own
  const setTyped = field ? field.onText : setOwn
  const entries = Object.entries(patterns)
  // The field's form submits only with something typed: its button, the form's default, is
  // disabled until then, and Enter with it.
  const add = (change: (next: FilesExclude) => void): void => {
    change({ ...patterns, [typed.trim()]: true })
    setTyped("")
  }
  return (
    <div className="card settings-card files-exclude">
      <ul className="m-0 flex flex-col p-0" aria-label={label}>
        {entries.map(([pattern, on]) => (
          <li key={pattern} className={rowClasses}>
            <label
              className={`flex min-w-0 flex-1 items-center gap-2.5 ${onChange ? "cursor-pointer" : ""}`}
            >
              <Checkbox
                checked={on}
                disabled={!onChange}
                onChange={(next) => onChange?.({ ...patterns, [pattern]: next })}
              />
              <code className="files-exclude-pattern min-w-0 text-caption">{pattern}</code>
            </label>
            {onChange && (
              <button
                type="button"
                className="icon-button small dim quiet shrink-0"
                aria-label={`Remove ${pattern}`}
                onClick={() =>
                  onChange(Object.fromEntries(entries.filter(([each]) => each !== pattern)))
                }
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            )}
          </li>
        ))}
        {entries.length === 0 && (
          <li className={`${rowClasses} settings-description`}>No patterns.</li>
        )}
      </ul>
      {onChange && (
        <form
          className={rowClasses}
          onSubmit={(event) => {
            event.preventDefault()
            add(onChange)
          }}
        >
          <input
            id={inputId}
            className="field files-exclude-input min-w-0 flex-1 px-2 py-1 text-control"
            aria-label="Pattern to hide"
            placeholder="**/dist"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={filesExcludeLimits.pattern}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <button
            type="submit"
            className="button min-h-8 shrink-0 px-3 text-control"
            disabled={typed.trim() === ""}
          >
            Add
          </button>
        </form>
      )}
    </div>
  )
}
