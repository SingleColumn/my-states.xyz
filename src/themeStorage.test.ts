import './test/setup'
import { openDB } from 'idb'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Moment } from './types'
import type { ThemeDefinition } from './themes/types'

/** A moment record exactly as the version-1 database wrote it: no themeId. */
const versionOneMoment = {
  id: 'from-v1', name: 'Written before themes', schemaVersion: 2, createdAt: 1, updatedAt: 2, camera: null,
  document: { store: {}, schema: { schemaVersion: 2, sequences: {} } },
} as unknown as Moment

const custom = (id: string, name = 'Custom'): ThemeDefinition => ({ schemaVersion: 1, id, name, version: '1.0.0', modes: { dark: { foundation: { color: { background: '#000' } } } } })

// The database must exist at version 1 before storage.ts opens it, so
// storage is imported after seeding rather than at the top of the file.
let storage: typeof import('./storage')

beforeAll(async () => {
  const v1 = await openDB('my-states', 1, {
    upgrade(db) {
      db.createObjectStore('moments', { keyPath: 'id' }).createIndex('by-updated', 'updatedAt')
      db.createObjectStore('notes', { keyPath: 'id' }).createIndex('by-moment-updated', ['momentId', 'updatedAt'])
      db.createObjectStore('assets', { keyPath: 'id' }).createIndex('by-moment', 'momentId')
      db.createObjectStore('directoryHandles', { keyPath: 'id' }).createIndex('by-moment', 'momentId')
      db.createObjectStore('preferences', { keyPath: 'key' })
    },
  })
  await v1.put('moments', versionOneMoment)
  await v1.put('preferences', { key: 'active-moment-id', value: 'from-v1' })
  v1.close()
  storage = await import('./storage')
  await storage.initializeMoments()
})

describe('the version 2 database', () => {
  it('adds the themes store and keeps every version-1 store and record', async () => {
    const db = await openDB('my-states')
    expect(db.version).toBe(2)
    expect([...db.objectStoreNames].sort()).toEqual(['assets', 'directoryHandles', 'moments', 'notes', 'preferences', 'themes'])
    expect(await db.get('moments', 'from-v1')).toEqual(versionOneMoment)
    expect(await db.get('preferences', 'active-moment-id')).toEqual({ key: 'active-moment-id', value: 'from-v1' })
    db.close()
  })

  it('reads a moment written before themes as one that follows the global theme', async () => {
    const moment = await storage.getMoment('from-v1')
    expect(moment).toBeDefined()
    expect('themeId' in moment!).toBe(false)
  })
})

describe('appearance settings', () => {
  it('default to the built-in theme and the system mode when nothing is stored', async () => {
    expect(await storage.getAppearanceSettings()).toEqual({ globalThemeId: 'midnight', modePreference: 'system' })
  })

  it('persist the global theme and the mode preference', async () => {
    await storage.setGlobalThemeId('terminal')
    await storage.setThemeModePreference('light')
    expect(await storage.getAppearanceSettings()).toEqual({ globalThemeId: 'terminal', modePreference: 'light' })
    await storage.setGlobalThemeId('midnight')
    await storage.setThemeModePreference('system')
  })

  it('ignore a stored mode preference this build does not know', async () => {
    const db = await openDB('my-states')
    await db.put('preferences', { key: 'theme-mode-preference', value: 'sepia' })
    db.close()
    expect((await storage.getAppearanceSettings()).modePreference).toBe('system')
  })
})

