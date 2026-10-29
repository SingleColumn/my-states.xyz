import { describe, expect, it, vi } from 'vitest'
import { SaveQueue } from './saveQueue'

describe('durable save queue', () => {
  it('reports failure, retains the write, and retries on the next flush', async () => {
    const error = new Error('Disk full')
    const report = vi.fn()
    const write = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined)
    const queue = new SaveQueue(report)
    queue.enqueue('board', write)
    await expect(queue.flush()).rejects.toThrow('Disk full')
    expect(queue.hasPending).toBe(true)
    expect(report).toHaveBeenCalledWith(error)
    await queue.flush()
    expect(write).toHaveBeenCalledTimes(2)
    expect(queue.hasPending).toBe(false)
  })

  it('does not acknowledge a newer edit when an older write completes', async () => {
    let complete!: () => void
    const first = new Promise<void>((resolve) => { complete = resolve })
    const writes: string[] = []
    const queue = new SaveQueue(vi.fn())
    queue.enqueue('board', async () => { writes.push('old'); await first })
    queue.enqueue('board', async () => { writes.push('new') })
    complete()
    await queue.flush()
    expect(writes).toEqual(['old', 'new'])
    expect(queue.hasPending).toBe(false)
  })

  it('reports when it becomes busy and when it empties, once per run of writes', async () => {
    const busy: boolean[] = []
    const queue = new SaveQueue(vi.fn(), (isBusy) => busy.push(isBusy))
    queue.enqueue('a', async () => {})
    queue.enqueue('b', async () => {})
    expect(busy).toEqual([true])
    await queue.flush()
    expect(busy).toEqual([true, false])
  })

  it('reports the error before it stops being busy, and is busy again on a retry', async () => {
    const events: string[] = []
    const write = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined)
    const queue = new SaveQueue(() => events.push('error'), (isBusy) => events.push(isBusy ? 'busy' : 'idle'))
    queue.enqueue('board', write)
    await expect(queue.flush()).rejects.toThrow('Disk full')
    expect(events).toEqual(['busy', 'error', 'idle'])
    queue.enqueue('board', write)
    await queue.flush()
    expect(events).toEqual(['busy', 'error', 'idle', 'busy', 'idle'])
  })

  it('coalesces waiting snapshots without dropping another board or note', async () => {
    let complete!: () => void
    const first = new Promise<void>((resolve) => { complete = resolve })
    const writes: string[] = []
    const queue = new SaveQueue(vi.fn())
    queue.enqueue('first', () => first)
    queue.enqueue('board', async () => { writes.push('superseded') })
    queue.enqueue('note', async () => { writes.push('note') })
    queue.enqueue('board', async () => { writes.push('latest') })
    complete()
    await queue.flush()
    expect(writes).toEqual(['latest', 'note'])
  })
})
