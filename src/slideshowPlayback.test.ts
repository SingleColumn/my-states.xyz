// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { panelRuntime, type PanelsState } from './AppState'
import { useSlideshowState } from './slideshowState'
import { defaultSlideshowSettings } from './panelRegistry'
import type { SlideshowLookAhead } from './slideshowLookAhead'
import type { Board, ImageItem, Panel, SlideshowSettings } from './types'

/**
 * The scheduler's side of the look-ahead: which of the hook's actions keep,
 * replace or discard the picture being prepared. The mechanism itself is
 * covered in slideshowLookAhead.test.ts.
 */

const panelId = 'panel_images'
const images: ImageItem[] = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ id: name, boardId: 'b1', filename: `${name}.jpg`, mimeType: 'image/jpeg', name, size: 1, lastModified: 1, width: 10, height: 10, url: `blob:${name}`, urlKind: 'object-url' as const }))

class FakeImage {
  static created: FakeImage[] = []
  src = ''
  complete = false
  constructor() { FakeImage.created.push(this) }
  addEventListener() {}
  decode() { return new Promise<void>(() => {}) }
}

function panelsWith(config: SlideshowSettings, isReady = true): PanelsState {
  const panel = { id: panelId, type: 'slideshow', visible: true, focusView: false, config } as Panel<'slideshow'>
  const all = isReady ? [panel] : []
  return {
    all,
    isReady,
    get: (id) => all.find((candidate) => candidate.id === id),
    updateConfig: (_id, patch) => { Object.assign(config, patch) },
    setVisible: () => {},
    setFocusView: () => {},
    add: () => null,
    attachEditor: () => {},
    markRestored: () => {},
  }
}

const runtimeOf = () => panelRuntime.slideshow.forPanel(panelId) as unknown as { lookAhead: SlideshowLookAhead | null, timerId: number | null, currentIndex: number }

function startPlaying(config: Partial<SlideshowSettings> = {}) {
  const settings: SlideshowSettings = { ...defaultSlideshowSettings, intervalMs: 6000, ...config }
  const board = { id: 'b1' } as Board
  const hook = renderHook(({ board, panels }) => useSlideshowState(board, panels), { initialProps: { board, panels: panelsWith(settings) } })
  panelRuntime.slideshow.update(panelId, { images })
  act(() => hook.result.current.setIsPlaying(true, panelId))
  return { hook, settings }
}

const nativeImage = window.Image
beforeEach(() => {
  vi.useFakeTimers()
  FakeImage.created = []
  window.Image = FakeImage as unknown as typeof window.Image
  // The runtime map outlives a hook; start each test from a panel that has never played.
  panelRuntime.slideshow.update(panelId, { images: [], isPlaying: false, currentIndex: 0, sourceKey: null, timerId: null, lookAhead: null })
})
afterEach(() => {
  cleanup()
  window.Image = nativeImage
  vi.useRealTimers()
})

describe('the slideshow scheduler and its look-ahead', () => {
  it('starts preparing the next picture as soon as playback starts, without moving the picture showing', () => {
    startPlaying()
    expect(runtimeOf().lookAhead).toMatchObject({ index: 1, status: 'pending' })
    expect(FakeImage.created.map((image) => image.src)).toEqual(['blob:b'])
    expect(runtimeOf().currentIndex).toBe(0)
  })

  it('a shuffled advance shows the picture chosen when the timer was set', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.3)
    const { settings } = startPlaying({ shuffle: true })
    expect(runtimeOf().lookAhead?.index).toBe(1)
    // A second roll would land on 4; the timer must not roll again.
    random.mockReturnValue(0.999)
    act(() => vi.advanceTimersByTime(settings.intervalMs))
    expect(runtimeOf().currentIndex).toBe(1)
    random.mockRestore()
  })

  it('pausing and stopping leave nothing queued', () => {
    const { hook } = startPlaying()
    act(() => hook.result.current.setIsPlaying(false, panelId))
    expect(runtimeOf().lookAhead).toBeNull()
    act(() => hook.result.current.setIsPlaying(true, panelId))
    expect(runtimeOf().lookAhead).not.toBeNull()
    act(() => hook.result.current.stop(panelId))
    expect(runtimeOf().lookAhead).toBeNull()
    expect(runtimeOf().timerId).toBeNull()
  })

  it('switching board leaves nothing queued from the board left', () => {
    const { hook, settings } = startPlaying()
    const previous = runtimeOf()
    hook.rerender({ board: { id: 'b2' } as Board, panels: panelsWith(settings, false) })
    expect(previous.lookAhead).toBeNull()
    expect(previous.timerId).toBeNull()
  })

  it('a new source leaves nothing queued from the old pictures', () => {
    const { hook, settings } = startPlaying()
    const next = { ...settings, imageSource: { type: 'bundled' as const, collectionId: 'elsewhere' } }
    hook.rerender({ board: { id: 'b1' } as Board, panels: panelsWith(next) })
    expect(runtimeOf().lookAhead).toBeNull()
    expect(runtimeOf().timerId).toBeNull()
  })

  it('Next, Previous and a thumbnail replace the queued picture and keep the deadline', () => {
    const { hook, settings } = startPlaying()
    act(() => vi.advanceTimersByTime(1000))
    act(() => hook.result.current.next(panelId))
    expect(runtimeOf().lookAhead?.index).toBe(2)
    act(() => hook.result.current.previous(panelId))
    expect(runtimeOf().lookAhead?.index).toBe(1)
    act(() => hook.result.current.updateSettings({ currentIndex: 3 }, panelId))
    expect(runtimeOf().lookAhead?.index).toBe(4)
    act(() => vi.advanceTimersByTime(settings.intervalMs - 1000))
    expect(runtimeOf().currentIndex).toBe(4)
  })

  it('toggling shuffle chooses the next picture again', () => {
    const { hook } = startPlaying()
    const before = runtimeOf().lookAhead
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.7)
    act(() => hook.result.current.updateSettings({ shuffle: true }, panelId))
    expect(runtimeOf().lookAhead).not.toBe(before)
    expect(runtimeOf().lookAhead?.index).toBe(3)
    random.mockRestore()
  })

  it('a new speed sets one new timer and one new preloader', () => {
    const { hook } = startPlaying()
    const before = { timerId: runtimeOf().timerId, lookAhead: runtimeOf().lookAhead }
    act(() => hook.result.current.updateSettings({ intervalMs: 3000 }, panelId))
    expect(runtimeOf().timerId).not.toBe(before.timerId)
    expect(runtimeOf().lookAhead).not.toBe(before.lookAhead)
    expect(FakeImage.created).toHaveLength(2)
    act(() => vi.advanceTimersByTime(3000))
    expect(runtimeOf().currentIndex).toBe(1)
  })
})
