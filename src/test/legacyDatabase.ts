import { openDB } from 'idb'

/** The database stores/indexes used by the live schema-2 reader. */
export function openLegacyTestDatabase() {
  return openDB('music-images-canvas', 2, {
    upgrade(db) {
      const notes = db.createObjectStore('notes', { keyPath: 'id' })
      notes.createIndex('by-updated', 'updatedAt')
      notes.createIndex('by-session-updated', ['sessionId', 'updatedAt'])
      db.createObjectStore('directoryHandles', { keyPath: 'id' })
      db.createObjectStore('imageMetadata', { keyPath: 'id' })
      db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('by-updated', 'updatedAt')
      db.createObjectStore('assets', { keyPath: 'id' }).createIndex('by-session', 'sessionId')
      db.createObjectStore('preferences', { keyPath: 'key' })
      db.createObjectStore('sessionDirectoryHandles', { keyPath: 'sessionId' })
    },
  })
}
