import './test/setup'
import { describe, expect, it, vi } from 'vitest'
import { debounce } from './utils'

describe('debounce', () => {
  it('flushes the most recent pending value immediately and prevents a second invocation', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const pending = debounce(callback, 300)

    pending('first')
    pending('latest')
    pending.flush()
    vi.advanceTimersByTime(300)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith('latest')
    vi.useRealTimers()
  })
})