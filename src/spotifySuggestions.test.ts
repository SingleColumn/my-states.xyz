// Which curated playlists get suggested, and when that choice may change.
// The random source is injected throughout, so "picks six of these" is an
// assertion about the rule rather than about luck.
import { beforeEach, describe, expect, it } from 'vitest'
import type { CuratedSpotifyPlaylist } from './config/spotifyCuratedPlaylists'
import {
  getSessionSuggestions,
  readPreviousSuggestionIds,
  rememberSuggestionIds,
  resetSessionSuggestionsForTests,
  selectSuggestions,
  shuffleSessionSuggestions,
  suggestionCount,
} from './spotifySuggestions'

/** A pool of `size` entries, cycling through `categories` when given any. */
function pool(size: number, categories: string[] = []): CuratedSpotifyPlaylist[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `id${index}`,
    ...(categories.length > 0 ? { category: categories[index % categories.length] } : {}),
  }))
}

/** A random source that walks a fixed sequence, so a shuffle is reproducible. */
function sequence(values: number[]) {
  let index = 0
  return () => values[index++ % values.length]
}

/** Always picks the first remaining item: the shuffle becomes the identity. */
const noShuffle = () => 0.999999

class MemorySessionStorage implements Storage {
  #values = new Map<string, string>()
  get length() { return this.#values.size }
  clear() { this.#values.clear() }
  getItem(key: string) { return this.#values.get(key) ?? null }
  key(index: number) { return [...this.#values.keys()][index] ?? null }
  removeItem(key: string) { this.#values.delete(key) }
  setItem(key: string, value: string) { this.#values.set(key, value) }
}

beforeEach(() => {
  resetSessionSuggestionsForTests()
})

describe('Choosing suggestions', () => {
  it('takes the number asked for, and never the same playlist twice', () => {
    const chosen = selectSuggestions(pool(40), { random: sequence([0.1, 0.42, 0.77, 0.3, 0.9, 0.05]) })
    expect(chosen).toHaveLength(suggestionCount)
    expect(new Set(chosen.map((entry) => entry.id)).size).toBe(suggestionCount)
  })

  it('gives back everything it has when the pool is smaller than the count', () => {
    const chosen = selectSuggestions(pool(3), { random: noShuffle })
    expect(chosen.map((entry) => entry.id).sort()).toEqual(['id0', 'id1', 'id2'])
  })

  it('suggests nothing at all when the file is empty, rather than failing', () => {
    expect(selectSuggestions([], { random: noShuffle })).toEqual([])
  })

  it('ignores a duplicated id in the file', () => {
    const chosen = selectSuggestions([{ id: 'a' }, { id: 'a' }, { id: 'b' }], { random: noShuffle })
    expect(chosen.map((entry) => entry.id).sort()).toEqual(['a', 'b'])
  })

  it('avoids what was shown before, while there are alternatives', () => {
    const chosen = selectSuggestions(pool(20), { exclude: ['id0', 'id1', 'id2', 'id3'], random: sequence([0.1, 0.5, 0.8, 0.2, 0.6, 0.9]) })
    expect(chosen.map((entry) => entry.id)).not.toContain('id0')
    expect(chosen).toHaveLength(suggestionCount)
  })

  // A pool of four cannot fill six without repeating. Repeating is the right
  // answer there; suggesting nothing would not be.
  it('repeats gracefully when the pool is too small to avoid it', () => {
    const chosen = selectSuggestions(pool(4), { exclude: ['id0', 'id1', 'id2', 'id3'], random: noShuffle })
    expect(chosen).toHaveLength(4)
    expect(new Set(chosen.map((entry) => entry.id)).size).toBe(4)
  })

  it('prefers the unseen entries and only then falls back on the seen ones', () => {
    const chosen = selectSuggestions(pool(8), { exclude: ['id0', 'id1', 'id2', 'id3', 'id4', 'id5'], random: noShuffle })
    const ids = chosen.map((entry) => entry.id)
    // The two nobody has seen come before any of the six they have.
    expect(ids.slice(0, 2).sort()).toEqual(['id6', 'id7'])
    expect(chosen).toHaveLength(suggestionCount)
  })
})

describe('Keeping a set of suggestions varied', () => {
  it('spends each category once before spending any of them twice', () => {
    // Six categories, five of each: a diverse six is available, so it has to
    // be the one chosen.
    const chosen = selectSuggestions(pool(30, ['ambient', 'piano', 'electronic', 'night', 'focus', 'jazz']), {
      random: sequence([0.13, 0.61, 0.29, 0.84, 0.47, 0.72, 0.05, 0.93]),
    })
    const categories = chosen.map((entry) => entry.category)
    expect(new Set(categories).size).toBe(suggestionCount)
  })

  it('doubles up only when there are not six kinds to be had', () => {
    const chosen = selectSuggestions(pool(12, ['ambient', 'piano']), { random: sequence([0.2, 0.7, 0.4, 0.9, 0.1, 0.6]) })
    expect(chosen).toHaveLength(suggestionCount)
    expect(new Set(chosen.map((entry) => entry.category))).toEqual(new Set(['ambient', 'piano']))
  })

  it('falls back to ordinary sampling when nothing carries a category', () => {
    const chosen = selectSuggestions(pool(12), { random: sequence([0.2, 0.7, 0.4, 0.9, 0.1, 0.6]) })
    expect(chosen).toHaveLength(suggestionCount)
    expect(new Set(chosen.map((entry) => entry.id)).size).toBe(suggestionCount)
  })

  it('treats categories as the same whatever their spelling', () => {
    const mixed: CuratedSpotifyPlaylist[] = [
      { id: 'a', category: 'Ambient' },
      { id: 'b', category: ' ambient ' },
      { id: 'c', category: 'piano' },
    ]
    const chosen = selectSuggestions(mixed, { count: 2, random: noShuffle })
    expect(new Set(chosen.map((entry) => entry.category?.trim().toLowerCase())).size).toBe(2)
  })

  // Found in review. When the unseen entries cannot fill the count, the seen
  // ones make up the rest, and the categories the unseen ones already cover
  // still count: the second pass used to start from nothing, and took a second
  // `ambient` only because it came first.
  it('does not repeat a category among the seen entries while another one is left', () => {
    const mixed: CuratedSpotifyPlaylist[] = [
      { id: 'fresh_ambient', category: 'ambient' },
      { id: 'seen_ambient', category: 'ambient' },
      { id: 'seen_jazz', category: 'jazz' },
    ]
    const chosen = selectSuggestions(mixed, { count: 2, exclude: ['seen_ambient', 'seen_jazz'], random: noShuffle })
    expect(chosen.map((entry) => entry.id).sort()).toEqual(['fresh_ambient', 'seen_jazz'])
  })

  it('still repeats a category among the seen entries when nothing else is left', () => {
    const mixed: CuratedSpotifyPlaylist[] = [
      { id: 'fresh_ambient', category: 'ambient' },
      { id: 'seen_ambient', category: 'ambient' },
    ]
    const chosen = selectSuggestions(mixed, { count: 2, exclude: ['seen_ambient'], random: noShuffle })
    expect(chosen.map((entry) => entry.id).sort()).toEqual(['fresh_ambient', 'seen_ambient'])
  })

  it('is the same choice twice over for the same random source', () => {
    const roll = () => sequence([0.31, 0.77, 0.12, 0.58, 0.94, 0.06, 0.41])
    const first = selectSuggestions(pool(24, ['a', 'b', 'c']), { random: roll() })
    const second = selectSuggestions(pool(24, ['a', 'b', 'c']), { random: roll() })
    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id))
  })
})

describe('The set this page session shows', () => {
  it('is chosen once and then holds still, however often it is asked for', () => {
    const entries = pool(40)
    const first = getSessionSuggestions(entries)
    expect(getSessionSuggestions(entries)).toBe(first)
    expect(getSessionSuggestions(entries)).toBe(first)
  })

  it('changes on an explicit shuffle, and avoids what was on screen', () => {
    const entries = pool(40)
    const before = getSessionSuggestions(entries).map((entry) => entry.id)
    const after = shuffleSessionSuggestions(entries).map((entry) => entry.id)

    expect(after).toHaveLength(suggestionCount)
    expect(after.some((id) => before.includes(id))).toBe(false)
    // And the new set is now the session's, so a rerender keeps it.
    expect(getSessionSuggestions(entries).map((entry) => entry.id)).toEqual(after)
  })

  it('shuffles what it can when the pool is barely bigger than the count', () => {
    const entries = pool(7)
    getSessionSuggestions(entries)
    expect(shuffleSessionSuggestions(entries)).toHaveLength(suggestionCount)
  })
})

describe('Remembering the previous set', () => {
  it('reads back what it wrote', () => {
    const storage = new MemorySessionStorage()
    rememberSuggestionIds(['a', 'b'], storage)
    expect(readPreviousSuggestionIds(storage)).toEqual(['a', 'b'])
  })

  it('treats a missing or unreadable record as nothing remembered', () => {
    const storage = new MemorySessionStorage()
    expect(readPreviousSuggestionIds(storage)).toEqual([])
    storage.setItem('mic:spotify-suggestions', 'not json')
    expect(readPreviousSuggestionIds(storage)).toEqual([])
    storage.setItem('mic:spotify-suggestions', '{"not":"an array"}')
    expect(readPreviousSuggestionIds(storage)).toEqual([])
  })

  it('works where there is no session storage at all', () => {
    expect(readPreviousSuggestionIds(null)).toEqual([])
    expect(() => rememberSuggestionIds(['a'], null)).not.toThrow()
  })
})
