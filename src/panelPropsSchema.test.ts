import './test/setup'
import { describe, expect, it } from 'vitest'
import { T } from 'tldraw'
import { createPanel } from './storage'
import { PANEL_TYPES } from './panelLayout'
import {
  panelContentValidator,
  panelShapeMigrations,
  proposedPanelShapeProps,
  slideshowSettingsValidator,
} from './panelPropsSchema'

const proposedPropsValidator = T.object(proposedPanelShapeProps)

describe('panel config expressed as tldraw shape props (prototype)', () => {
  it('accepts every config the app creates today, unchanged', () => {
    for (const type of PANEL_TYPES) {
      const panel = createPanel(type)
      const content = { type: panel.type, config: panel.config }
      expect(panelContentValidator.validate(content)).toEqual(content)
    }
  })

  it('accepts a slideshow pointed at a bundled collection, and one at session assets', () => {
    const bundled = createPanel('slideshow')
    if (bundled.type !== 'slideshow') throw new Error('unexpected panel type')
    bundled.config = { ...bundled.config, imageSource: { type: 'bundled', collectionId: 'nightfall' }, currentIndex: 3, shuffle: true }
    expect(slideshowSettingsValidator.validate(bundled.config)).toEqual(bundled.config)
    const fromAssets = { ...bundled.config, imageSource: { type: 'session-assets' as const }, folderName: 'Holiday' }
    expect(slideshowSettingsValidator.validate(fromAssets)).toEqual(fromAssets)
  })

  it('rejects what the app would today silently persist', () => {
    // A negative index, a non-integer index, an unknown source, a config from
    // the wrong panel type: none of these can reach the tldraw store.
    expect(() => slideshowSettingsValidator.validate({ ...createPanel('slideshow').config, currentIndex: 1.5 })).toThrow()
    expect(() => slideshowSettingsValidator.validate({ ...createPanel('slideshow').config, imageSource: { type: 'folder' } })).toThrow()
    expect(() => panelContentValidator.validate({ type: 'notes', config: { playlist: null } })).toThrow()
    expect(() => panelContentValidator.validate({ type: 'video', config: {} })).toThrow()
  })

  it('validates a complete proposed shape prop set, so a store write is checked in full', () => {
    const notes = createPanel('notes')
    const props = { w: 460, h: 720, panelId: notes.id, panel: { type: notes.type, config: notes.config }, visible: true, focusView: false }
    expect(proposedPropsValidator.validate(props)).toEqual(props)
    expect(() => proposedPropsValidator.validate({ ...props, visible: 'yes' })).toThrow()
  })

  it('migrates a legacy { w, h, panelId } shape forward and back', () => {
    const migration = panelShapeMigrations.sequence[0]
    if (!('up' in migration)) throw new Error('expected a props migration, not a dependsOn marker')
    expect(migration.id).toBe('com.tldraw.shape.music-panel/1')
    const legacy: Record<string, unknown> = { w: 460, h: 720, panelId: 'panel-1' }
    migration.up(legacy)
    expect(() => proposedPropsValidator.validate(legacy)).not.toThrow()
    if (typeof migration.down !== 'function') throw new Error('expected a down migration')
    migration.down(legacy)
    expect(legacy).toEqual({ w: 460, h: 720, panelId: 'panel-1' })
  })
})
