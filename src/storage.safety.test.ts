import './test/setup'
import { openDB } from 'idb'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Moment, Panel } from './types'
// Importing opens the new database; it reads nothing from the earlier one,
// so seeding that afterwards (below) is a faithful order of events.
import * as storage from './storage'
import { draftFromDocument } from './panelStore'

const panelsOf = (moment: Moment) => draftFromDocument(moment.document, moment.camera).panels

/** What the earlier build left behind: its own database, and workspace keys in localStorage. */
const earlier = {
  moment: { id: 'existing', name: 'Before the fresh start', schemaVersion: 2, createdAt: 1, updatedAt: 2, panels: [], canvas: null },
  localStorageKeys: ['mic:canvas', 'mic:slideshow', 'mic:spotify-playlist', 'mic:last-note-id'],
}

beforeAll(async () => {
  const old = await openDB('music-images-canvas', 2, {
    upgrade(db) { db.createObjectStore('sessions', { keyPath: 'id' }) },
  })
  await old.put('sessions', earlier.moment)
  old.close()
  for (const key of earlier.localStorageKeys) window.localStorage.setItem(key, '{}')
  window.localStorage.setItem('mic:spotify-tokens', JSON.stringify({ accessToken: 'keep', refreshToken: null, expiresAt: 1 }))
  await storage.initializeMoments()
})

describe('the fresh database', () => {
  it('opens its own database and never reads the earlier one', async () => {
    const db = await openDB('my-states')
    expect(db.version).toBe(2)
    expect([...db.objectStoreNames].sort()).toEqual(['assets', 'directoryHandles', 'moments', 'notes', 'preferences', 'themes'])
    const moments = await db.getAll('moments')
    expect(moments).toHaveLength(1)
    expect(moments[0]).toMatchObject({ name: 'A new moment', schemaVersion: storage.MOMENT_SCHEMA_VERSION })
    expect(await db.get('moments', earlier.moment.id)).toBeUndefined()
    db.close()
  })

  it('removes the earlier database and workspace keys, and keeps the Spotify login', async () => {
    // deleteDB is fire-and-forget; give it a turn. Opening with no version
    // afterwards creates an empty database, so no stores means it was gone.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const old = await openDB('music-images-canvas')
    expect(old.objectStoreNames.length).toBe(0)
    old.close()
    for (const key of earlier.localStorageKeys) expect(window.localStorage.getItem(key)).toBeNull()
    expect(storage.loadSpotifyTokens()).toMatchObject({ accessToken: 'keep' })
  })

  it('creates every panel visible and out of focus view, from a normalised draft built straight into a document', async () => {
    const moment = await storage.createMoment('Defaults')
    expect(panelsOf(moment).map((panel) => [panel.visible, panel.focusView])).toEqual([[true, false], [true, false], [true, false]])
    const partial = [{ id: 'a', type: 'notes', config: {} }] as unknown as Panel[]
    const imported = await storage.importMomentContent({ name: 'Partial', panels: partial, canvas: null, notes: [], assets: [] })
    expect(panelsOf(imported)[0]).toMatchObject({ type: 'notes', config: { activeNoteId: null }, visible: true, focusView: false })
  })

  it('rejects malformed known fields instead of silently defaulting them', async () => {
    const invalid = [{ id: 'notes', type: 'notes', config: { activeNoteId: 42 } }] as unknown as Panel[]
    await expect(storage.importMomentContent({ name: 'Bad', panels: invalid, canvas: null, notes: [], assets: [] })).rejects.toThrow()
  })
})

describe('save safety', () => {
  const snapshot = { store: {}, schema: { schemaVersion: 2, sequences: {} } } as Moment['document']

  it('refuses to read or overwrite a moment written by a newer build', async () => {
    const db = await openDB('my-states')
    const future = { ...earlier.moment, id: 'future', schemaVersion: 99 }
    await db.put('moments', future)
    await expect(storage.getMoment('future')).rejects.toThrow(/newer version/i)
    await expect(storage.saveMomentDocument('future', snapshot, null)).rejects.toThrow(/newer version/i)
    expect(await db.get('moments', 'future')).toEqual(future)
    expect(await storage.getMomentSummaries()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'future' })]))
    db.close()
  })

  it('replaces the document and camera on a save, transactionally', async () => {
    const moment = await storage.createMoment('Resave')
    const saved = await storage.saveMomentDocument(moment.id, snapshot, { x: 1, y: 2, z: 1 })
    expect(saved.document).toEqual(snapshot)
    expect(await storage.getMoment(moment.id)).toMatchObject({ document: snapshot, camera: { x: 1, y: 2, z: 1 } })
  })

  it('serializes rename with document saves without replacing either field', async () => {
    const moment = await storage.createMoment('Rename race')
    await Promise.all([
      storage.saveMomentDocument(moment.id, snapshot, { x: 99, y: 88, z: 1 }),
      storage.renameMoment(moment.id, 'Renamed'),
    ])
    expect(await storage.getMoment(moment.id)).toMatchObject({ name: 'Renamed', camera: { x: 99, y: 88, z: 1 }, document: snapshot })
  })

  it('rejects a save to a deleted moment instead of reporting success', async () => {
    await expect(storage.saveMomentDocument('missing', snapshot, null)).rejects.toThrow(/no longer exists/)
  })

  it('deletes a moment together with its notes, assets and folder handles', async () => {
    const moment = await storage.createMoment('Delete me')
    await storage.saveNote({ id: 'note-del', momentId: moment.id, title: 't', content: 'c', createdAt: 1, updatedAt: 1 })
    await storage.saveMomentAssets(moment.id, [{ id: 'img-del', filename: 'a.png', name: 'a.png', mimeType: 'image/png', size: 1, lastModified: 0, width: 1, height: 1, blob: new Blob([new Uint8Array([1])]) }])
    await storage.savePanelDirectoryHandle(moment.id, 'panel-1', { name: 'Pictures' } as FileSystemDirectoryHandle)
    await storage.deleteMoment(moment.id)
    expect(await storage.getMoment(moment.id)).toBeUndefined()
    expect(await storage.getNotes(moment.id)).toEqual([])
    expect(await storage.getMomentAssets(moment.id)).toEqual([])
    expect(await storage.getPanelDirectoryHandle(moment.id, 'panel-1')).toBeUndefined()
  })

  it('remaps every imported Notes panel, including duplicate views of one note', async () => {
    const panels = ['a', 'b'].map((id) => ({ id, type: 'notes', config: { activeNoteId: 'source-note' }, visible: true, focusView: false })) as Panel[]
    const imported = await storage.importMomentContent({
      name: 'Two views', panels, canvas: null,
      notes: [{ id: 'source-note', title: 'Keep me', content: 'Body', createdAt: 1, updatedAt: 2 }], assets: [],
    })
    const notes = await storage.getNotes(imported.id)
    expect(panelsOf(imported).filter((panel) => panel.type === 'notes').map((panel) => panel.config.activeNoteId)).toEqual([notes[0].id, notes[0].id])
  })
})
