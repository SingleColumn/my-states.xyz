import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PanelCommands } from '../PanelHeader'
import { PanelCommandsProvider } from '../PanelHeader'
import { SlideshowPanel } from './SlideshowPanel'

const panel = vi.hoisted(() => ({ focusView: false }))

const image = { id: 'image_1', sessionId: 's1', filename: 'dusk.jpg', mimeType: 'image/jpeg', name: 'dusk.jpg', size: 10, lastModified: 1, width: 1200, height: 800, url: 'blob:dusk', urlKind: 'object-url' as const }

vi.mock('../AppState', () => ({
  useAppState: () => ({
    slideshow: {
      settingsFor: () => ({ folderName: 'Trip', imageSource: { type: 'session-assets' }, currentIndex: 0, intervalMs: 2000, transitionMs: 400, shuffle: false, zoom: 1 }),
      imagesFor: () => [image],
      statusFor: () => 'Showing 1 of 1',
      errorFor: () => null,
      isPlayingFor: () => true,
      updateSettings: () => {},
      selectFolder: async () => true,
      selectBundledCollection: async () => {},
      importFiles: async () => {},
      resetFolder: async () => {},
      setIsPlaying: () => {},
      stop: () => {},
      next: () => {},
      previous: () => {},
    },
    moments: {
      activeMoment: {
        id: 'moment_focus',
        panels: [{
          id: 'panel_images',
          type: 'slideshow',
          focusView: panel.focusView,
          createdAt: 1,
          updatedAt: 1,
          config: { folderName: 'Trip', imageSource: { type: 'session-assets' }, currentIndex: 0, intervalMs: 2000, transitionMs: 400, shuffle: false, zoom: 1 },
        }],
      },
    },
  }),
}))

const commands: PanelCommands = {
  hidePanel: () => {},
  togglePanelFullScreen: () => {},
  restorePanelDefaultSize: () => {},
  isPanelFullScreen: () => false,
  togglePanelFocusView: () => {},
}

function renderImagesPanel(focusView: boolean) {
  panel.focusView = focusView
  return renderToStaticMarkup(createElement(PanelCommandsProvider, {
    commands,
    children: createElement(SlideshowPanel, { panelId: 'panel_images' }),
  }))
}

describe('Images panel focus view', () => {
  it('keeps the picture and nothing else', () => {
    const markup = renderImagesPanel(true)
    expect(markup).toContain('is-focus-view')
    expect(markup).toContain('slideshow-stage')
    expect(markup).toContain('blob:dusk')
    expect(markup).not.toContain('card-header')
    expect(markup).not.toContain('aria-label="Hide panel"')
  })

  it('tells the viewer that Escape brings the controls back', () => {
    // The header is gone with everything else, so the hint is the only thing
    // naming the way out.
    expect(renderImagesPanel(true)).toContain('focus-view-hint')
    expect(renderImagesPanel(false)).not.toContain('focus-view-hint')
  })

  it('drops the slideshow controls, the sliders, and the footer from the focus view', () => {
    const focused = renderImagesPanel(true)
    expect(focused).not.toContain('slideshow-controls')
    expect(focused).not.toContain('aria-label="Next image"')
    expect(focused).not.toContain('aria-label="Stop slideshow"')
    expect(focused).not.toContain('aria-label="Choose a local folder"')
    expect(focused).not.toContain('aria-label="Clear images"')
    expect(focused).not.toContain('>Speed ')
    expect(focused).not.toContain('>Fade ')
    expect(focused).not.toContain('>Zoom ')
    expect(focused).not.toContain('card-footer')

    const full = renderImagesPanel(false)
    expect(full).not.toContain('is-focus-view')
    expect(full).toContain('slideshow-controls')
    expect(full).toContain('aria-label="Next image"')
    expect(full).toContain('aria-label="Stop slideshow"')
    expect(full).toContain('>Speed ')
    expect(full).toContain('>Fade ')
    expect(full).toContain('>Zoom ')
    expect(full).toContain('card-footer')
    expect(full).toContain('aria-label="Choose a local folder"')
    expect(full).toContain('aria-label="Clear images"')
  })

  it('offers the focus view toggle from the panel header, before the hide button', () => {
    const markup = renderImagesPanel(false)
    expect(markup.indexOf('Reduce panel to focus view')).toBeLessThan(markup.indexOf('Hide panel'))
  })

  it('keeps the source buttons in the panel header', () => {
    const markup = renderImagesPanel(false)
    expect(markup).not.toContain('slideshow-source-row')
    for (const label of ['Show loaded images', 'Choose a local folder', 'Load a sample collection', 'Clear images']) {
      // In the header means before the shared panel controls, and well before
      // the transport row down in the body.
      expect(markup.indexOf(`aria-label="${label}"`)).toBeLessThan(markup.indexOf('aria-label="Hide panel"'))
      expect(markup.indexOf(`aria-label="${label}"`)).toBeLessThan(markup.indexOf('aria-label="Previous image"'))
    }
  })

  it('puts shuffle at the right end of the transport row, sized like its neighbours', () => {
    const markup = renderImagesPanel(false)
    expect(markup.indexOf('aria-label="Stop slideshow"')).toBeLessThan(markup.indexOf('aria-label="Shuffle images"'))
    expect(markup.indexOf('aria-label="Shuffle images"')).toBeLessThan(markup.indexOf('card-footer'))
    // A normal icon button, so it matches the transport buttons instead of
    // rendering smaller as it did in the footer.
    expect(markup).not.toContain('card-footer-button')
  })
})
