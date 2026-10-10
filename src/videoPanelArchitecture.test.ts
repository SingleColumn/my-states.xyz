import './test/setup'
import { describe, expect, it } from 'vitest'
import type { Editor, TLShapePartial } from 'tldraw'
import { duplicatePanel } from './panelDuplication'
import { exportMomentArchive, importMomentArchive } from './momentArchive'
import { getPanelDefinition, videoConfigValidator } from './panelRegistry'
import { panelContentValidator, type PanelShape } from './panelShapeSchema'
import { createPanelProps, documentFromDraft, draftFromDocument, updatePanelConfig } from './panelStore'
import { createPanel, getMoment, importMomentContent } from './storage'
import type { Panel } from './types'
import { videoCatalog } from './videoCatalog'

const firstVideoId = videoCatalog[0].id
const secondVideoId = videoCatalog[1].id
const thirdVideoId = videoCatalog[2].id

describe('Video panel architecture', () => {
  it('is a non-singleton registry type with a valid default config', () => {
    const definition = getPanelDefinition('video')
    expect(definition.label).toBe('Video')
    expect(definition.singleton).toBe(false)
    expect(definition.createConfig()).toEqual({ selectedVideoId: null })
    expect(videoConfigValidator.validate(definition.createConfig())).toEqual({ selectedVideoId: null })
  })

  it('accepts only a string or null selectedVideoId structurally', () => {
    expect(videoConfigValidator.validate({ selectedVideoId: null })).toEqual({ selectedVideoId: null })
    expect(videoConfigValidator.validate({ selectedVideoId: 'example-id' })).toEqual({ selectedVideoId: 'example-id' })
    expect(() => videoConfigValidator.validate({ selectedVideoId: 42 })).toThrow()
    expect(() => videoConfigValidator.validate({})).toThrow()
    expect(getPanelDefinition('video').normalizeConfig({ selectedVideoId: 'removed-video' })).toEqual({ selectedVideoId: 'removed-video' })
  })

  it('serializes and validates a Video shape like every other panel', () => {
    const props = createPanelProps('video', 'panel-video')
    const configured = { ...props, panel: { type: 'video' as const, config: { selectedVideoId: firstVideoId } } }
    expect(panelContentValidator.validate(configured.panel)).toEqual(configured.panel)

    const document = documentFromDraft({
      panels: [{ id: 'panel-video', type: 'video', config: configured.panel.config, visible: true, focusView: false }],
      canvas: null,
    })
    const [restored] = draftFromDocument(document, null).panels
    expect(restored).toMatchObject({ type: 'video', config: { selectedVideoId: firstVideoId } })
  })

  it('duplicates the selection under a new independent panel id and config object', () => {
    const source: Panel<'video'> = { ...createPanel('video'), config: { selectedVideoId: firstVideoId } }
    const duplicate = duplicatePanel(source)
    if (!duplicate || duplicate.type !== 'video') throw new Error('Video panel unexpectedly rejected for duplication')

    expect(duplicate.id).not.toBe(source.id)
    expect(duplicate.config).toEqual(source.config)
    expect(duplicate.config).not.toBe(source.config)
  })

  it('updates two Video shapes independently through the panel write path', () => {
    const shapes = [shapeFor('panel-video-a', firstVideoId), shapeFor('panel-video-b', secondVideoId)]
    const editor = mutableEditor(shapes)

    updatePanelConfig<'video'>(editor, 'panel-video-a', { selectedVideoId: thirdVideoId })

    expect(shapes[0].props.panel).toEqual({ type: 'video', config: { selectedVideoId: thirdVideoId } })
    expect(shapes[1].props.panel).toEqual({ type: 'video', config: { selectedVideoId: secondVideoId } })
    expect(shapes[0].props.panel.config).not.toBe(shapes[1].props.panel.config)
  })

  it('restores the selected id through ordinary moment persistence', async () => {
    const panel: Panel<'video'> = { ...createPanel('video'), config: { selectedVideoId: firstVideoId } }
    const moment = await importMomentContent({ name: 'Video persistence', panels: [panel], canvas: null, notes: [], assets: [] })
    const restored = await getMoment(moment.id)
    const [storedPanel] = restored ? draftFromDocument(restored.document, restored.camera).panels : []
    expect(storedPanel).toMatchObject({ type: 'video', config: { selectedVideoId: firstVideoId } })
  })

  it('round-trips the selected id through moment export and import', async () => {
    const panel: Panel<'video'> = { ...createPanel('video'), config: { selectedVideoId: secondVideoId } }
    const source = await importMomentContent({ name: 'Video archive source', panels: [panel], canvas: null, notes: [], assets: [] })
    const archive = await exportMomentArchive(source.id)
    const imported = await importMomentArchive(new File([archive], 'video.moment.zip', { type: 'application/zip' }))
    const [storedPanel] = draftFromDocument(imported.moment.document, imported.moment.camera).panels
    expect(storedPanel).toMatchObject({ type: 'video', config: { selectedVideoId: secondVideoId } })
  })
})

function shapeFor(panelId: string, selectedVideoId: string): PanelShape {
  const props = createPanelProps('video', panelId)
  return {
    id: `shape:${panelId}`,
    type: 'music-panel',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    parentId: 'page:page',
    isLocked: false,
    opacity: 1,
    props: { ...props, panel: { type: 'video', config: { selectedVideoId } } },
    meta: {},
    typeName: 'shape',
  } as PanelShape
}

function mutableEditor(shapes: PanelShape[]): Editor {
  return {
    getCurrentPageShapesSorted: () => shapes,
    markHistoryStoppingPoint: () => 'marker',
    run: (operation: () => void) => operation(),
    updateShapes: (partials: TLShapePartial<PanelShape>[]) => {
      for (const partial of partials) {
        const index = shapes.findIndex((shape) => shape.id === partial.id)
        if (index < 0) continue
        shapes[index] = {
          ...shapes[index],
          ...partial,
          props: { ...shapes[index].props, ...partial.props },
        } as PanelShape
      }
      return shapes
    },
  } as unknown as Editor
}
