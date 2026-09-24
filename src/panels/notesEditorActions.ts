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
 *
 * `openEmojiList` is the writing tools' route to the list `:` opens. Every
 * other tool on that bar acts where the caret is; an emoji has to be chosen
 * from somewhere first, and the somewhere already exists. The menu
 * registers what it does through `registerEmojiOpener`, so the button does
 * not have to know how the list is triggered.
 *
 * `openLinkEditor` is the same shape of thing for the link popover: two
 * separate bars need to open it, and it needs to look at the selection to
 * decide whether it is creating a link or editing one already there, which
 * is a decision only the popover itself is in a position to make.
 */
export interface NotesEditorActions {
  run(action: (ctx: Ctx) => void): void
  addKeyHandler(handler: (event: KeyboardEvent) => boolean): () => void
  openEmojiList(): void
  registerEmojiOpener(open: () => void): () => void
  openLinkEditor(): void
  registerLinkEditorOpener(open: () => void): () => void
}

export const NotesEditorActionsContext = createContext<NotesEditorActions>({
  run: () => {},
  addKeyHandler: () => () => {},
  openEmojiList: () => {},
  registerEmojiOpener: () => () => {},
  openLinkEditor: () => {},
  registerLinkEditorOpener: () => () => {},
})

export function useNotesEditorActions() {
  return useContext(NotesEditorActionsContext)
}
