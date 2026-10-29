export type SaveStatus = 'saved' | 'saving' | 'failed'

/** One writer of the app's data (the board queue, the notes queue) reporting into the shared status. */
export interface SaveStatusSource {
  /** Work was queued (true) or this writer's queue emptied (false). Emptying never hides a failure. */
  markBusy(busy: boolean): void
  markFailed(): void
}

/**
 * Whether the open board's changes have reached storage, for the label beside
 * the board picker. Board writes and note writes go through separate queues,
 * so the status combines them: any failure shows as failed, otherwise any
 * pending write shows as saving.
 *
 * It is an external store, not React state in the board hook: the document is
 * written on every pause in editing, and a state update there would re-render
 * everything that reads the board state. Only the label subscribes, so a save
 * re-renders the label alone.
 */
export interface SaveStatusStore {
  get(): SaveStatus
  subscribe(listener: () => void): () => void
  /** A new writer to report through. Each keeps its own state; the store reports the combination. */
  source(): SaveStatusSource
}

export function createSaveStatusStore(): SaveStatusStore {
  const sources = new Set<{ status: SaveStatus }>()
  const listeners = new Set<() => void>()
  let combined: SaveStatus = 'saved'

  function update() {
    const states = [...sources].map((source) => source.status)
    const next: SaveStatus = states.includes('failed') ? 'failed' : states.includes('saving') ? 'saving' : 'saved'
    if (next === combined) return
    combined = next
    listeners.forEach((listener) => listener())
  }

  return {
    get: () => combined,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    source() {
      const state = { status: 'saved' as SaveStatus }
      sources.add(state)
      return {
        markBusy(busy) {
          if (busy) state.status = 'saving'
          else if (state.status === 'saving') state.status = 'saved'
          update()
        },
        markFailed() {
          state.status = 'failed'
          update()
        },
      }
    },
  }
}
