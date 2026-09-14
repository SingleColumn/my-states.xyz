import { createTLStore, type TLPage } from 'tldraw'
import { describe, expect, it, vi } from 'vitest'
import { registerHiddenCanvasPersistence } from './canvasPersistence'

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
})
