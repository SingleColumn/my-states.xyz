import { describe, expect, it } from 'vitest'
import type { TLShape } from 'tldraw'
import { buildPanelArchitectureReport } from './panelArchitectureReport'
import { duplicatePanel } from './panelDuplication'
import type { Panel, Moment } from './types'

function makePanel(type: Panel['type'], id = `panel-${type}`): Panel {
  const base = { id, type, createdAt: 1, updatedAt: 1 }
  if (type === 'spotify') return { ...base, type, config: { playlist: { id: null, uri: null, name: null, url: null } } }
  if (type === 'notes') return { ...base, type, config: { activeNoteId: null } }
  return {
    ...base,
    type,
    config: {
      folderName: null,
      imageSource: { type: 'none' },
      currentIndex: 0,
      intervalMs: 5000,
      transitionMs: 300,
      shuffle: false,
      zoom: 1,
    },
  }
}

function makeShape(panelId: string, id = `shape:${panelId}`, x = 10): TLShape {
  return {
    id,
    type: 'music-panel',
    x,
    y: 20,
    rotation: 0,
    index: 'a1',
    parentId: 'page:page',
    isLocked: false,
    opacity: 1,
    props: { panelId, w: 460, h: 720 },
    meta: {},
    typeName: 'shape',
  } as unknown as TLShape
}

function makeMoment(panels: Panel[], layouts = panels.map((panel, index) => ({ panelId: panel.id, x: index * 500, y: 0, w: 460, h: 720 }))): Moment {
  return {
    id: 'moment-1',
    name: 'Test moment',
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    panels,
    canvas: { camera: { x: 0, y: 0, z: 1 }, panels: layouts },
  }
}

function editorWith(...shapes: TLShape[]) {
  return { getCurrentPageShapes: () => shapes }
}

describe('panel architecture report', () => {
  it('reports a healthy single-panel state', () => {
    const panel = makePanel('notes')
    const report = buildPanelArchitectureReport(makeMoment([panel]), editorWith(makeShape(panel.id)))

    expect(report.summary.status).toBe('PASS')
    expect(report.summary.errors).toBe(0)
    expect(report.panels[0]).toMatchObject({ panelId: panel.id, panelType: 'notes', rendererKey: 'NotesPanel' })
  })

  it('reports multiple panel types and explicit ownership', () => {
    const panels = [makePanel('spotify'), makePanel('slideshow'), makePanel('notes')]
    const report = buildPanelArchitectureReport(makeMoment(panels), editorWith(...panels.map((panel) => makeShape(panel.id))))

    expect(report.summary.status).toBe('PASS')
    expect(report.ownership.tldraw).toContain('position')
    expect(report.ownership.panelModel).toContain('stable panelId')
    expect(report.ownership.react).toContain('component-internal UI state')
  })

  it('reports missing and orphaned relationships', () => {
    const panel = makePanel('notes')
    const report = buildPanelArchitectureReport(makeMoment([panel]), editorWith(makeShape('missing-panel')))

    expect(report.summary.status).toBe('ERROR')
    expect(report.checks.find((check) => check.id === 'panel-shape-cardinality')?.status).toBe('ERROR')
    expect(report.checks.find((check) => check.id === 'orphan-shapes')?.status).toBe('ERROR')
  })

  it('reports duplicate shape references and stale legacy shape identity', () => {
    const panel = makePanel('slideshow')
    const duplicateShape = { ...makeShape(panel.id, 'shape:two'), props: { ...makeShape(panel.id).props, panelType: 'slideshow' } } as unknown as TLShape
    const report = buildPanelArchitectureReport(makeMoment([panel]), editorWith(makeShape(panel.id, 'shape:one'), duplicateShape))

    expect(report.checks.find((check) => check.id === 'panel-shape-cardinality')?.status).toBe('ERROR')
    expect(report.checks.find((check) => check.id === 'legacy-runtime-representation')?.status).toBe('ERROR')
  })

  it('reports duplicated panels as independently addressable objects', () => {
    const source = makePanel('slideshow', 'panel-source')
    const duplicate = duplicatePanel(source)
    expect(duplicate).not.toBeNull()
    const report = buildPanelArchitectureReport(
      makeMoment([source, duplicate!]),
      editorWith(makeShape(source.id, 'shape:source'), makeShape(duplicate!.id, 'shape:duplicate', 510)),
    )

    expect(report.summary.status).toBe('PASS')
    expect(report.panels.map((panel) => panel.panelId)).toEqual([source.id, duplicate!.id])
    expect(source.id).not.toBe(duplicate!.id)
  })

  it('reports deletion when a shape remains for a deleted panel', () => {
    const remaining = makePanel('notes', 'panel-remaining')
    const deletedShape = makeShape('panel-deleted', 'shape:deleted')
    const report = buildPanelArchitectureReport(makeMoment([remaining]), editorWith(makeShape(remaining.id), deletedShape))

    expect(report.checks.find((check) => check.id === 'orphan-shapes')?.status).toBe('ERROR')
  })

  it('keeps legacy schema compatibility visible without treating it as an identity failure', () => {
    const panel = makePanel('notes')
    const legacy = { ...makeMoment([panel]), schemaVersion: 1 as Moment['schemaVersion'] }
    const report = buildPanelArchitectureReport(legacy, editorWith(makeShape(panel.id)))

    expect(report.checks.find((check) => check.id === 'schema-version')?.status).toBe('WARNING')
    expect(report.checks.find((check) => check.id === 'stable-panel-ids')?.status).toBe('PASS')
  })
})
