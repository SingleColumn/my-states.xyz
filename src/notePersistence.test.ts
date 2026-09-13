import { describe, expect, it, vi } from 'vitest'
import { persistNoteSnapshot } from './notePersistence'
import { SaveQueue } from './saveQueue'

const note = { id: 'note', momentId: 'moment', title: 'Title', content: 'Old', createdAt: 1, updatedAt: 2 }

describe('note save acknowledgement', () => {
  it('keeps a failed draft dirty and retries the same content', async () => {
    const state = { activeNote: note, dirty: true }
    const write = vi.fn().mockRejectedValueOnce(new Error('Quota exceeded')).mockResolvedValue(undefined)
    const queue = new SaveQueue(vi.fn())
    queue.enqueue(note.id, () => persistNoteSnapshot(state, note, write))
    await expect(queue.flush()).rejects.toThrow('Quota exceeded')
    expect(state.dirty).toBe(true)
    await queue.flush()
    expect(state.dirty).toBe(false)
    expect(write).toHaveBeenLastCalledWith(note)
  })

  it('does not clear typing that arrived during the write', async () => {
    let complete!: () => void
    const write = new Promise<void>((resolve) => { complete = resolve })
    const state = { activeNote: note, dirty: true }
    const pending = persistNoteSnapshot(state, note, () => write)
    state.activeNote = { ...note, content: 'New' }
    complete()
    await pending
    expect(state.dirty).toBe(true)
  })
})
