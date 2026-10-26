import { describe, expect, it } from 'vitest'
import type { TLShape, TLStoreSnapshot } from 'tldraw'
import { buildPanelArchitectureReport, type PanelRuntimeSnapshot } from './panelArchitectureReport'
import { createPanelProps } from './panelStore'
import type { Board, PanelType } from './types'

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

function makeBoard(shapes: TLShape[], overrides: Partial<Board> = {}): Board {
  const document: TLStoreSnapshot = {
    store: Object.fromEntries(shapes.map((shape) => [shape.id, shape])) as TLStoreSnapshot['store'],
    schema: { schemaVersion: 2, sequences: {} },
  }
  return {
    id: 'board-1',
    name: 'Test board',
    schemaVersion: 2,
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
    const report = buildPanelArchitectureReport(makeBoard([shape]), editorWith(shape))

    expect(report.summary.status).toBe('PASS')
    expect(report.summary.errors).toBe(0)
    expect(report.panels[0]).toMatchObject({ panelId: 'panel-notes', panelType: 'notes', rendererKey: 'Notes' })
  })

  it('reports every panel kind and describes ownership as the system has it', () => {
    const shapes = [makeShape('spotify', 'p1', 'shape:1', { index: 'a1' }), makeShape('slideshow', 'p2', 'shape:2', { index: 'a2' }), makeShape('notes', 'p3', 'shape:3', { index: 'a3' }), makeShape('video', 'p4', 'shape:4', { index: 'a4' })]
    const report = buildPanelArchitectureReport(makeBoard(shapes), editorWith(...shapes))

    expect(report.summary.status).toBe('PASS')
    expect(report.ownership.tldraw.join(' ')).toContain('configuration')
    expect(report.ownership.tldraw.join(' ')).toContain('outside a declared content region')
    expect(report.ownership.boardRecord).toContain('the tldraw document snapshot')
    expect(report.ownership.react).toContain('component-internal UI state')
  })

  it('reports a curated Images source by its saved slug', () => {
    const shape = makeShape('slideshow', 'panel-images', 'shape:images', {
      config: { folderName: 'Autumn', imageSource: { type: 'curated', collectionSlug: 'rbnks-autumn' }, currentIndex: 0, intervalMs: 5000, transitionMs: 500, shuffle: false, zoom: 1 },
    })
    const report = buildPanelArchitectureReport(makeBoard([shape]), editorWith(shape))
    expect(report.summary.status).toBe('PASS')
    expect(report.panels[0].contentReferences).toEqual({ curatedCollectionSlug: 'rbnks-autumn' })
  })

  it('reports two shapes sharing a panelId', () => {
    const one = makeShape('slideshow', 'panel-a', 'shape:one')
    const two = makeShape('slideshow', 'panel-a', 'shape:two')
    const report = buildPanelArchitectureReport(makeBoard([one, two]), editorWith(one, two))

    expect(check(report, 'stable-panel-ids')).toBe('ERROR')
    expect(report.summary.status).toBe('ERROR')
  })

  it('reports a configuration the schema rejects', () => {
    const shape = makeShape('slideshow', 'panel-a', 'shape:a', { config: { folderName: null, imageSource: { type: 'folder' }, currentIndex: 1.5, intervalMs: 5000, transitionMs: 0, shuffle: false, zoom: 1 } })
    const report = buildPanelArchitectureReport(makeBoard([shape]), editorWith(shape))

    expect(check(report, 'config-validates')).toBe('ERROR')
  })

  it('reports a second copy of a singleton kind', () => {
    const one = makeShape('spotify', 'panel-a', 'shape:one')
    const two = makeShape('spotify', 'panel-b', 'shape:two')
    const report = buildPanelArchitectureReport(makeBoard([one, two]), editorWith(one, two))

    expect(check(report, 'singletons')).toBe('ERROR')
  })

  it('reports a hidden panel that the canvas could still act on', () => {
    const hidden = makeShape('notes', 'panel-a', 'shape:a', { visible: false, isLocked: false })
    const locked = makeShape('notes', 'panel-b', 'shape:b', { visible: false, isLocked: true })
    expect(check(buildPanelArchitectureReport(makeBoard([hidden]), editorWith(hidden)), 'hidden-panels-locked')).toBe('ERROR')
    expect(check(buildPanelArchitectureReport(makeBoard([locked]), editorWith(locked)), 'hidden-panels-locked')).toBe('PASS')
  })

  it('reports a shape the document has not caught up with as a warning, not a violation', () => {
    const saved = makeShape('notes', 'panel-a', 'shape:a')
    const fresh = makeShape('notes', 'panel-b', 'shape:b')
    const report = buildPanelArchitectureReport(makeBoard([saved]), editorWith(saved, fresh))

    expect(check(report, 'document-correlation')).toBe('WARNING')
    expect(report.summary.status).toBe('WARNING')
  })

  describe('runtime checks', () => {
    const saves = { storeUpdates: 10, boardUpdates: 3, writes: 3 }
    const show = (patch: Partial<PanelRuntimeSnapshot['slideshows'][number]> = {}) => ({ panelId: 'panel-a', isPlaying: true, imageCount: 5, currentIndex: 0, timerSet: true, lookAhead: { index: 1, status: 'pending' }, ...patch })
    const run = (slideshows: PanelRuntimeSnapshot['slideshows']) => {
      const shape = makeShape('slideshow', 'panel-a', 'shape:a')
      return buildPanelArchitectureReport(makeBoard([shape]), editorWith(shape), { saves, slideshows })
    }

    it('has no runtime checks unless the caller supplies the runtime', () => {
      const shape = makeShape('notes', 'panel-a', 'shape:a')
      const report = buildPanelArchitectureReport(makeBoard([shape]), editorWith(shape))
      expect(report.checks.map((item) => item.id)).not.toContain('save-activity')
      expect(report.checks.map((item) => item.id)).not.toContain('slideshow-look-ahead')
    })

    it('reports how many canvas updates were session-only and so not saved', () => {
      const details = run([]).checks.find((item) => item.id === 'save-activity')?.details
      expect(details).toContain('10 canvas updates: 3 changed the board, 7 touched only hover or selection')
    })

    it('passes a playing slideshow with a different picture queued, and a stopped one with nothing', () => {
      expect(check(run([show()]), 'slideshow-look-ahead')).toBe('PASS')
      expect(check(run([show({ isPlaying: false, timerSet: false, lookAhead: null })]), 'slideshow-look-ahead')).toBe('PASS')
    })

    it.each([
      ['playing with no picture queued', { lookAhead: null }],
      ['playing with no timer', { timerSet: false }],
      ['queued picture is the one showing', { lookAhead: { index: 0, status: 'pending' } }],
      ['queued picture is outside the collection', { lookAhead: { index: 9, status: 'pending' } }],
      ['stopped but a picture is still queued', { isPlaying: false, timerSet: false }],
    ])('flags a slideshow that is %s', (_name, patch) => {
      expect(check(run([show(patch)]), 'slideshow-look-ahead')).toBe('ERROR')
    })

    it('compares the saved camera with the live one', () => {
      const shape = makeShape('notes', 'panel-a', 'shape:a')
      const at = (x: number) => ({ ...editorWith(shape), getCamera: () => ({ x, y: 0, z: 1 }) })
      expect(check(buildPanelArchitectureReport(makeBoard([shape]), at(0)), 'camera-persisted')).toBe('PASS')
      expect(check(buildPanelArchitectureReport(makeBoard([shape]), at(40)), 'camera-persisted')).toBe('WARNING')
    })
  })
})
