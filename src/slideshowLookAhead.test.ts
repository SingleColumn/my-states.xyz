import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelAdvance, queueLookAhead, refreshLookAhead, startAdvanceTimer, type CreateImage, type SlideshowAdvanceState } from './slideshowLookAhead'
import type { ImageItem } from './types'

/** An off-screen image whose load, error and decode the test settles by hand. */
class FakeImage {
  src = ''
  complete = false
  #listeners = new Map<string, Array<() => void>>()
  #resolveDecode = () => {}
  #rejectDecode = (_reason: Error) => {}
  #decode = new Promise<void>((resolve, reject) => { this.#resolveDecode = resolve; this.#rejectDecode = reject })
  addEventListener(type: string, listener: () => void) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
  }
  decode() { return this.#decode }
  finishDecode() { this.complete = true; this.#resolveDecode() }
  failDecode() { this.#rejectDecode(new Error('EncodingError')) }
  fire(type: 'load' | 'error') {
    this.complete = true
    this.#listeners.get(type)?.forEach((listener) => listener())
    this.#listeners.delete(type)
  }
}

function imagesNamed(...names: string[]): ImageItem[] {
  return names.map((name) => ({ id: name, boardId: 'b', filename: name, mimeType: 'image/jpeg', name, size: 1, lastModified: 1, width: 10, height: 10, url: `blob:${name}`, urlKind: 'object-url' as const }))
}

function playbackOf(images: ImageItem[], currentIndex = 0): SlideshowAdvanceState {
  return { images, currentIndex, timerId: null, lookAhead: null }
}

let created: FakeImage[] = []
const createImage: CreateImage = () => {
  const image = new FakeImage()
  created.push(image)
  return image as unknown as HTMLImageElement
}
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve)).then(() => Promise.resolve())

// The test setup gives node a window whose timers were bound before fake
// timers could be installed; point them at the faked globals.
const realWindowTimers = { setTimeout: window.setTimeout, clearTimeout: window.clearTimeout }
beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(window, {
    setTimeout: (handler: () => void, ms?: number) => globalThis.setTimeout(handler, ms),
    clearTimeout: (id?: number) => globalThis.clearTimeout(id),
  })
  created = []
})
afterEach(() => {
  Object.assign(window, realWindowTimers)
  vi.useRealTimers()
})

