import { CameraRecordType, createTLStore, type RecordsDiff, type TLCamera, type TLPage, type TLPointer, type TLRecord } from 'tldraw'
import { describe, expect, it, vi } from 'vitest'
import { diffChangesBoard, isBoardRecordType, registerHiddenCanvasPersistence } from './canvasPersistence'

describe('already-hidden canvas persistence', () => {
  it('captures the latest completed operation without waiting for a frame or timer', async () => {
    const store = createTLStore()
    const page = store.schema.types.page.create({ name: 'First', index: 'a1' }) as TLPage
    const save = vi.fn(() => store.get(page.id))
    const cleanup = registerHiddenCanvasPersistence(store, () => true, save)
    store.put([page])
    store.put([{ ...page, name: 'Latest' }])
    expect(save).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.results[0].value).toMatchObject({ name: 'Latest' })
    cleanup()
  })

  it('does not snapshot during restoration or after unmount', async () => {
    const store = createTLStore()
    const page = store.schema.types.page.create({ name: 'Page', index: 'a1' }) as TLPage
    const save = vi.fn()
    let shouldSave = false
    const cleanup = registerHiddenCanvasPersistence(store, () => shouldSave, save)
    store.put([page])
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()
    shouldSave = true
    store.put([{ ...page, name: 'Changed' }])
    cleanup()
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()
  })

  it('ignores operations that only touch session state, but not the camera', async () => {
    const store = createTLStore()
    const page = store.schema.types.page.create({ name: 'Page', index: 'a1' }) as TLPage
    const pointer = store.schema.types.pointer.create({}) as TLPointer
    const camera = store.schema.types.camera.create({ id: CameraRecordType.createId(page.id) }) as TLCamera
    const save = vi.fn()
    const cleanup = registerHiddenCanvasPersistence(store, () => true, save)
    store.put([pointer])
    store.put([{ ...pointer, x: 40, y: 12 }])
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()
    store.put([camera])
    store.put([{ ...camera, x: 100 }])
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(1)
    cleanup()
  })
})

describe('which changes belong to a board', () => {
  const store = createTLStore()
  const page = store.schema.types.page.create({ name: 'Page', index: 'a1' }) as TLPage
  const pointer = store.schema.types.pointer.create({}) as TLPointer
  const camera = store.schema.types.camera.create({ id: CameraRecordType.createId(page.id) }) as TLCamera
  const diff = (changes: Partial<RecordsDiff<TLRecord>>): RecordsDiff<TLRecord> => ({ added: {}, updated: {}, removed: {}, ...changes })

  it('counts document records and the camera', () => {
    expect(diffChangesBoard(store, diff({ added: { [page.id]: page } }))).toBe(true)
    expect(diffChangesBoard(store, diff({ removed: { [page.id]: page } }))).toBe(true)
    expect(diffChangesBoard(store, diff({ updated: { [camera.id]: [camera, { ...camera, z: 2 }] } }))).toBe(true)
  })

  it('does not count hover, cursor, selection or the read-only flag', () => {
    expect(isBoardRecordType(store, 'instance')).toBe(false)
    expect(isBoardRecordType(store, 'instance_page_state')).toBe(false)
    expect(diffChangesBoard(store, diff({ updated: { [pointer.id]: [pointer, { ...pointer, x: 5 }] } }))).toBe(false)
    expect(diffChangesBoard(store, diff({}))).toBe(false)
  })
})
