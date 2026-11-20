import { useCallback, useEffect, useRef, useState } from 'react'
import type { Panel, Board, SpotifyPlaylistReference, SpotifySavedTrack } from './types'
import { defaultSpotifyPlaylistReference } from './storage'
import { type PanelWriteOptions } from './panelStore'
import { parseSpotifyPlaylistUrl, type SpotifyPlaylistSummary, type SpotifyTrackSummary } from './spotify'
import { fetchCuratedPlaylists, searchCatalogPlaylists, searchCatalogTracks } from './spotifyCatalog'
import type { PanelsState } from './AppState'

/**
 * Finding and choosing music for the Music panel. Nothing here plays it:
 * Spotify's own embedded player does that (see panels/SpotifyEmbedStrip.tsx),
 * and nothing here signs anyone in. Search goes through this app's catalog
 * endpoint, which asks Spotify with the application's credentials. The
 * earlier approach, connecting a Spotify account and playing through the Web
 * Playback SDK, is kept in docs/spotify-sdk-approach.md.
 */
export interface SpotifyState {
  playlists: SpotifyPlaylistSummary[]
  tracks: SpotifyTrackSummary[]
  /**
   * A song someone picked out of the results in this visit. It is also saved
   * in the board, in place of its playlist; this copy is what marks it among
   * the results.
   */
  selectedTrack: SpotifyTrackSummary | null
  error: string | null
  clearSearchResults(): void
  playlistsHaveMore: boolean
  loadMorePlaylists(): Promise<void>
  searchPlaylists(query: string): Promise<void>
  searchTracks(query: string): Promise<void>
  /** Makes a public playlist, given by its Spotify link, the panel's music. */
  loadPlaylistFromUrl(url: string, panelId?: string): Promise<void>
  /** Makes a playlist the panel's music. Spotify's player then loads it. */
  selectPlaylist(summary: SpotifyPlaylistSummary, panelId?: string): void
  /** A song (not null) is also saved in the panel, in place of its playlist. */
  selectTrack(summary: SpotifyTrackSummary | null, panelId?: string): void
}

// One page of results, so a search is one request. Paging further used to
// collect fifty playlists over five sequential requests, which nothing showed
// until the last of them returned — too slow to sit behind every keystroke,
// and more than anyone scrolls through to pick something to put on.
//
// Ten, and ten is not a preference: a playlist search takes no other page
// size. Measured against the live endpoint on 2026-09-27 — 10 answers 200,
// and 11, 12, 15, 20, 30 and 50 all answer 400 "Invalid limit", whatever the
// documented 0-50 range says. More than ten playlists therefore means more
// requests; it cannot mean a bigger one.
const searchResultLimit = 10

// Below this many real playlists on the first page, fetch one more page before
// showing anything. Eight fills the visible list without a second request in
// the common case.
const minFirstPageResults = 8

/**
 * Exported for its tests. The sequence guard below decides which reply to a
 * search is still wanted, and that is only observable from inside this hook —
 * the panel sees the answer, never the race that chose it.
 */