describe('slideshow look-ahead', () => {
  it('prepares the next picture as soon as the advance is scheduled, and the timer shows that one', () => {
    const state = playbackOf(imagesNamed('a', 'b', 'c'))
    const advance = vi.fn()
    startAdvanceTimer(state, 6000, () => (state.currentIndex + 1) % state.images.length, advance, createImage)
    expect(state.lookAhead).toMatchObject({ index: 1, status: 'pending' })
    expect(created).toHaveLength(1)
    expect(created[0].src).toBe('blob:b')
    vi.advanceTimersByTime(5999)
    expect(advance).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(advance).toHaveBeenCalledWith(1)
    expect(state.lookAhead).toBeNull()
  })

  it('rolls a shuffle once, at schedule time, and shows exactly that roll', () => {
    const state = playbackOf(imagesNamed('a', 'b', 'c', 'd', 'e'))
    const roll = vi.fn(() => 3)
    const advance = vi.fn()
    startAdvanceTimer(state, 1000, roll, advance, createImage)
    expect(roll).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(roll).toHaveBeenCalledTimes(1)
    expect(advance).toHaveBeenCalledWith(3)
  })

  it('keeps one preloader per panel, and a replaced one cannot record its late result', async () => {
    const state = playbackOf(imagesNamed('a', 'b', 'c'))
    const first = queueLookAhead(state, 1, createImage)
    const second = queueLookAhead(state, 2, createImage)
    expect(state.lookAhead).toBe(second)
    expect(state.lookAhead?.preload).toBe(created[1])
    created[0].finishDecode()
    await settle()
    expect(first.status).toBe('pending')
    expect(second.status).toBe('pending')
    created[1].finishDecode()
    await settle()
    expect(second.status).toBe('ready')
  })

  it('a cancelled advance never fires and leaves nothing queued, and a late decode changes nothing', async () => {
    const state = playbackOf(imagesNamed('a', 'b', 'c'))
    const advance = vi.fn()
    startAdvanceTimer(state, 1000, () => 1, advance, createImage)
    const abandoned = state.lookAhead!
    cancelAdvance(state)
    expect(state.timerId).toBeNull()
    expect(state.lookAhead).toBeNull()
    created[0].finishDecode()
    await settle()
    expect(abandoned.status).toBe('pending')
    vi.advanceTimersByTime(5000)
    expect(advance).not.toHaveBeenCalled()
  })

  it('a refreshed target keeps the timer deadline instead of restarting the interval', () => {
    const state = playbackOf(imagesNamed('a', 'b', 'c', 'd'))
    const advance = vi.fn()
    startAdvanceTimer(state, 1000, () => 1, advance, createImage)
    vi.advanceTimersByTime(600)
    state.currentIndex = 2 // Next was pressed
    refreshLookAhead(state, () => 3, createImage)
    expect(state.lookAhead).toMatchObject({ index: 3 })
    expect(created.map((image) => image.src)).toEqual(['blob:b', 'blob:d'])
    vi.advanceTimersByTime(400)
    expect(advance).toHaveBeenCalledWith(3)
  })

  it('a refresh with no timer running queues nothing', () => {
    const state = playbackOf(imagesNamed('a', 'b'))
    refreshLookAhead(state, () => 1, createImage)
    expect(state.lookAhead).toBeNull()
    expect(created).toHaveLength(0)
  })

  it('one picture or none allocates no preloader', () => {
    const one = playbackOf(imagesNamed('a'))
    startAdvanceTimer(one, 1000, () => 0, vi.fn(), createImage)
    expect(created).toHaveLength(0)
    expect(one.lookAhead?.preload ?? null).toBeNull()
    const none = playbackOf([])
    const advance = vi.fn()
    startAdvanceTimer(none, 1000, () => 0, advance, createImage)
    expect(none.lookAhead).toBeNull()
    expect(created).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    expect(advance).toHaveBeenCalledWith(null)
  })

  it('two panels keep their own targets and preloaders', () => {
    const left = playbackOf(imagesNamed('a', 'b', 'c'))
    const right = playbackOf(imagesNamed('x', 'y', 'z'), 1)
    startAdvanceTimer(left, 1000, () => 1, vi.fn(), createImage)
    startAdvanceTimer(right, 1000, () => 2, vi.fn(), createImage)
    expect(left.lookAhead?.index).toBe(1)
    expect(right.lookAhead?.index).toBe(2)
    expect(left.lookAhead?.preload).not.toBe(right.lookAhead?.preload)
    cancelAdvance(left)
    expect(right.lookAhead?.index).toBe(2)
  })

  it('a rejected decode or a failed load does not hold up the timer', async () => {
    const state = playbackOf(imagesNamed('a', 'b', 'c'))
    const advance = vi.fn()
    startAdvanceTimer(state, 1000, () => 1, advance, createImage)
    created[0].failDecode()
    created[0].fire('error')
    await settle()
    expect(state.lookAhead?.status).toBe('failed')
    vi.advanceTimersByTime(1000)
    expect(advance).toHaveBeenCalledWith(1)
  })

  it('a decode still unfinished at the deadline does not hold up the timer either', () => {
    const state = playbackOf(imagesNamed('a', 'b'))
    const advance = vi.fn()
    startAdvanceTimer(state, 1000, () => 1, advance, createImage)
    vi.advanceTimersByTime(1000)
    expect(advance).toHaveBeenCalledWith(1)
  })

  it('a decode() that rejects for an image that still loads counts as ready', async () => {
    const state = playbackOf(imagesNamed('a', 'b'))
    queueLookAhead(state, 1, createImage)
    created[0].failDecode()
    await settle()
    created[0].fire('load')
    expect(state.lookAhead?.status).toBe('ready')
  })
})
