/**
 * Where someone was in the Music panel when they left to connect Spotify.
 *
 * Connecting leaves the page: the browser goes to Spotify and comes back to
 * /callback, and everything the panel held in memory goes with it. Without
 * this they would arrive connected but facing an empty search box, unable to
 * tell whether the playlist they had just chosen was still chosen. This
 * carries just enough to put the panel back as they left it: what was typed,
 * what kind of search it was, and what they had picked.
 *
 * sessionStorage, not a moment and not localStorage: it is about one
 * interrupted action in one tab, it is read once, and it is thrown away
 * whether or not the visitor came back. It never holds a token — the search
 * words, a panel id, and a public Spotify id are the whole of it. The search
 * words stay in this browser tab; they are not sent to analytics or anywhere
 * else.
 */

const returnContextKey = 'mic:spotify-return-context'

/** Long enough for any search a person types; the server refuses more than this anyway. */
const maxRememberedQueryLength = 200

export type SpotifyReturnSearchType = 'playlists' | 'tracks'

export interface SpotifyReturnContext {
  panelId: string
  /**
   * The moment the panel was in. The panel id alone is not enough to say whose
   * this is: the browser opens whichever moment is active when the page comes
   * back, and another tab may have changed that while this one was at Spotify.
   * Null for a context written without one.
   */
  momentId: string | null
  /** What they had picked when they left, if anything. */
  choice: { kind: 'playlist' | 'track'; spotifyId: string } | null
  /** What was in the search box, so the results they were looking at can be found again. */
  query: string
  searchType: SpotifyReturnSearchType
}

export function rememberReturnContext(context: SpotifyReturnContext, storage: Storage | null = sessionStorageOrNull()) {
  if (!storage) return
  try {
    storage.setItem(returnContextKey, JSON.stringify({ ...context, query: context.query.slice(0, maxRememberedQueryLength) }))
  } catch {
    // Losing it costs an empty box on the way back, and nothing else.
  }
}

/**
 * Reads the context and clears it in the same breath. It describes one
 * interrupted visit, so a second reader would be restoring something that has
 * already been restored.
 */
export function takeReturnContext(storage: Storage | null = sessionStorageOrNull()): SpotifyReturnContext | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(returnContextKey)
    storage.removeItem(returnContextKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const { panelId, momentId, choice, query, searchType } = parsed as Partial<Record<keyof SpotifyReturnContext, unknown>>
    if (typeof panelId !== 'string') return null

    return {
      panelId,
      momentId: typeof momentId === 'string' ? momentId : null,
      choice: readChoice(choice),
      query: typeof query === 'string' ? query.slice(0, maxRememberedQueryLength) : '',
      searchType: searchType === 'tracks' ? 'tracks' : 'playlists',
    }
  } catch {
    return null
  }
}

/**
 * Throws away whatever an earlier attempt left. A visit that has nothing to
 * come back to must not inherit one that was abandoned — a cancelled sign-in
 * at Spotify never comes back to read its context, and it would otherwise be
 * waiting for the next login, however unrelated.
 */
export function forgetReturnContext(storage: Storage | null = sessionStorageOrNull()) {
  try {
    storage?.removeItem(returnContextKey)
  } catch {
    // Nothing to do: a value that cannot be removed is one that cannot be read either.
  }
}

function readChoice(value: unknown): SpotifyReturnContext['choice'] {
  if (!value || typeof value !== 'object') return null
  const { kind, spotifyId } = value as { kind?: unknown; spotifyId?: unknown }
  if (kind !== 'playlist' && kind !== 'track') return null
  if (typeof spotifyId !== 'string' || spotifyId.length === 0) return null
  return { kind, spotifyId }
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage ?? null
  } catch {
    return null
  }
}
