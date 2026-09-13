import './test/setup'
import { describe, expect, it, vi } from 'vitest'
import { openLegacyTestDatabase } from './test/legacyDatabase'

describe('database upgrade failure', () => {
  it('rolls back the version and keeps old records readable when the backup write aborts', async () => {
    const original = { id: 'original', schemaVersion: 2, name: 'Keep me', createdAt: 1, updatedAt: 2, panels: [], canvas: null }
    const old = await openLegacyTestDatabase()
    await old.put('sessions', original)
    old.close()
    const realPut = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = realPut.call(this, value, key)
      if (this.name === 'momentMigrationBackups') this.transaction.abort()
      return request
    })
    try {
      const storage = await import('./storage')
      await expect(storage.getMoment(original.id)).rejects.toThrow()
    } finally {
      spy.mockRestore()
    }
    const reopened = await openLegacyTestDatabase()
    expect(reopened.version).toBe(2)
    expect(reopened.objectStoreNames.contains('momentMigrationBackups')).toBe(false)
    expect(await reopened.get('sessions', original.id)).toEqual(original)
    reopened.close()
  })
})