describe('the theme library', () => {
  it('stores an imported theme under its own id when that id is free', async () => {
    const { theme, outcome } = await storage.importStoredTheme(custom('mine'))
    expect(outcome).toBe('added')
    expect(theme).toMatchObject({ id: 'mine', name: 'Custom', source: 'imported', definition: custom('mine') })
    expect(await storage.getStoredTheme('mine')).toEqual(theme)
    expect((await storage.listStoredThemes()).map((stored) => stored.id)).toContain('mine')
  })

  it('returns the stored theme when the same definition is imported again', async () => {
    const { theme, outcome } = await storage.importStoredTheme(custom('mine'))
    expect(outcome).toBe('existing')
    expect(theme.id).toBe('mine')
    expect((await storage.listStoredThemes()).filter((stored) => stored.id.startsWith('mine'))).toHaveLength(1)
  })

  it('files a different theme with a taken id under a suffixed id', async () => {
    const { theme, outcome } = await storage.importStoredTheme(custom('mine', 'Another'))
    expect(outcome).toBe('renamed')
    expect(theme.id).toBe('mine-2')
    expect(theme.definition.id).toBe('mine-2')
    expect(theme.definition.name).toBe('Another')
    const third = await storage.importStoredTheme(custom('mine', 'A third'))
    expect(third.theme.id).toBe('mine-3')
  })

  it('never stores a theme under a built-in id', async () => {
    const { theme, outcome } = await storage.importStoredTheme(custom('midnight', 'Not the real one'))
    expect(outcome).toBe('renamed')
    expect(theme.id).toBe('midnight-2')
    expect(await storage.getStoredTheme('midnight')).toBeUndefined()
  })

  it('refuses to delete a built-in theme', async () => {
    await expect(storage.deleteStoredTheme('midnight')).rejects.toThrow(/Built-in themes cannot be deleted/)
  })

  it('deletes an imported theme and moves a global choice that named it back to the default', async () => {
    await storage.setGlobalThemeId('mine-2')
    await storage.deleteStoredTheme('mine-2')
    expect(await storage.getStoredTheme('mine-2')).toBeUndefined()
    expect((await storage.getAppearanceSettings()).globalThemeId).toBe('midnight')
    // Deleting a theme that is not the global choice leaves the choice alone.
    await storage.setGlobalThemeId('mine')
    await storage.deleteStoredTheme('mine-3')
    expect((await storage.getAppearanceSettings()).globalThemeId).toBe('mine')
    await storage.setGlobalThemeId('midnight')
  })
})

describe('a moment and its theme', () => {
  const snapshot = { store: {}, schema: { schemaVersion: 2, sequences: {} } } as Moment['document']

  it('starts out following the global theme', async () => {
    const moment = await storage.createMoment('Plain')
    expect('themeId' in moment).toBe(false)
  })

  it('pins a theme, keeps it across a canvas save, and unpins it', async () => {
    const moment = await storage.createMoment('Pinned')
    await storage.setMomentTheme(moment.id, 'terminal')
    expect((await storage.getMoment(moment.id))?.themeId).toBe('terminal')
    // The document save rebuilds the record from an explicit field list; a
    // theme it forgot would vanish 300 ms after any drag.
    await storage.saveMomentDocument(moment.id, snapshot, { x: 1, y: 2, z: 1 })
    expect(await storage.getMoment(moment.id)).toMatchObject({ themeId: 'terminal', camera: { x: 1, y: 2, z: 1 } })
    await storage.renameMoment(moment.id, 'Still pinned')
    expect((await storage.getMoment(moment.id))?.themeId).toBe('terminal')
    expect((await storage.getMomentSummaries()).find((summary) => summary.id === moment.id)?.themeId).toBe('terminal')

    await storage.setMomentTheme(moment.id, null)
    const unpinned = await storage.getMoment(moment.id)
    expect('themeId' in unpinned!).toBe(false)
    expect('themeId' in (await storage.getMomentSummaries()).find((summary) => summary.id === moment.id)!).toBe(false)
  })

  it('keeps a pinned id whether or not that theme is installed, and deleting the theme leaves the moment alone', async () => {
    const moment = await storage.createMoment('Orphaned')
    await storage.importStoredTheme(custom('temporary'))
    await storage.setMomentTheme(moment.id, 'temporary')
    await storage.deleteStoredTheme('temporary')
    expect((await storage.getMoment(moment.id))?.themeId).toBe('temporary')
  })

  it('imports a moment with the theme id it was given', async () => {
    const imported = await storage.importMomentContent({ name: 'From archive', themeId: 'paper', panels: [], canvas: null, notes: [], assets: [] })
    expect(imported.themeId).toBe('paper')
    const plain = await storage.importMomentContent({ name: 'From an older archive', panels: [], canvas: null, notes: [], assets: [] })
    expect('themeId' in plain).toBe(false)
  })
})
