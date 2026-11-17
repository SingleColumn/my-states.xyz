import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * A panel's passing view choices (grid or carousel, an open list, a search
 * being typed), kept for as long as the page is open.
 *
 * The same panel can be drawn in more than one place over a visit: on the
 * canvas, and as a window in Editor mode. Each place draws its own copy, so
 * state held only inside a copy is lost whenever the view changes, and the
 * panel comes back as it was when it first opened. Kept here instead, each
 * copy starts from where the last one left off.
 *
 * Deliberately not saved with the board: these are moment-to-moment choices,
 * and a fresh visit starts from the panel's saved settings as before.
 */
const values = new Map<string, unknown>()

/**
 * `useState`, remembered per panel under `key`. With no `scope` (a component
 * drawn outside any panel), it is plain `useState`.
 */
export function usePanelSessionState<T>(scope: string | undefined, key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const id = scope === undefined ? undefined : `${scope}\u0000${key}`
  const [value, setValue] = useState<T>(() => (
    id !== undefined && values.has(id) ? (values.get(id) as T) : typeof initial === 'function' ? (initial as () => T)() : initial
  ))
  // Recorded after every change, so the next copy drawn starts from it.
  useEffect(() => {
    if (id !== undefined) values.set(id, value)
  }, [id, value])
  return [value, setValue]
}

/** For tests: forget everything remembered. */
export function clearPanelSessionState() {
  values.clear()
}