export function useSpotifyState(board: Board | null, panels: PanelsState): SpotifyState {
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([])
  const [tracks, setTracks] = useState<SpotifyTrackSummary[]>([])
  const [selectedTrack, setSelectedTrack] = useState<SpotifyTrackSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The panel searches as someone types, so a reply for "jaz" can land after
  // the reply for "jazz". Tracks and playlists share one counter because
  // switching the search type mid-flight can cross them too: only the most
  // recent request of either kind is allowed to set results.
  const searchSequenceRef = useRef(0)
  const [playlistsHaveMore, setPlaylistsHaveMore] = useState(false)
  const playlistCursorRef = useRef<{ query: string; offset: number } | null>(null)

  useEffect(() => {
    setPlaylists([])
    setTracks([])
    setSelectedTrack(null)
  }, [board?.id])

  const panelsRef = useRef(panels)
  panelsRef.current = panels
  const spotifyPanel = panels.all.find((panel): panel is Panel<'spotify'> => panel.type === 'spotify')
  // The user chose the playlist: history. The app filling in artwork it
  // looked up: not history, or Undo would take the picture away again.
  const setBoardPlaylist = useCallback((next: SpotifyPlaylistReference, panelId?: string, options?: PanelWriteOptions) => {
    const current = panelsRef.current
    const panel = (panelId ? current.get(panelId) : undefined) ?? current.all.find((candidate) => candidate.type === 'spotify')
    if (panel?.type === 'spotify') current.updateConfig<'spotify'>(panel.id, { playlist: next }, options)
  }, [])

  // Choosing one kind of music replaces the other: a board keeps a playlist or
  // a song, so the panel never names a playlist beside a song from elsewhere.
  // Filling in a playlist's artwork (setBoardPlaylist above) is not a choice
  // and leaves a saved song alone.
  const chooseBoardPlaylist = useCallback((next: SpotifyPlaylistReference, panelId?: string) => {
    const current = panelsRef.current
    const panel = (panelId ? current.get(panelId) : undefined) ?? current.all.find((candidate) => candidate.type === 'spotify')
    if (panel?.type === 'spotify') current.updateConfig<'spotify'>(panel.id, { playlist: next, track: null })
  }, [])
  const chooseBoardTrack = useCallback((next: SpotifySavedTrack, panelId?: string) => {
    const current = panelsRef.current
    const panel = (panelId ? current.get(panelId) : undefined) ?? current.all.find((candidate) => candidate.type === 'spotify')
    // Choosing the saved song again is not a new choice, and must not become
    // one more step for Undo to walk back through.
    if (panel?.type !== 'spotify' || panel.config.track?.id === next.id) return
    current.updateConfig<'spotify'>(panel.id, { playlist: { ...defaultSpotifyPlaylistReference }, track: savedTrackFrom(next) })
  }, [])

  // A playlist saved before the panel showed artwork - or restored from an
  // exported board - has a name but no image. Look the artwork up once so the
  // panel can still show which playlist is loaded. Artwork is public, so the
  // catalog endpoint answers with the application's credentials.
  const savedPlaylist = spotifyPanel?.config.playlist
  const playlistMissingArtwork = savedPlaylist?.id && !savedPlaylist.image ? savedPlaylist.id : null
  const artworkLookupsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!playlistMissingArtwork) return
    if (artworkLookupsRef.current.has(playlistMissingArtwork)) return
    artworkLookupsRef.current.add(playlistMissingArtwork)
    let cancelled = false
    let answered = false
    void (async () => {
      try {
        const summary = (await fetchCuratedPlaylists([playlistMissingArtwork]))[0]
        answered = true
        if (cancelled || !summary?.image) return
        setBoardPlaylist({ id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image }, undefined, { history: 'ignore' })
      } catch {
        // Artwork is decoration: a failed lookup must not interrupt anything.
        // Nor is it final: forgetting the attempt lets a later render try again.
        if (!cancelled) artworkLookupsRef.current.delete(playlistMissingArtwork)
      }
    })()
    return () => {
      cancelled = true
      // Cut off before it could say anything: the attempt did not happen, so
      // the run that replaces this one must be free to make it.
      if (!answered) artworkLookupsRef.current.delete(playlistMissingArtwork)
    }
  }, [playlistMissingArtwork, setBoardPlaylist])

  const clearSearchResults = useCallback(() => {
    // A search already on its way still carries the current sequence number,
    // and would pass its own guard and refill the list it was just cleared
    // from — under a box someone has emptied, beside the prompt to type in it.
    // Moving the sequence on is what makes that reply stale.
    searchSequenceRef.current += 1
    setPlaylists([])
    setTracks([])
    setPlaylistsHaveMore(false)
    playlistCursorRef.current = null
  }, [])

  const searchPlaylists = useCallback(async (query: string) => {
    const sequence = ++searchSequenceRef.current
    const trimmed = query.trim()
    if (!trimmed) {
      setPlaylists([])
      setPlaylistsHaveMore(false)
      playlistCursorRef.current = null
      return
    }
    const first = await searchCatalogPlaylists(trimmed, 0)
    if (sequence !== searchSequenceRef.current) return

    let items = [...first.items]
    let offset = searchResultLimit
    let hasMore = first.hasMore

    // Spotify blanks entries in playlist search results: a full page of ten
    // came back carrying six real playlists for "dark techno" (measured
    // 2026-09-27), and the blanks are already dropped by the time a page
    // reaches here. A thin first page is the one case worth a second request
    // straight away, so a search does not open on a near-empty list.
    if (hasMore && items.length < minFirstPageResults) {
      const second = await searchCatalogPlaylists(trimmed, offset)
      if (sequence !== searchSequenceRef.current) return
      items = items.concat(second.items)
      offset += searchResultLimit
      hasMore = second.hasMore
    }

    setPlaylists([...new Map(items.map((item) => [item.id, item])).values()])
    playlistCursorRef.current = { query: trimmed, offset }
    setPlaylistsHaveMore(hasMore)
    setError(null)
  }, [])

  // Asked for by the person reading the list, so it appends rather than
  // replacing, and a search started in the meantime cancels it.
  const loadMorePlaylists = useCallback(async () => {
    const cursor = playlistCursorRef.current
    if (!cursor) return
    const sequence = searchSequenceRef.current
    const page = await searchCatalogPlaylists(cursor.query, cursor.offset)
    if (sequence !== searchSequenceRef.current || playlistCursorRef.current?.query !== cursor.query) return
    setPlaylists((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()])
    playlistCursorRef.current = { query: cursor.query, offset: cursor.offset + searchResultLimit }
    setPlaylistsHaveMore(page.hasMore)
    setError(null)
  }, [])

  const searchTracks = useCallback(async (query: string) => {
    const sequence = ++searchSequenceRef.current
    const trimmed = query.trim()
    if (!trimmed) {
      setTracks([])
      return
    }
    const result = await searchCatalogTracks(buildTrackSearchQuery(trimmed))
    if (sequence !== searchSequenceRef.current) return
    setTracks(rankTracks(result.items, trimmed))
    setError(null)
  }, [])

  const selectPlaylist = useCallback((summary: SpotifyPlaylistSummary, panelId?: string) => {
    chooseBoardPlaylist({ id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image }, panelId)
    // The newest choice is the one that counts. A song chosen earlier outranks
    // the panel's playlist wherever the panel decides what is chosen, so it has
    // to go, or the panel keeps describing the song instead of the playlist
    // that was just picked.
    setSelectedTrack(null)
    setError(null)
  }, [chooseBoardPlaylist])

  const loadPlaylistFromUrl = useCallback(async (url: string, panelId?: string) => {
    const id = parseSpotifyPlaylistUrl(url)
    if (!id) throw new Error('Paste a valid Spotify playlist URL or URI.')
    const summary = (await fetchCuratedPlaylists([id]))[0]
    if (!summary) throw new Error('Spotify could not find that playlist. It may be private.')
    selectPlaylist(summary, panelId)
  }, [selectPlaylist])

  const selectTrack = useCallback((summary: SpotifyTrackSummary | null, panelId?: string) => {
    setSelectedTrack(summary)
    if (summary) {
      chooseBoardTrack(summary, panelId)
      setError(null)
    }
  }, [chooseBoardTrack])

  return {
    playlists, tracks, selectedTrack, error, clearSearchResults,
    searchPlaylists, searchTracks, loadPlaylistFromUrl, selectPlaylist, selectTrack,
    playlistsHaveMore, loadMorePlaylists,
  }
}

