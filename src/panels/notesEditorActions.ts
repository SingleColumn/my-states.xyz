import { createContext, useContext } from 'react'
import type { Ctx } from '@milkdown/ctx'

/**
 * How React-rendered editor UI (the formatting tooltip, later the insert
 * menu) reaches the editor it floats over. `run` hands the callback the
 * editor's context, the same object the commands and the view live in;
 * it is a no-op until the editor has been created.
 */
export interface NotesEditorActions {
  run(action: (ctx: Ctx) => void): void
}

export const NotesEditorActionsContext = createContext<NotesEditorActions>({ run: () => {} })

export function useNotesEditorActions() {
  return useContext(NotesEditorActionsContext)
}
