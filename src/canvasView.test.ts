import { describe, expect, it } from 'vitest'
import {
  calculateFitCamera,
  FALLBACK_CHROME_HEIGHT,
  getChromeAwareInsets,
  getCollectiveBounds,
  getSelectedPanelBounds,
  getUsableViewport,
} from './canvasView'

const viewport = { x: 0, y: 0, w: 1720, h: 940 }

describe('canvas view calculations', () => {
  it('calculates the usable viewport below the measured chrome', () => {
    const insets = getChromeAwareInsets(76, viewport, 16)
    expect(getUsableViewport(viewport, insets)).toEqual({ x: 16, y: 92, w: 1688, h: 832 })
  })

  it('supports asymmetric insets', () => {
    expect(getUsableViewport(viewport, { top: 80, right: 30, bottom: 20, left: 10 }))
      .toEqual({ x: 10, y: 80, w: 1680, h: 840 })
  })

  it('uses a safe chrome fallback', () => {
    expect(getChromeAwareInsets(undefined, viewport, 16).top).toBe(FALLBACK_CHROME_HEIGHT + 16)
  })

  it('selects bounds only for exactly one selected panel', () => {
    const panels = [{ id: 'one', bounds: { x: 1, y: 2, w: 3, h: 4 } }, { id: 'two', bounds: { x: 5, y: 6, w: 7, h: 8 } }]
    expect(getSelectedPanelBounds(panels, ['two'])).toEqual(panels[1].bounds)
    expect(getSelectedPanelBounds(panels, [])).toBeNull()
    expect(getSelectedPanelBounds(panels, ['one', 'two'])).toBeNull()
  })

  it('calculates collective bounds without altering source panel data', () => {
    const panels = [{ x: -10, y: 20, w: 30, h: 40 }, { x: 50, y: -5, w: 20, h: 10 }]
    const snapshot = structuredClone(panels)
    expect(getCollectiveBounds(panels)).toEqual({ x: -10, y: -5, w: 80, h: 65 })
    expect(panels).toEqual(snapshot)
  })

  it('fits width-limited and height-limited bounds', () => {
    expect(calculateFitCamera({ x: 0, y: 0, w: 2000, h: 500 }, viewport, { top: 0, right: 0, bottom: 0, left: 0 }, 0.1, 8)?.z).toBeCloseTo(0.86)
    expect(calculateFitCamera({ x: 0, y: 0, w: 500, h: 2000 }, viewport, { top: 0, right: 0, bottom: 0, left: 0 }, 0.1, 8)?.z).toBeCloseTo(0.47)
  })

  it('centres content in a top-inset and asymmetrically inset workspace', () => {
    const camera = calculateFitCamera({ x: 0, y: 0, w: 1200, h: 1500 }, viewport, { top: 100, right: 40, bottom: 20, left: 20 }, 0.1, 8)
    expect(camera).not.toBeNull()
    const visibleCentreY = (750 + camera!.y) * camera!.z
    expect(visibleCentreY).toBeCloseTo(510)
    const visibleCentreX = (600 + camera!.x) * camera!.z
    expect(visibleCentreX).toBeCloseTo(850)
  })

  it('clamps zoom and handles missing or invalid bounds', () => {
    expect(calculateFitCamera({ x: 0, y: 0, w: 10, h: 10 }, viewport, { top: 0, right: 0, bottom: 0, left: 0 }, 0.25, 4)?.z).toBe(4)
    expect(calculateFitCamera({ x: 0, y: 0, w: 100000, h: 100000 }, viewport, { top: 0, right: 0, bottom: 0, left: 0 }, 0.25, 4)?.z).toBe(0.25)
    expect(calculateFitCamera(null, viewport, { top: 0, right: 0, bottom: 0, left: 0 }, 0.25, 4)).toBeNull()
    expect(calculateFitCamera({ x: 0, y: 0, w: 0, h: 10 }, viewport, { top: 0, right: 0, bottom: 0, left: 0 }, 0.25, 4)).toBeNull()
  })
})