function buildTrackSearchQuery(query: string) {
  const parts = query.split(/\s+-\s+|\s+by\s+/i)
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return query
  return `track:${parts[0].trim()} artist:${parts[1].trim()}`
}

function rankTracks(tracks: SpotifyTrackSummary[], query: string) {
  const normalisedQuery = normaliseSearchText(query)
  const [title, artist] = query.split(/\s+-\s+|\s+by\s+/i).map(normaliseSearchText)
  return [...tracks].sort((left, right) => scoreTrack(right) - scoreTrack(left))

  function scoreTrack(track: SpotifyTrackSummary) {
    const trackTitle = normaliseSearchText(track.name)
    const trackArtist = normaliseSearchText(track.artists)
    const combined = `${trackTitle} ${trackArtist}`
    let score = 0
    if (combined === normalisedQuery) score += 1000
    if (trackTitle === normalisedQuery) score += 800
    if (title && trackTitle === title) score += 700
    if (artist && trackArtist.includes(artist)) score += 500
    if (combined.includes(normalisedQuery)) score += 300
    score += normalisedQuery.split(' ').filter((word) => combined.includes(word)).length * 10
    return score
  }
}

function normaliseSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Only the song's own fields: a search result may carry more than the board needs to keep. */
function savedTrackFrom(summary: SpotifyTrackSummary): SpotifySavedTrack {
  const { id, uri, name, artists, album, url, image, durationMs } = summary
  return { id, uri, name, artists, album, url, image, durationMs }
}
