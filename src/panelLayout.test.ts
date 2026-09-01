import { describe, expect, it } from 'vitest'
import type { PanelLayout } from './types'
import { getCanonicalPanelLayout, getCollectivePanelBounds, mergePanelLayouts, resetPanelLayoutSize } from './panelLayout'

describe('panel layout helpers', () => {
  const layouts: PanelLayout[] = [
    { panelId: 'spotify-one', x: 10, y: 20, w: 900, h: 1100 },
    { panelId: 'slideshow-one', x: 30, y: 40, w: 700, h: 800 },
    { panelId: 'notes-one', x: 50, y: 60, w: 600, h: 900 },
  ]

  it('retains independent layouts by panel ID', () => {
    const duplicateType: PanelLayout = { panelId: 'spotify-two', x: 90, y: 100, w: 500, h: 600 }
    expect(mergePanelLayouts([...layouts, duplicateType])).toHaveLength(4)
  })

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
