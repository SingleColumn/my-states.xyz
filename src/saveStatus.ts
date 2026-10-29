export type SaveStatus = 'saved' | 'saving' | 'failed'

/**
 * Whether the open board's changes have reached storage, for the label beside
 * the board picker.
 *
 * It is an external store, not React state in the board hook: the document is
 * written on every pause in editing, and a state update there would re-render
 * everything that reads the board state. Only the label subscribes, so a save
 * re-renders the label alone.
 */
export interface SaveStatusStore {
  get(): SaveStatus
  subscribe(listener: () => void): () => void
  /** A write was queued (true) or the queue emptied (false). Emptying never hides a failure. */
  markBusy(busy: boolean): void
  markFailed(): void
}

export function createSaveStatusStore(): SaveStatusStore {
  let status: SaveStatus = 'saved'
  const listeners = new Set<() => void>()

  function set(next: SaveStatus) {
    if (next === status) return
    status = next
    listeners.forEach((listener) => listener())
  }

  return {
    get: () => status,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    markBusy(busy) {
      if (busy) set('saving')
      else if (status === 'saving') set('saved')
    },
    markFailed: () => set('failed'),
  }
}
