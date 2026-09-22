import { createContext, useContext } from 'react'
import type { Ctx } from '@milkdown/ctx'

/**
 * How React-rendered editor UI (the formatting bar, the insert menu)
 * reaches the editor it floats over.
 *
 * `run` hands the callback the editor's context, the same object the
 * commands and the view live in; it is a no-op until the editor exists.
 *
 * `addKeyHandler` gives floating UI first refusal on keys typed *in the
 * editor*: the insert menu is driven from the keyboard while focus stays
 * on the text, so its arrow, Enter and Escape handling has to run before
 * the editor's own keymap turns Enter into a new paragraph. A handler
 * returns true to claim the key. The returned function unregisters it.
 */
export interface NotesEditorActions {
  run(action: (ctx: Ctx) => void): void
  addKeyHandler(handler: (event: KeyboardEvent) => boolean): () => void
}

export const NotesEditorActionsContext = createContext<NotesEditorActions>({
  run: () => {},
  addKeyHandler: () => () => {},
})

export function useNotesEditorActions() {
  return useContext(NotesEditorActionsContext)
}
