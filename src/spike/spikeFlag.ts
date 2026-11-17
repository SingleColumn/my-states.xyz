/**
 * SPIKES S1 to S3, throwaway. Whether the front-of-canvas layer is showing
 * (Editor mode) and whether the hidden-canvas guards are applied.
 *
 * Starts from localStorage `mic:spike-s1` = `1` (start in Editor mode; kept
 * up to date by the mode switch, so the last mode used is remembered) and
 * `mic:spike-guards` = `1` (guards on). Both can be changed at runtime from
 * the console through `window.__spike`, so a switch can be tested as well as
 * a start.
 */
function read(key: string) {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

type Listener = () => void
const listeners = new Set<Listener>()
const state = { editorMode: read('mic:spike-s1'), guards: read('mic:spike-guards') }

export const spikeState = {
  get: () => state,
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  set(next: Partial<typeof state>) {
    Object.assign(state, next)
    // The mode is remembered, so the app opens in whichever was used last.
    if (next.editorMode !== undefined) {
      try {
        if (next.editorMode) window.localStorage.setItem('mic:spike-s1', '1')
        else window.localStorage.removeItem('mic:spike-s1')
      } catch {
        // Storage can be blocked; the switch still works for this visit.
      }
    }
    // A new object so useSyncExternalStore sees a change.
    snapshot = { ...state }
    document.documentElement.toggleAttribute('data-spike-s1', state.editorMode)
    listeners.forEach((listener) => listener())
  },
}

let snapshot = { ...state }
export const getSpikeSnapshot = () => snapshot

/** Read once at module load by code that has not been made reactive. */
export const isSpikeS1On = state.editorMode
