import { describe, expect, it, vi } from 'vitest'
import { BoardOperation } from './boardOperation'
import { SaveQueue } from './saveQueue'

describe('board operation boundary', () => {
  it('pauses before saving and refuses overlapping operations', async () => {
    const operation = new BoardOperation()
    const pause = vi.fn()
    operation.registerPause(pause)
    let complete!: () => void
    const pending = operation.run(() => new Promise<void>((resolve) => { complete = resolve }))
    expect(pause).toHaveBeenLastCalledWith(true)
    expect(operation.isBusy).toBe(true)
    await expect(operation.run(async () => {})).rejects.toThrow(/wait/i)
    complete()
    await pending
    expect(pause).toHaveBeenLastCalledWith(false)
  })

  it.each(['switch', 'export'])('does not %s after a failed save, and allows a retry', async () => {
    const operation = new BoardOperation()
    const pause = vi.fn()
    operation.registerPause(pause)
    const queue = new SaveQueue(vi.fn())
    const write = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined)
    const next = vi.fn()
    const work = () => operation.run(async () => {
      queue.enqueue('document', write)
      await queue.flush()
      next()
    })
    await expect(work()).rejects.toThrow('Disk full')
    expect(next).not.toHaveBeenCalled()
    expect(operation.isBusy).toBe(false)
    expect(pause).toHaveBeenLastCalledWith(false)
    await work()
    expect(next).toHaveBeenCalledTimes(1)
  })
})
