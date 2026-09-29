/**
 * Which curated playlists to suggest, and when that choice is allowed to
 * change.
 *
 * The rule the panel depends on: a suggestion set is chosen once per page
 * session and then holds still. React rerenders, panel resizing, switching
 * moments and tldraw redrawing the canvas must all leave it exactly as it
 * was — a set of cards that reshuffled itself while someone was reading it
 * would be unusable. Only a reload or the explicit Shuffle action picks a
 * new one, which is why the choice lives in this module rather than in a
 * component's state.
 *
 * The selection itself is a pure function over an injected random source, so
 * the interesting behaviour — diversity, avoiding the last set, coping with
 * a pool smaller than the count — is testable without any randomness at all.
 */
import { curatedSpotifyPlaylists, type CuratedSpotifyPlaylist } from './config/spotifyCuratedPlaylists'

/** About six: enough to feel chosen, few enough to read in a panel. */
export const suggestionCount = 6

/** The ids shown last time this browser tab loaded the app, so a reload can differ. */
const previousSuggestionsKey = 'mic:spotify-suggestions'

export interface SelectSuggestionsOptions {
  count?: number
  /** Ids to avoid while there are alternatives — the previous set. */
  exclude?: readonly string[]
  /** Injected so a test can be deterministic. Returns a number in [0, 1). */
  random?: () => number
}

/**
 * A subset of `pool`, without duplicates, at most `count` long.
 *
 * Preference order, each step falling through to the next when the pool
 * cannot honour it:
 *
 *   1. entries that are not in `exclude`;
 *   2. one entry per category before a second from any category;
 *   3. whatever is left.
 *
 * A pool smaller than `count` returns everything it has, and an empty pool
 * returns nothing. Neither is an error: the panel shows what it is given.
 */
export function selectSuggestions(
  pool: readonly CuratedSpotifyPlaylist[],
  { count = suggestionCount, exclude = [], random = Math.random }: SelectSuggestionsOptions = {},
): CuratedSpotifyPlaylist[] {
  const unique = [...new Map(pool.filter((entry) => entry && entry.id).map((entry) => [entry.id, entry])).values()]
  if (unique.length === 0 || count <= 0) return []

  const excluded = new Set(exclude)
  const fresh = shuffle(unique.filter((entry) => !excluded.has(entry.id)), random)
  const repeats = shuffle(unique.filter((entry) => excluded.has(entry.id)), random)

  // Entries nobody has just seen first; the previous set is only drawn on
  // when the pool is too small to fill the count without it.
  const chosen = takeDiverse(fresh, count)
  if (chosen.length >= count) return chosen

  const taken = new Set(chosen.map((entry) => entry.id))
  for (const entry of takeDiverse(repeats, count - chosen.length)) {
    if (taken.has(entry.id)) continue
    chosen.push(entry)
    taken.add(entry.id)
  }
  return chosen
}

/**
 * Takes `count` entries, spending each category once before spending any of
 * them twice. Entries with no category are all treated as their own kind, so
 * a pool that carries no categories at all is plain sampling.
 */
function takeDiverse(entries: readonly CuratedSpotifyPlaylist[], count: number) {
  const chosen: CuratedSpotifyPlaylist[] = []
  const spentCategories = new Set<string>()
  const leftovers: CuratedSpotifyPlaylist[] = []

  for (const entry of entries) {
    if (chosen.length >= count) break
    const category = entry.category?.trim().toLowerCase()
    if (category && spentCategories.has(category)) {
      leftovers.push(entry)
      continue
    }
    if (category) spentCategories.add(category)
    chosen.push(entry)
  }

  for (const entry of leftovers) {
    if (chosen.length >= count) break
    chosen.push(entry)
  }
  return chosen
}

/** Fisher-Yates over a copy, with the caller's random source. */
function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const held = result[index]
    result[index] = result[swap]
    result[swap] = held
  }
  return result
}

/**
 * What the previous page load in this tab showed. sessionStorage, so it is
 * per-tab and gone when the tab is: this is a nicety about repetition, not
 * state worth keeping, and it never belongs in a moment.
 */
export function readPreviousSuggestionIds(storage: Storage | null = sessionStorageOrNull()): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(previousSuggestionsKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function rememberSuggestionIds(ids: readonly string[], storage: Storage | null = sessionStorageOrNull()) {
  if (!storage) return
  try {
    storage.setItem(previousSuggestionsKey, JSON.stringify(ids))
  } catch {
    // Private browsing, a full quota, a browser that refuses: the
    // suggestions still work, they may simply repeat on the next reload.
  }
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage ?? null
  } catch {
    return null
  }
}

/**
 * The set for this page session. Chosen on the first call and returned
 * unchanged thereafter, so every render and every panel agrees on it.
 */
let sessionSelection: CuratedSpotifyPlaylist[] | null = null

export function getSessionSuggestions(pool: readonly CuratedSpotifyPlaylist[] = curatedSpotifyPlaylists): CuratedSpotifyPlaylist[] {
  if (sessionSelection) return sessionSelection
  const selected = selectSuggestions(pool, { exclude: readPreviousSuggestionIds() })
  sessionSelection = selected
  rememberSuggestionIds(selected.map((entry) => entry.id))
  return selected
}

/**
 * Another valid set, without a reload. It avoids what is on screen for the
 * same reason a reload does — being handed the same six back is not a
 * shuffle — and touches nothing else: no moment, no playback, no Spotify
 * session.
 */
export function shuffleSessionSuggestions(pool: readonly CuratedSpotifyPlaylist[] = curatedSpotifyPlaylists): CuratedSpotifyPlaylist[] {
  const showing = (sessionSelection ?? []).map((entry) => entry.id)
  const selected = selectSuggestions(pool, { exclude: showing })
  sessionSelection = selected
  rememberSuggestionIds(selected.map((entry) => entry.id))
  return selected
}

/** Test seam: the session's choice is module state, and a test must start fresh. */
export function resetSessionSuggestionsForTests() {
  sessionSelection = null
}
