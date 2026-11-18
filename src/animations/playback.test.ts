import { beforeEach, describe, expect, it, vi } from 'vitest'
import { builtInAnimations, duplicateAnimation, loadCustomAnimations, saveCustomAnimations } from './definitions'
import { illuminatedIndices, revealedCount, wordIndices } from './playback'

describe('animation playback', () => {
  it('assigns word order without counting whitespace and handles empty and long text', () => {
    expect(wordIndices('One  two\nthree').filter(part => part.index !== null)).toEqual([
      { text: 'One', index: 0 }, { text: 'two', index: 1 }, { text: 'three', index: 2 },
    ])
    expect(wordIndices('')).toEqual([])
    expect(wordIndices(Array(20_001).join('word ')).filter(part => part.index !== null)).toHaveLength(20_000)
    expect(revealedCount(500, 4, 3)).toBe(2)
    expect(revealedCount(5_000, 4, 3)).toBe(3)
  })

  it('chooses distinct illuminated words deterministically from a seed and tick', () => {
    const definition = builtInAnimations[1]
    expect(illuminatedIndices(definition, 12, 100)).toEqual(illuminatedIndices(definition, 12, 100))
    expect(illuminatedIndices(definition, 12, 100)).not.toEqual(illuminatedIndices(definition, 13, 100))
    expect(new Set(illuminatedIndices(definition, 12, 100)).size).toBe(3)
    expect(illuminatedIndices(definition, 100_000, 0)).toEqual([])
    expect(illuminatedIndices(definition, 100_000, 1)).toEqual([0])
  })
})

describe('local animation definitions', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  })
  it('restores a saved copy independently of the built-in', () => {
    const copy = duplicateAnimation(builtInAnimations[0])
    copy.css = '.word { opacity: 0.4; }'
    saveCustomAnimations([copy])
    expect(loadCustomAnimations()).toEqual([copy])
    expect(builtInAnimations[0].css).not.toBe(copy.css)
  })
})
