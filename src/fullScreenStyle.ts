import { useSyncExternalStore } from 'react'

/**
 * How a full-screen panel and the top toolbar meet. Three treatments, kept
 * side by side so they can be compared in the running app rather than
 * argued about from a stylesheet.
 *
 * - `card`    the panel keeps its rounded corners, border and shadow, and
 *             the toolbar keeps its 6px inset. Canvas shows through at the
 *             panel's corners and in a band around the toolbar.
 * - `flush`   both go square and edge to edge: the toolbar becomes a band
 *             across the top of a panel that is the window. No canvas.
 * - `overlay` the panel runs to the very top, behind the toolbar, and the
 *             toolbar floats on the page itself. No canvas either, and the
 *             toolbar is the same shape it is everywhere else.
 *
 * This is a comparison device, not a settled setting. Once one of the three
 * is chosen the other two should go, along with this module.
 */
export type FullScreenStyle = 'card' | 'flush' | 'overlay'

export const fullScreenStyles: Array<{ value: FullScreenStyle; label: string; hint: string }> = [
  { value: 'card', label: 'Card', hint: 'Rounded corners and a floating toolbar, with canvas showing between them' },
  { value: 'flush', label: 'Flush', hint: 'Square panel, toolbar as a band across the top, no canvas visible' },
  { value: 'overlay', label: 'Overlay', hint: 'The page runs to the top of the window and the toolbar floats on it' },
]

const storageKey = 'mic:full-screen-style'
const listeners = new Set<() => void>()

function read(): FullScreenStyle {
  try {
    const stored = window.localStorage.getItem(storageKey)
    return fullScreenStyles.some((style) => style.value === stored) ? stored as FullScreenStyle : 'card'
  } catch {
    // Private browsing or storage disabled: the default is no worse than today.
    return 'card'
  }
}

let current = read()

export function getFullScreenStyle() {
  return current
}

export function setFullScreenStyle(next: FullScreenStyle) {
  if (next === current) return
  current = next
  try {
    window.localStorage.setItem(storageKey, next)
  } catch {
    // The choice still holds for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useFullScreenStyle() {
  return useSyncExternalStore(subscribe, getFullScreenStyle)
}
