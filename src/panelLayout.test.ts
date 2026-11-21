import { describe, expect, it } from 'vitest'
import type { PanelLayout } from './types'
import { getCanonicalPanelLayout, getCollectivePanelBounds, getPanelFocusViewSize, getPanelMinimumSize, resetPanelLayoutSize } from './panelLayout'

describe('panel layout helpers', () => {
  const layouts: PanelLayout[] = [
    { panelId: 'spotify-one', x: 10, y: 20, w: 900, h: 1100 },
    { panelId: 'slideshow-one', x: 30, y: 40, w: 700, h: 800 },
    { panelId: 'notes-one', x: 50, y: 60, w: 600, h: 900 },
  ]

  it('resets a panel size around its existing centre', () => {
    expect(resetPanelLayoutSize({ ...layouts[0], x: 100, y: 200, w: 800, h: 1000 }, 'spotify')).toEqual({ panelId: 'spotify-one', x: 270, y: 340, w: 460, h: 720 })
  })

  it('uses the selected panel type canonical dimensions', () => {
    const reset = resetPanelLayoutSize({ ...layouts[2], w: 500, h: 700 }, 'notes')
    expect(reset.w).toBe(getCanonicalPanelLayout('notes').w)
    expect(reset.h).toBe(getCanonicalPanelLayout('notes').h)
  })

  it('calculates fit bounds without mutating panel dimensions', () => {
    expect(getCollectivePanelBounds(layouts)).toEqual({ x: 10, y: 20, w: 900, h: 1100 })
  })
})

// A panel resized in focus view must be able to get back to the focus view's
// own size, so the floor there is no higher than that size.
describe('getPanelMinimumSize', () => {
  it('lets a panel in focus view shrink to its focus-view size', () => {
    const focus = getPanelFocusViewSize('spotify')!
    const minimum = getPanelMinimumSize('spotify', true)
    expect(minimum.h).toBeLessThanOrEqual(focus.h)
    expect(minimum.w).toBeLessThanOrEqual(focus.w)
  })

  it('keeps the usual floor outside focus view, and for panels with no focus-view size', () => {
    expect(getPanelMinimumSize('spotify')).toEqual({ w: 320, h: 260 })
    expect(getPanelMinimumSize('notes', true)).toEqual(getPanelMinimumSize('notes'))
  })
})
