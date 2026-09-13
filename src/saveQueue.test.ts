import { describe, expect, it, vi } from 'vitest'
import { SaveQueue } from './saveQueue'

describe('durable save queue', () => {
  it('reports failure, retains the write, and retries on the next flush', async () => {
    const error = new Error('Disk full')
    const report = vi.fn()
    const write = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined)
    const queue = new SaveQueue(report)
    queue.enqueue('moment', write)
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
    queue.enqueue('moment', async () => { writes.push('old'); await first })
    queue.enqueue('moment', async () => { writes.push('new') })
    complete()
    await queue.flush()
    expect(writes).toEqual(['old', 'new'])
    expect(queue.hasPending).toBe(false)
  })

  it('coalesces waiting snapshots without dropping another moment or note', async () => {
    let complete!: () => void
    const first = new Promise<void>((resolve) => { complete = resolve })
    const writes: string[] = []
    const queue = new SaveQueue(vi.fn())
    queue.enqueue('first', () => first)
    queue.enqueue('moment', async () => { writes.push('superseded') })
    queue.enqueue('note', async () => { writes.push('note') })
    queue.enqueue('moment', async () => { writes.push('latest') })
    complete()
    await queue.flush()
    expect(writes).toEqual(['latest', 'note'])
  })
})
