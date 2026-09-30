// What the Music panel carries across the redirect to Spotify and back.
// It is read from sessionStorage that a visitor's own browser can edit, so
// most of these are about what happens when what comes back is not what went.
import { describe, expect, it } from 'vitest'
import { forgetReturnContext, rememberReturnContext, takeReturnContext, type SpotifyReturnContext } from './spotifyReturnContext'

class MemorySessionStorage implements Storage {
  #values = new Map<string, string>()
  get length() { return this.#values.size }
  clear() { this.#values.clear() }
  getItem(key: string) { return this.#values.get(key) ?? null }
  key(index: number) { return [...this.#values.keys()][index] ?? null }
  removeItem(key: string) { this.#values.delete(key) }
  setItem(key: string, value: string) { this.#values.set(key, value) }
}

const key = 'mic:spotify-return-context'

const context: SpotifyReturnContext = {
  panelId: 'panel_music',
  momentId: 'moment_1',
  choice: { kind: 'playlist', spotifyId: 'abc123' },
  query: 'rain',
  searchType: 'playlists',
}

describe('The return context', () => {
  it('reads back what was written', () => {
    const storage = new MemorySessionStorage()
    rememberReturnContext(context, storage)
    expect(takeReturnContext(storage)).toEqual(context)
  })

  it('remembers a search when nothing had been chosen', () => {
    const storage = new MemorySessionStorage()
    rememberReturnContext({ ...context, choice: null }, storage)
    expect(takeReturnContext(storage)).toEqual({ ...context, choice: null })
  })

  it('remembers a song search as one', () => {
    const storage = new MemorySessionStorage()
    rememberReturnContext({ ...context, choice: { kind: 'track', spotifyId: 't1' }, query: 'xtal', searchType: 'tracks' }, storage)
    expect(takeReturnContext(storage)).toMatchObject({ choice: { kind: 'track', spotifyId: 't1' }, query: 'xtal', searchType: 'tracks' })
  })

  // It describes one interrupted visit. A second reader would be restoring
  // something that has already been restored.
  it('is read once and then gone', () => {
    const storage = new MemorySessionStorage()
    rememberReturnContext(context, storage)
    expect(takeReturnContext(storage)).not.toBeNull()
    expect(takeReturnContext(storage)).toBeNull()
    expect(storage.getItem(key)).toBeNull()
  })

  it('is gone even when what was stored could not be read', () => {
    const storage = new MemorySessionStorage()
    storage.setItem(key, 'not json')
    expect(takeReturnContext(storage)).toBeNull()
    expect(storage.getItem(key)).toBeNull()
  })

  it('returns nothing when nothing was left', () => {
    expect(takeReturnContext(new MemorySessionStorage())).toBeNull()
  })

  it('works where there is no session storage at all', () => {
    expect(() => rememberReturnContext(context, null)).not.toThrow()
    expect(takeReturnContext(null)).toBeNull()
  })

  it('refuses a record with no panel', () => {
    const storage = new MemorySessionStorage()
    storage.setItem(key, JSON.stringify({ choice: null, query: 'rain', searchType: 'playlists' }))
    expect(takeReturnContext(storage)).toBeNull()
  })

  it('refuses things that are not a record at all', () => {
    for (const raw of ['null', '42', '"text"', '[]']) {
      const storage = new MemorySessionStorage()
      storage.setItem(key, raw)
      expect(takeReturnContext(storage)).toBeNull()
    }
  })

  // The storage is the visitor's own to edit, so a bad field costs that field
  // and not the whole restoration.
  it('falls back field by field on a record that is partly wrong', () => {
    const storage = new MemorySessionStorage()
    storage.setItem(key, JSON.stringify({ panelId: 'panel_music', choice: { kind: 'album', spotifyId: 'x' }, query: 42, searchType: 'everything' }))
    expect(takeReturnContext(storage)).toEqual({ panelId: 'panel_music', momentId: null, choice: null, query: '', searchType: 'playlists' })
  })

  it('drops a choice with no Spotify id', () => {
    const storage = new MemorySessionStorage()
    storage.setItem(key, JSON.stringify({ panelId: 'panel_music', choice: { kind: 'playlist', spotifyId: '' }, query: '', searchType: 'playlists' }))
    expect(takeReturnContext(storage)?.choice).toBeNull()
  })

  it('keeps a remembered search within the length the server would accept', () => {
    const storage = new MemorySessionStorage()
    rememberReturnContext({ ...context, query: 'x'.repeat(500) }, storage)
    expect(takeReturnContext(storage)?.query).toHaveLength(200)

    storage.setItem(key, JSON.stringify({ panelId: 'p', choice: null, query: 'y'.repeat(500), searchType: 'playlists' }))
    expect(takeReturnContext(storage)?.query).toHaveLength(200)
  })

  // The whole point of where this lives. It must hold words and ids and
  // nothing that could authorise anything.
  it('holds no credentials, whatever else is in the storage beside it', () => {
    const storage = new MemorySessionStorage()
    storage.setItem('mic:spotify-tokens', JSON.stringify({ accessToken: 'secret-token', refreshToken: 'secret-refresh', expiresAt: 1 }))
    rememberReturnContext(context, storage)

    const written = storage.getItem(key) ?? ''
    expect(written).not.toContain('secret')
    expect(Object.keys(JSON.parse(written)).sort()).toEqual(['choice', 'momentId', 'panelId', 'query', 'searchType'])
  })
})

// A sign-in that is cancelled at Spotify, or whose callback fails, never comes
// back to read what it left. Whatever visit comes next must not inherit it.
describe('Forgetting the return context', () => {
  it('removes what an earlier attempt left, so the next login finds nothing', () => {
    const storage = new MemorySessionStorage()
    rememberReturnContext(context, storage)

    forgetReturnContext(storage)

    expect(storage.getItem(key)).toBeNull()
    expect(takeReturnContext(storage)).toBeNull()
  })

  it('is harmless when there is nothing to forget, or nowhere to keep it', () => {
    expect(() => forgetReturnContext(new MemorySessionStorage())).not.toThrow()
    expect(() => forgetReturnContext(null)).not.toThrow()
  })

  it('leaves everything else in the storage alone', () => {
    const storage = new MemorySessionStorage()
    storage.setItem('mic:spotify-suggestions', '["a"]')
    rememberReturnContext(context, storage)

    forgetReturnContext(storage)

    expect(storage.getItem('mic:spotify-suggestions')).toBe('["a"]')
  })
})

// Which moment a context was written in decides whether it may be restored, so
// what comes back from storage has to be exactly that or nothing.
describe('The moment a return context belongs to', () => {
  it('comes back as written', () => {
    const storage = new MemorySessionStorage()
    rememberReturnContext({ ...context, momentId: 'moment_42' }, storage)
    expect(takeReturnContext(storage)?.momentId).toBe('moment_42')
  })

  it('is null when the context was written without one, or with a nothing-moment', () => {
    const storage = new MemorySessionStorage()
    storage.setItem(key, JSON.stringify({ panelId: 'p', choice: null, query: '', searchType: 'playlists' }))
    expect(takeReturnContext(storage)?.momentId).toBeNull()

    rememberReturnContext({ ...context, momentId: null }, storage)
    expect(takeReturnContext(storage)?.momentId).toBeNull()
  })

  it('is null rather than a guess when what is stored is not a string', () => {
    const storage = new MemorySessionStorage()
    storage.setItem(key, JSON.stringify({ panelId: 'p', momentId: 42, choice: null, query: '', searchType: 'playlists' }))
    expect(takeReturnContext(storage)?.momentId).toBeNull()
  })
})
