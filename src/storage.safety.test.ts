import './test/setup'
import { openDB } from 'idb'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Moment, Panel } from './types'
import { openLegacyTestDatabase } from './test/legacyDatabase'

const original = {
  id: 'existing', name: 'Before upgrade', schemaVersion: 2,
  createdAt: 1, updatedAt: 2,
  panels: [
    { id: 'music', type: 'spotify', focusView: true, config: { playlist: { id: 'playlist', stray: true } } },
    { id: 'images', type: 'slideshow', visible: false, config: { intervalMs: 3000, stray: true } },
    { id: 'images-copy', type: 'slideshow', config: { folderName: 'Older images' } },
    { id: 'notes', type: 'notes', config: {} },
    { id: 'notes-copy', type: 'notes', config: { activeNoteId: 'old-note', stray: true } },
  ],
  canvas: { camera: { x: 1, y: 2, z: 1 }, panels: [{ panelId: 'music', x: 10, y: 20, w: 300, h: 400 }] },
}
let storage: typeof import('./storage')

beforeAll(async () => {
  const old = await openLegacyTestDatabase()
  await old.put('sessions', original)
  // The old app has no versionchange handler. A new build must wait, not
  // migrate while that connection can still write the old representation.
  storage = await import('./storage')
  await vi.waitFor(() => expect(storage.getStorageStatus()).toMatch(/close those tabs/i))
  expect(await old.get('sessions', original.id)).toEqual(original)
  old.close()
  await storage.getMoment(original.id)
})

describe('migration safety', () => {
  it('keeps the original untouched on read and makes an independent recovery copy', async () => {
    const db = await openDB('music-images-canvas')
    expect(db.version).toBe(3)
    expect(await db.get('sessions', original.id)).toEqual(original)
    expect(await db.get('momentMigrationBackups', original.id)).toEqual(original)
    db.close()
  })

  it('prevents a rollback build from opening and rewriting schema-3 records', async () => {
    await expect(openDB('music-images-canvas', 2)).rejects.toMatchObject({ name: 'VersionError' })
  })

  it('normalizes every panel and nested config before shape construction', async () => {
    const { shapesForLegacyContent } = await import('./panelStore')
    const { T } = await import('tldraw')
    const { panelShapeProps } = await import('./panelShapeSchema')
    const moment = (await storage.getMoment(original.id))!
    const shapes = shapesForLegacyContent(moment.legacy!)
    expect(shapes).toHaveLength(5)
    for (const shape of shapes) expect(() => T.object(panelShapeProps).validate(shape.props)).not.toThrow()
    expect(shapes.find((shape) => shape.props?.panelId === 'images')?.isLocked).toBe(true)
    expect(shapes[0]).toMatchObject({ x: 10, y: 20, props: { focusView: true } })
    expect(moment.legacy!.panels.find((panel) => panel.id === 'notes-copy')?.config).toEqual({ activeNoteId: 'old-note' })
  })

  it('leaves the old record and backup intact if the upgraded document transaction aborts', async () => {
    const snapshot = { store: {}, schema: { schemaVersion: 2, sequences: {} } } as Moment['document'] & {}
    const realPut = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = realPut.call(this, value, key)
      if (this.name === 'sessions' && value.document) this.transaction.abort()
      return request
    })
    await expect(storage.saveMomentDocument(original.id, snapshot, { x: 0, y: 0, z: 1 })).rejects.toThrow()
    spy.mockRestore()
    const db = await openDB('music-images-canvas')
    expect(await db.get('sessions', original.id)).toEqual(original)
    expect(await db.get('momentMigrationBackups', original.id)).toEqual(original)
    await storage.saveMomentDocument(original.id, snapshot, { x: 0, y: 0, z: 1 })
    expect(await db.get('sessions', original.id)).toMatchObject({ schemaVersion: 3, document: snapshot })
    expect((await db.get('sessions', original.id)).panels).toBeUndefined()
    expect(await db.get('momentMigrationBackups', original.id)).toEqual(original)
    db.close()
  })

  it('rejects future schemas without rewriting them', async () => {
    const db = await openDB('music-images-canvas')
    const future = { ...original, id: 'future', schemaVersion: 99 }
    await db.put('sessions', future)
    await expect(storage.getMoment('future')).rejects.toThrow(/newer version/i)
    expect(await db.get('sessions', 'future')).toEqual(future)
    expect(await storage.getMomentSummaries()).toEqual(expect.arrayContaining([expect.objectContaining({ id: original.id }), expect.objectContaining({ id: 'future' })]))
    db.close()
  })

  it('keeps malformed known fields intact instead of silently defaulting them', async () => {
    const db = await openDB('music-images-canvas')
    const invalid = { ...original, id: 'bad-config', panels: [{ id: 'notes', type: 'notes', config: { activeNoteId: 42 } }] }
    await db.put('sessions', invalid)
    await expect(storage.getMoment(invalid.id)).rejects.toThrow()
    expect(await db.get('sessions', invalid.id)).toEqual(invalid)
    db.close()
  })

  it('serializes rename with document saves without replacing either field', async () => {
    const current = (await storage.getMoment(original.id))!
    await Promise.all([
      storage.saveMomentDocument(original.id, current.document!, { x: 99, y: 88, z: 1 }),
      storage.renameMoment(original.id, 'Renamed'),
    ])
    expect(await storage.getMoment(original.id)).toMatchObject({ name: 'Renamed', camera: { x: 99, y: 88, z: 1 }, document: current.document })
  })

  it('rejects a save to a deleted moment instead of reporting success', async () => {
    const current = (await storage.getMoment(original.id))!
    await expect(storage.saveMomentDocument('missing', current.document!, current.camera)).rejects.toThrow(/no longer exists/)
  })

  it('remaps every imported Notes panel, including duplicate views of one note', async () => {
    const panels = ['a', 'b'].map((id) => ({ id, type: 'notes', config: { activeNoteId: 'source-note' } })) as Panel[]
    const imported = await storage.importMomentContent({
      name: 'Old archive', panels, canvas: null,
      slideshow: storage.defaultSlideshowSettings, spotify: storage.defaultSpotifyPlaylistReference,
      activeNoteSourceId: 'source-note',
      notes: [{ id: 'source-note', title: 'Keep me', content: 'Body', createdAt: 1, updatedAt: 2 }], assets: [],
    })
    const notes = await storage.getNotes(imported.id)
    expect(imported.legacy!.panels.filter((panel) => panel.type === 'notes').map((panel) => panel.config.activeNoteId)).toEqual([notes[0].id, notes[0].id])
  })
})
