import { describe, expect, it } from 'vitest'
import type { PanelLayout, PanelType } from './types'
import {
  CANONICAL_PANEL_LAYOUTS,
  getCanonicalPanelLayout,
  getCollectivePanelBounds,
  mergePanelLayouts,
  PANEL_TYPES,
  resetAllPanelLayouts,
  resetPanelLayoutSize,
} from './panelLayout'

describe('panel layout helpers', () => {
  it('contains exactly one canonical layout for every panel type', () => {
    expect(CANONICAL_PANEL_LAYOUTS).toHaveLength(PANEL_TYPES.length)
    expect(new Set(CANONICAL_PANEL_LAYOUTS.map((layout) => layout.panelType))).toEqual(new Set<PanelType>(PANEL_TYPES))
  })

  it('retains persisted positions and dimensions', () => {
    const persisted: PanelLayout[] = [
      { panelType: 'spotify', x: 10, y: 20, w: 900, h: 1100 },
      { panelType: 'slideshow', x: 30, y: 40, w: 700, h: 800 },
      { panelType: 'notes', x: 50, y: 60, w: 600, h: 900 },
    ]
    expect(mergePanelLayouts(persisted)).toEqual(persisted)
  })

  it('adds a missing canonical panel', () => {
    const spotify = { panelType: 'spotify', x: 1, y: 2, w: 3, h: 4 } as const
    const merged = mergePanelLayouts([spotify])
    expect(merged.find((layout) => layout.panelType === 'spotify')).toEqual(spotify)
    expect(merged.find((layout) => layout.panelType === 'slideshow')).toEqual(getCanonicalPanelLayout('slideshow'))
    expect(merged.find((layout) => layout.panelType === 'notes')).toEqual(getCanonicalPanelLayout('notes'))
  })

  it('resets a panel size around its existing centre', () => {
    const reset = resetPanelLayoutSize({ panelType: 'spotify', x: 100, y: 200, w: 800, h: 1000 })
    expect(reset).toEqual({ panelType: 'spotify', x: 270, y: 340, w: 460, h: 720 })
  })

  it('uses the selected panel type canonical dimensions', () => {
    const reset = resetPanelLayoutSize({ panelType: 'notes', x: 0, y: 0, w: 500, h: 700 })
    expect(reset.w).toBe(getCanonicalPanelLayout('notes').w)
    expect(reset.h).toBe(getCanonicalPanelLayout('notes').h)
  })

  it('reset-all returns independent canonical layouts', () => {
    const reset = resetAllPanelLayouts()
    expect(reset).toEqual(CANONICAL_PANEL_LAYOUTS)
    expect(reset[0]).not.toBe(CANONICAL_PANEL_LAYOUTS[0])
  })

  it('handles duplicates deterministically by retaining the first layout', () => {
    const first = { panelType: 'spotify', x: 1, y: 2, w: 500, h: 600 } as const
    const duplicate = { panelType: 'spotify', x: 9, y: 9, w: 900, h: 900 } as const
    expect(mergePanelLayouts([first, duplicate])[0]).toEqual(first)
  })

  it('calculates fit bounds without mutating panel dimensions', () => {
    const layouts = resetAllPanelLayouts()
    const dimensions = layouts.map(({ w, h }) => ({ w, h }))
    expect(getCollectivePanelBounds(layouts)).toEqual({ x: -720, y: -300, w: 1460, h: 720 })
    expect(layouts.map(({ w, h }) => ({ w, h }))).toEqual(dimensions)
  })
})
