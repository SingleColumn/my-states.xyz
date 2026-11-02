import './test/setup'
import { describe, expect, it, vi } from 'vitest'
import { debounce, importNameSuggestion, nextDuplicateName } from './utils'

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
    expect(nextDuplicateName('Kitty board', ['Kitty board'])).toBe('Kitty board (copy)')
  })

  it('counts up past every taken "(copy N)" until one is free', () => {
    expect(nextDuplicateName('Kitty board', ['Kitty board', 'Kitty board (copy)'])).toBe('Kitty board (copy 2)')
    expect(nextDuplicateName('Kitty board', ['Kitty board', 'Kitty board (copy)', 'Kitty board (copy 2)'])).toBe('Kitty board (copy 3)')
  })

  it('does not require the source name itself to be present', () => {
    expect(nextDuplicateName('Untitled board', [])).toBe('Untitled board (copy)')
  })
})

describe('importNameSuggestion', () => {
  it("offers the file's name when the board inside is named like one already here", () => {
    expect(importNameSuggestion('A new board', 'both-sides-now.board.zip', ['A new board'])).toBe('both-sides-now')
    expect(importNameSuggestion('A new board', 'Paris.ZIP', ['A new board'])).toBe('Paris')
  })

  it('falls back to a numbered copy when the file is still named after the board', () => {
    expect(importNameSuggestion('A new board', 'A new board.board.zip', ['A new board'])).toBe('A new board (copy)')
  })

  it("numbers the file's name when that is taken too", () => {
    expect(importNameSuggestion('A new board', 'both-sides-now.board.zip', ['A new board', 'both-sides-now'])).toBe('both-sides-now (copy)')
  })

  it("uses the board's own name when the file's name is empty", () => {
    expect(importNameSuggestion('Kitty board', '.board.zip', ['Kitty board'])).toBe('Kitty board (copy)')
  })
})
