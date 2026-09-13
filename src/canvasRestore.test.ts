import { createTLSchema, createTLStore, type Editor, type TLShapeId } from 'tldraw'
import { describe, expect, it } from 'vitest'
import { prepareCanvasRestore, withRestoreWriteAccess } from './canvasRestore'
import { panelShapeMigrations, panelShapeProps } from './panelShapeSchema'
import { createPanelProps, shapesForLegacyContent } from './panelStore'
import type { Moment, Panel } from './types'

const schema = createTLSchema({ shapes: { 'music-panel': { props: panelShapeProps, migrations: panelShapeMigrations } }, bindings: {} })
Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
const moment: Moment = { id: 'test', name: 'Test', schemaVersion: 3, createdAt: 1, updatedAt: 2, camera: { x: 0, y: 0, z: 1 }, document: null }

describe('canvas restore preflight', () => {
  it('allows synchronous restore writes but reinstates the readonly input pause even on failure', () => {
    let readonly = true
    const editor = {
      getIsReadonly: () => readonly,
      updateInstanceState: (patch: { isReadonly?: boolean }) => { readonly = patch.isReadonly!; return editor },
    } as Pick<Editor, 'getIsReadonly' | 'updateInstanceState'>
    expect(() => withRestoreWriteAccess(editor, () => {
      expect(readonly).toBe(false)
      throw new Error('Restore failed')
    })).toThrow('Restore failed')
    expect(readonly).toBe(true)
  })
  it('validates snapshots in a detached store and leaves the current store untouched', () => {
    const store = createTLStore({ schema })
    const page = schema.types.page.create({ name: 'Page', index: 'a1' })
    store.put([page])
    store.put([schema.types.shape.create({
      id: 'shape:notes' as TLShapeId, type: 'music-panel', parentId: page.id, index: 'a1', props: createPanelProps('notes'),
    })])
    const snapshot = store.getStoreSnapshot()
    expect(() => prepareCanvasRestore(store, { ...moment, document: snapshot })).not.toThrow()
    const invalid = structuredClone(snapshot)
    const shape = invalid.store['shape:notes' as TLShapeId] as unknown as { props: { panel: { config: Record<string, unknown> } } }
    shape.props.panel.config.stray = true
    expect(() => prepareCanvasRestore(store, { ...moment, document: invalid })).toThrow(/Unexpected property/)
    expect(store.getStoreSnapshot()).toEqual(snapshot)
  })

  it('rejects bad camera and legacy geometry without touching an editor transaction', () => {
    const store = createTLStore({ schema })
    expect(() => prepareCanvasRestore(store, { ...moment, camera: { x: 0, y: 0, z: NaN } })).toThrow()
    const panel: Panel<'notes'> = { id: 'notes', type: 'notes', config: { activeNoteId: null } }
    expect(() => shapesForLegacyContent({
      panels: [panel], canvas: { camera: { x: 0, y: 0, z: 1 }, panels: [{ panelId: 'notes', x: NaN, y: 0, w: 400, h: 500 }] },
    })).toThrow()
    expect(() => shapesForLegacyContent({ panels: [panel, panel], canvas: null })).toThrow(/duplicate/)
  })
})
