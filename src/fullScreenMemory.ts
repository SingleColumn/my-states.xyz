import type { PanelLayout } from './types'

/**
 * Which panel a board was left expanded to full screen, and the size it
 * should go back to.
 *
 * The panel's geometry is in the board's document and survives a reload on
 * its own; what does not is the knowledge that the geometry is a full-screen
 * one. Without it a reloaded panel is merely a very large card -- it keeps
 * its rounded corners and its title becomes a form field again, because
 * every one of those follows from the app knowing it is expanded.
 *
 * Kept here rather than in the shape's props, beside the note text size and
 * the other `mic:` preferences, because it is about this window and not
 * about the board: it should not travel inside an exported archive, land
 * in the undo history, or follow the board onto someone else's screen. The
 * camera is persisted with the board and this is not, which is the one
 * judgement in this file worth arguing with.
 */
export interface FullScreenMemory {
  panelId: string
  /** Where the panel was before it filled the window. */
  restore: PanelLayout
}

const storageKey = (boardId: string) => `mic:full-screen:${boardId}`

export function rememberFullScreen(boardId: string, memory: FullScreenMemory) {
  try {
    window.localStorage.setItem(storageKey(boardId), JSON.stringify(memory))
  } catch {
    // Private browsing or storage disabled: the panel is still expanded now,
    // it simply will not be after a reload.
  }
}

export function forgetFullScreen(boardId: string) {
  try {
    window.localStorage.removeItem(storageKey(boardId))
  } catch {
    // Nothing was remembered, so nothing is left behind.
  }
}

export function readFullScreen(boardId: string): FullScreenMemory | null {
  try {
    const raw = window.localStorage.getItem(storageKey(boardId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FullScreenMemory>
    const restore = parsed.restore
    // Checked rather than trusted: this is a string a person can edit, and a
    // bad one would put a panel somewhere it cannot be found.
    if (typeof parsed.panelId !== 'string' || !restore) return null
    const numbers = [restore.x, restore.y, restore.w, restore.h]
    if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
    if (restore.w <= 0 || restore.h <= 0) return null
    return { panelId: parsed.panelId, restore }
  } catch {
    return null
  }
}
