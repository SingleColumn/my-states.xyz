import './test/setup'
import { describe, expect, it } from 'vitest'
import { T, type TLStoreSnapshot } from 'tldraw'
import { createPanelProps, legacyContentFromDocument, panelFromShape, shapesForLegacyContent } from './panelStore'
import { panelContentValidator, panelShapeMigrations, panelShapeProps } from './panelShapeSchema'
import { PANEL_TYPES, getPanelDefinition } from './panelRegistry'
import { createPanel } from './storage'
import type { LegacyCanvasContent, Panel } from './types'

const propsValidator = T.object(panelShapeProps)

describe('panel shape schema', () => {
  it('accepts every configuration the registry creates, unchanged', () => {
    for (const type of PANEL_TYPES) {
      const props = createPanelProps(type)
      expect(propsValidator.validate(props)).toEqual(props)
    }
  })

  it('rejects what the old moment record would have persisted silently', () => {
    const slideshow = createPanelProps('slideshow')
    expect(() => panelContentValidator.validate({ type: 'slideshow', config: { ...slideshow.panel.config, currentIndex: 1.5 } })).toThrow()
    expect(() => panelContentValidator.validate({ type: 'slideshow', config: { ...slideshow.panel.config, imageSource: { type: 'folder' } } })).toThrow()
    expect(() => panelContentValidator.validate({ type: 'notes', config: { playlist: null } })).toThrow()
    expect(() => panelContentValidator.validate({ type: 'video', config: {} })).toThrow()
    expect(() => propsValidator.validate({ ...createPanelProps('notes'), visible: 'yes' })).toThrow()
  })

  it('migrates a shape written with only size and panelId', () => {
    const migration = panelShapeMigrations.sequence[0]
    if (!('up' in migration) || typeof migration.down !== 'function') throw new Error('expected a props migration with a down step')
    expect(migration.id).toBe('com.tldraw.shape.music-panel/1')
    const legacy: Record<string, unknown> = { w: 460, h: 720, panelId: 'panel-1' }
    migration.up(legacy)
    expect(() => propsValidator.validate(legacy)).not.toThrow()
    migration.down(legacy)
    expect(legacy).toEqual({ w: 460, h: 720, panelId: 'panel-1' })
  })
})

describe('pre-snapshot content and the document', () => {
  const legacy: LegacyCanvasContent = {
    panels: [
      { ...createPanel('spotify'), id: 'panel-music', focusView: true },
      { ...createPanel('slideshow'), id: 'panel-images', visible: false },
      { ...createPanel('notes'), id: 'panel-notes', config: { activeNoteId: 'note-1' } },
    ],
    canvas: {
      camera: { x: 1, y: 2, z: 0.5 },
      panels: [
        { panelId: 'panel-notes', x: 300, y: 10, w: 500, h: 600, rotation: 0.1, order: 0 },
        { panelId: 'panel-music', x: -700, y: 10, w: 400, h: 500, order: 1 },
      ],
    },
  }

  it('gives every panel a shape, in the saved order, with its saved place or its default one', () => {
    const shapes = shapesForLegacyContent(legacy)
    expect(shapes.map((shape) => shape.props?.panelId)).toEqual(['panel-notes', 'panel-music', 'panel-images'])
    expect(shapes[0]).toMatchObject({ x: 300, y: 10, rotation: 0.1, isLocked: false, props: { w: 500, h: 600, visible: true, focusView: false, panel: { type: 'notes', config: { activeNoteId: 'note-1' } } } })
    expect(shapes[1]).toMatchObject({ x: -700, props: { w: 400, focusView: true, panel: { type: 'spotify' } } })
    const images = shapes[2]
    expect(images).toMatchObject({ x: getPanelDefinition('slideshow').defaultLayout.x, isLocked: true, props: { visible: false } })
    expect(new Set(shapes.map((shape) => shape.id)).size).toBe(3)
  })

  it('reads the same content back out of a document, in stacking order', () => {
    const shapes = shapesForLegacyContent(legacy).map((shape, index) => ({
      ...shape,
      typeName: 'shape',
      parentId: 'page:page',
      index: ['a3', 'a1', 'a2'][index],
      opacity: 1,
      meta: {},
    }))
    const document = { store: Object.fromEntries(shapes.map((shape) => [shape.id, shape])), schema: { schemaVersion: 2, sequences: {} } } as unknown as TLStoreSnapshot
    const out = legacyContentFromDocument(document, { x: 1, y: 2, z: 0.5 })

    expect(out.panels.map((panel) => panel.id)).toEqual(['panel-music', 'panel-images', 'panel-notes'])
    expect(out.canvas?.camera).toEqual({ x: 1, y: 2, z: 0.5 })
    expect(out.canvas?.panels.map((layout) => layout.order)).toEqual([0, 1, 2])
    const notes = out.panels.find((panel): panel is Panel<'notes'> => panel.type === 'notes')
    expect(notes?.config.activeNoteId).toBe('note-1')
    expect(out.panels.find((panel) => panel.id === 'panel-images')?.visible).toBe(false)
    expect(out.panels.find((panel) => panel.id === 'panel-music')?.focusView).toBe(true)
  })

  it('hands out the same panel view while a shape keeps its props', () => {
    const [shape] = shapesForLegacyContent(legacy)
    const record = { ...shape, typeName: 'shape', parentId: 'page:page', index: 'a1', opacity: 1, meta: {} } as never
    expect(panelFromShape(record)).toBe(panelFromShape({ ...(record as object), x: 999 } as never))
  })
})
