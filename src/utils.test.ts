import './test/setup'
import { describe, expect, it, vi } from 'vitest'
import { debounce, nextDuplicateName } from './utils'

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

describe('nextDuplicateName', () => {
  it('proposes "(copy)" when that name is free', () => {
    expect(nextDuplicateName('Kitty moment', ['Kitty moment'])).toBe('Kitty moment (copy)')
  })

  it('counts up past every taken "(copy N)" until one is free', () => {
    expect(nextDuplicateName('Kitty moment', ['Kitty moment', 'Kitty moment (copy)'])).toBe('Kitty moment (copy 2)')
    expect(nextDuplicateName('Kitty moment', ['Kitty moment', 'Kitty moment (copy)', 'Kitty moment (copy 2)'])).toBe('Kitty moment (copy 3)')
  })

  it('does not require the source name itself to be present', () => {
    expect(nextDuplicateName('Untitled moment', [])).toBe('Untitled moment (copy)')
  })
})
