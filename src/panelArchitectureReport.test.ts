import { describe, expect, it } from 'vitest'
import type { TLShape, TLStoreSnapshot } from 'tldraw'
import { buildPanelArchitectureReport } from './panelArchitectureReport'
import { createPanelProps } from './panelStore'
import type { Moment, PanelType } from './types'

function makeShape(type: PanelType, panelId: string, id = `shape:${panelId}`, overrides: Partial<{ x: number; index: string; isLocked: boolean; visible: boolean; config: unknown }> = {}): TLShape {
  const props = createPanelProps(type, panelId)
  return {
    id,
    type: 'music-panel',
    x: overrides.x ?? 10,
    y: 20,
    rotation: 0,
    index: overrides.index ?? 'a1',
    parentId: 'page:page',
    isLocked: overrides.isLocked ?? false,
    opacity: 1,
    props: {
      ...props,
      visible: overrides.visible ?? true,
      panel: overrides.config !== undefined ? { type, config: overrides.config } : props.panel,
    },
    meta: {},
    typeName: 'shape',
  } as unknown as TLShape
}

function makeMoment(shapes: TLShape[], overrides: Partial<Moment> = {}): Moment {
  const document: TLStoreSnapshot = {
    store: Object.fromEntries(shapes.map((shape) => [shape.id, shape])) as TLStoreSnapshot['store'],
    schema: { schemaVersion: 2, sequences: {} },
  }
  return {
    id: 'moment-1',
    name: 'Test moment',
    schemaVersion: 1,
    createdAt: 1,
    updatedAt: 1,
    camera: { x: 0, y: 0, z: 1 },
    document,
    ...overrides,
  }
}

function editorWith(...shapes: TLShape[]) {
  return { getCurrentPageShapesSorted: () => shapes }
}

const check = (report: ReturnType<typeof buildPanelArchitectureReport>, id: string) => report.checks.find((candidate) => candidate.id === id)?.status

describe('panel architecture report', () => {
  it('reports a healthy single-panel state', () => {
    const shape = makeShape('notes', 'panel-notes')
    const report = buildPanelArchitectureReport(makeMoment([shape]), editorWith(shape))

    expect(report.summary.status).toBe('PASS')
    expect(report.summary.errors).toBe(0)
    expect(report.panels[0]).toMatchObject({ panelId: 'panel-notes', panelType: 'notes', rendererKey: 'Notes' })
  })

  it('reports every panel kind and describes ownership as the system has it', () => {
    const shapes = [makeShape('spotify', 'p1', 'shape:1', { index: 'a1' }), makeShape('slideshow', 'p2', 'shape:2', { index: 'a2' }), makeShape('notes', 'p3', 'shape:3', { index: 'a3' })]
    const report = buildPanelArchitectureReport(makeMoment(shapes), editorWith(...shapes))

    expect(report.summary.status).toBe('PASS')
    expect(report.ownership.tldraw.join(' ')).toContain('configuration')
    expect(report.ownership.tldraw.join(' ')).toContain('outside a declared content region')
    expect(report.ownership.momentRecord).toContain('the tldraw document snapshot')
    expect(report.ownership.react).toContain('component-internal UI state')
  })

  it('reports two shapes sharing a panelId', () => {
    const one = makeShape('slideshow', 'panel-a', 'shape:one')
    const two = makeShape('slideshow', 'panel-a', 'shape:two')
    const report = buildPanelArchitectureReport(makeMoment([one, two]), editorWith(one, two))

    expect(check(report, 'stable-panel-ids')).toBe('ERROR')
    expect(report.summary.status).toBe('ERROR')
  })

  it('reports a configuration the schema rejects', () => {
    const shape = makeShape('slideshow', 'panel-a', 'shape:a', { config: { folderName: null, imageSource: { type: 'folder' }, currentIndex: 1.5, intervalMs: 5000, transitionMs: 0, shuffle: false, zoom: 1 } })
    const report = buildPanelArchitectureReport(makeMoment([shape]), editorWith(shape))

    expect(check(report, 'config-validates')).toBe('ERROR')
  })

  it('reports a second copy of a singleton kind', () => {
    const one = makeShape('spotify', 'panel-a', 'shape:one')
    const two = makeShape('spotify', 'panel-b', 'shape:two')
    const report = buildPanelArchitectureReport(makeMoment([one, two]), editorWith(one, two))

    expect(check(report, 'singletons')).toBe('ERROR')
  })

  it('reports a hidden panel that the canvas could still act on', () => {
    const hidden = makeShape('notes', 'panel-a', 'shape:a', { visible: false, isLocked: false })
    const locked = makeShape('notes', 'panel-b', 'shape:b', { visible: false, isLocked: true })
    expect(check(buildPanelArchitectureReport(makeMoment([hidden]), editorWith(hidden)), 'hidden-panels-locked')).toBe('ERROR')
    expect(check(buildPanelArchitectureReport(makeMoment([locked]), editorWith(locked)), 'hidden-panels-locked')).toBe('PASS')
  })

  it('reports a moment whose document has not been built yet, and one that kept its draft', () => {
    const shape = makeShape('notes', 'panel-a')
    const notBuilt = makeMoment([shape], { document: null, draft: { panels: [], canvas: null } })
    expect(check(buildPanelArchitectureReport(notBuilt, editorWith(shape)), 'document-persisted')).toBe('ERROR')

    const stale = makeMoment([shape], { draft: { panels: [], canvas: null } })
    expect(check(buildPanelArchitectureReport(stale, editorWith(shape)), 'document-persisted')).toBe('WARNING')
  })

  it('reports a shape the document has not caught up with as a warning, not a violation', () => {
    const saved = makeShape('notes', 'panel-a', 'shape:a')
    const fresh = makeShape('notes', 'panel-b', 'shape:b')
    const report = buildPanelArchitectureReport(makeMoment([saved]), editorWith(saved, fresh))

    expect(check(report, 'document-correlation')).toBe('WARNING')
    expect(report.summary.status).toBe('WARNING')
  })
})
