import { describe, expect, it } from 'vitest'
import { applyPanelFocusViewSize, getFullScreenPanelLayout, getDefaultPanelSize, restorePanelDefaultLayout, restorePanelDefaultSize } from './panelGeometry'
import { isPanelInFocusView } from './panelLayout'

describe('panel geometry commands', () => {
  it('derives full-screen geometry from the current screen viewport and converts to page space', () => {
    const result = getFullScreenPanelLayout(
      { x: 10, y: 20, w: 1200, h: 800 },
      80,
      ({ x, y }) => ({ x: (x - 100) / 2, y: (y - 40) / 2 }),
    )
    expect(result).toEqual({ x: -37, y: 28, w: 584, h: 354 })
  })

  it('uses canonical dimensions per panel type while the size-only helper preserves position', () => {
    const layout = { panelId: 'panel-a', x: 123, y: 456, w: 900, h: 700 }
    expect(getDefaultPanelSize('notes')).toEqual({ w: 460, h: 720 })
    expect(getDefaultPanelSize('slideshow')).toEqual({ w: 460, h: 720 })
    expect(restorePanelDefaultSize(layout, 'notes')).toEqual({ ...layout, w: 460, h: 720 })
    expect(restorePanelDefaultSize(layout, 'spotify')).toEqual({ ...layout, w: 460, h: 720 })
  })

  it('restores the canonical position and size used by Reset panel layout', () => {
    const layout = { panelId: 'panel-a', x: 123, y: 456, w: 900, h: 700 }
    expect(restorePanelDefaultLayout(layout, 'notes')).toEqual({ panelId: 'panel-a', x: 280, y: -300, w: 460, h: 720 })
    expect(restorePanelDefaultLayout(layout, 'spotify')).toEqual({ panelId: 'panel-a', x: -720, y: -300, w: 460, h: 720 })
  })

  it('shrinks a panel to its focus view size where one exists, leaving it in place', () => {
    const layout = { panelId: 'panel-a', x: 123, y: 456, w: 900, h: 700 }
    expect(applyPanelFocusViewSize(layout, 'spotify')).toEqual({ ...layout, w: 380, h: 460 })
    // Only the Music panel offers a focus view; the others keep their own size.
    expect(applyPanelFocusViewSize(layout, 'notes')).toEqual({ ...layout, w: 460, h: 720 })
  })

  it('treats a panel saved before focus view existed as showing its whole contents', () => {
    expect(isPanelInFocusView({})).toBe(false)
    expect(isPanelInFocusView({ focusView: false })).toBe(false)
    expect(isPanelInFocusView({ focusView: true })).toBe(true)
  })

  it('keeps previous geometry independent for duplicated panel IDs', () => {
    const previous = new Map([
      ['panel-a', { x: 1, y: 2, w: 300, h: 400 }],
      ['panel-b', { x: 9, y: 8, w: 500, h: 600 }],
    ])
    previous.delete('panel-a')
    expect(previous.get('panel-b')).toEqual({ x: 9, y: 8, w: 500, h: 600 })
  })
})
