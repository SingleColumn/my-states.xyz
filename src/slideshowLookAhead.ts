import type { ImageItem } from './types'

/**
 * The one picture an Images panel is getting ready to show next, while the
 * current one is still on screen. Runtime only: it never reaches the panel
 * shape, an archive or IndexedDB.
 */
export interface SlideshowLookAhead {
  /** The index the running timer will show when it fires. */
  index: number
  /** Off-screen and never attached; null when there is nothing worth decoding. */
  preload: HTMLImageElement | null
  /** For tests and diagnostics; playback never waits on it. */
  status: 'idle' | 'pending' | 'ready' | 'failed'
}

/** The slice of a panel's playback runtime the look-ahead works on. */
export interface SlideshowAdvanceState {
  images: ImageItem[]
  currentIndex: number
  timerId: number | null
  lookAhead: SlideshowLookAhead | null
}

export type CreateImage = () => HTMLImageElement

const createWindowImage: CreateImage = () => new window.Image()

/**
 * Drops the queued picture. The URL is not revoked: it belongs to the image
 * runtime and is still in use by the panel. Dropping the reference is what
 * lets the browser reclaim the decoded bitmap.
 */
export function clearLookAhead(state: SlideshowAdvanceState) {
  state.lookAhead = null
}

/** Stops the pending advance and discards what it had queued. */
export function cancelAdvance(state: SlideshowAdvanceState) {
  if (state.timerId !== null) window.clearTimeout(state.timerId)
  state.timerId = null
  clearLookAhead(state)
}

/**
 * Queues `index` as the next picture and starts loading and decoding it now,
 * replacing whatever was queued before. A single picture needs no preloader:
 * it is already the one showing.
 */
export function queueLookAhead(state: SlideshowAdvanceState, index: number, createImage: CreateImage = createWindowImage) {
  const image = state.images[index]
  const worthPreparing = image && state.images.length > 1 && index !== state.currentIndex
  const entry: SlideshowLookAhead = { index, preload: null, status: 'idle' }
  state.lookAhead = entry
  if (!worthPreparing) return entry

  const preload = createImage()
  entry.preload = preload
  entry.status = 'pending'
  // A settled promise cannot be cancelled, and the same panel may have queued
  // something else by the time this one finishes (a new collection, Next, a
  // board switch). Identity is the guard: only the entry still queued may
  // record a result.
  const settle = (status: 'ready' | 'failed') => {
    if (state.lookAhead === entry && entry.status === 'pending') entry.status = status
  }
  const loaded = () => settle('ready')
  preload.addEventListener('error', () => settle('failed'), { once: true })
  preload.src = image.url
  if (typeof preload.decode === 'function') {
    // SVGs and some browser/image pairs reject decode() yet still display;
    // the panel's own decode on change is the fallback either way.
    preload.decode().then(loaded, () => {
      if (preload.complete) loaded()
      else preload.addEventListener('load', loaded, { once: true })
    })
  } else {
    preload.addEventListener('load', loaded, { once: true })
  }
  return entry
}

/**
 * Starts the timer for the next advance and, in the same step, chooses the
 * picture it will show and starts preparing it. Choosing at schedule time is
 * the point: the picture can decode during the interval, and a shuffle is
 * rolled once, so the timer shows exactly what was prepared. The timer is
 * never stretched to wait for the decode; an unfinished one is picked up by
 * the panel's crossfade, which decodes on change anyway.
 */
export function startAdvanceTimer(
  state: SlideshowAdvanceState,
  intervalMs: number,
  chooseNext: () => number,
  advance: (index: number | null) => void,
  createImage: CreateImage = createWindowImage,
) {
  state.timerId = window.setTimeout(() => {
    state.timerId = null
    const queued = state.lookAhead && state.lookAhead.index < state.images.length ? state.lookAhead.index : null
    clearLookAhead(state)
    advance(queued)
  }, intervalMs)
  if (state.images.length) queueLookAhead(state, chooseNext(), createImage)
}

/**
 * Replaces a queued picture that was chosen from a position or setting that
 * no longer holds (Next, Previous, a thumbnail, a shuffle toggle, a board
 * switch), keeping the running timer's deadline rather than restarting the
 * full interval.
 */
export function refreshLookAhead(state: SlideshowAdvanceState, chooseNext: () => number, createImage: CreateImage = createWindowImage) {
  clearLookAhead(state)
  if (state.timerId === null || !state.images.length) return
  queueLookAhead(state, chooseNext(), createImage)
}
