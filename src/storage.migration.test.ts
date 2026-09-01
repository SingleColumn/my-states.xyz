import './test/setup'
import { openDB } from 'idb'
import { beforeAll, describe, expect, it } from 'vitest'

const databaseName = 'music-images-canvas'

beforeAll(async () => {
  window.localStorage.clear()
  window.localStorage.setItem('mic:canvas', JSON.stringify({
    camera: { x: 12, y: 34, z: 1.5 },
    panels: [{ panelType: 'notes', x: 1, y: 2, w: 300, h: 400 }],
  }))
  window.localStorage.setItem('mic:slideshow', JSON.stringify({ folderName: 'references', currentIndex: 2, intervalMs: 2500, transitionMs: 300, shuffle: true, zoom: 1.2 }))
  window.localStorage.setItem('mic:spotify-playlist', JSON.stringify({ id: 'legacy_playlist', uri: 'spotify:playlist:legacy_playlist', name: 'Legacy playlist', url: 'https://open.spotify.com/playlist/legacy_playlist' }))
  window.localStorage.setItem('mic:last-note-id', 'legacy_note')

  const db = await openDB(databaseName, 1, {
    upgrade(database) {
      const notes = database.createObjectStore('notes', { keyPath: 'id' })
      notes.createIndex('by-updated', 'updatedAt')
      database.createObjectStore('directoryHandles', { keyPath: 'id' })
      database.createObjectStore('imageMetadata', { keyPath: 'id' })
    },
  })
  await db.put('notes', {
    id: 'legacy_note',
    title: 'Before sessions',
    content: 'Legacy note body',
    createdAt: 10,
    updatedAt: 20,
  })
  db.close()
})

describe('legacy session migration', () => {
  it('migrates legacy state, verifies its read-back, and is idempotent', async () => {
    const storage = await import('./storage')
    const first = await storage.initializeSessions()
    const session = await storage.getSession(first.activeSessionId)
    const notes = await storage.getNotes(first.activeSessionId)

    expect(session).toMatchObject({
      name: 'Imported workspace',
      panels: expect.arrayContaining([
        expect.objectContaining({ type: 'notes', config: { activeNoteId: 'legacy_note' } }),
        expect.objectContaining({ type: 'slideshow', config: expect.objectContaining({ folderName: 'references', intervalMs: 2500, shuffle: true }) }),
        expect.objectContaining({ type: 'spotify', config: { playlist: expect.objectContaining({ id: 'legacy_playlist' }) } }),
      ]),
      canvas: { camera: { x: 12, y: 34, z: 1.5 } },
    })
    expect(notes).toEqual([expect.objectContaining({ id: 'legacy_note', sessionId: first.activeSessionId, content: 'Legacy note body' })])
    expect(window.localStorage.getItem('mic:canvas')).not.toBeNull()

    const second = await storage.initializeSessions()
    expect(second.activeSessionId).toBe(first.activeSessionId)
    expect(await storage.getSessions()).toHaveLength(1)
  })
})
