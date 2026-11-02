import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Panel,
  Board,
  SpotifyPlaylistReference,
  SpotifySavedTrack,
  SpotifyTokens,
  SpotifyTrackState,
} from './types'
import { defaultSpotifyPlaylistReference, saveSpotifyTokens, loadSpotifyTokens } from './storage'
import { type PanelWriteOptions } from './panelStore'
import {
  exchangeSpotifyCode,
  getSpotifyPlaybackAction,
  isSpotifyPlaylistApiItem,
  isSpotifyTrackApiItem,
  mapPlaylist,
  mapTrack,
  parseSpotifyPlaylistUrl,
  refreshSpotifyToken,
  SpotifyPlaylistApiItem,
  SpotifyPlaylistSearchResult,
  SpotifyPlaylistSummary,
  SpotifyAuthenticationError,
  SpotifyTrackApiItem,
  SpotifyTrackSearchResult,
  SpotifyTrackSummary,
  spotifyFetch,
  startSpotifyLogin,
} from './spotify'
import { fetchCuratedPlaylists, searchCatalogPlaylists, searchCatalogTracks } from './spotifyCatalog'
import type { PanelsState } from './AppState'

export interface SpotifyState {
  tokens: SpotifyTokens | null
  playlists: SpotifyPlaylistSummary[]
  tracks: SpotifyTrackSummary[]
  track: SpotifyTrackState | null
  /**
   * A song someone picked out of the results without playing it. Runtime
   * only, and never part of a board: a board remembers a playlist, which
   * is what the panel is for, and a chosen song is a step on the way to one
   * rather than something to reopen a board on.
   */
  selectedTrack: SpotifyTrackSummary | null
  deviceId: string | null
  isReady: boolean
  status: string
  error: string | null
  login(): Promise<void>
  logout(): void
  clearSearchResults(): void
  handleCallback(code: string, state: string | null): Promise<void>
  /**
   * True once a sign-in that left for Spotify has come back without succeeding:
   * cancelled there, refused, or its code could not be exchanged. The panel uses
   * it to give back what the visitor was doing, which a success gives back by
   * another route.
   */
  signInFailed: boolean
  /**
   * The session ended on its own -- Spotify stopped accepting it -- rather than
   * by logging out. The panel says so, since nobody chose it; cleared by the
   * next sign-in or a deliberate log-out.
   */
  sessionEnded: boolean
  /** For the ways a callback fails before there is a code to exchange. */
  reportSignInFailure(): void
  playlistsHaveMore: boolean
  loadMorePlaylists(): Promise<void>
  searchPlaylists(query: string): Promise<void>
  searchTracks(query: string): Promise<void>
  loadPlaylistFromUrl(url: string, panelId?: string): Promise<void>
  /**
   * Makes a playlist the panel's loaded one without playing it. Choosing and
   * playing are two things: someone browsing before they have connected
   * Spotify can do the first, and only the second needs their account.
   */
  selectPlaylist(summary: SpotifyPlaylistSummary, panelId?: string): void
  /** Holds a song for Play; a song (not null) is also saved in the panel, in place of its playlist. */
  selectTrack(summary: SpotifyTrackSummary | null, panelId?: string): void
  /** Reads one song's public details by id — how a song chosen before connecting is found again afterwards. */
  lookupTrack(trackId: string): Promise<void>
  playPlaylist(summary?: SpotifyPlaylistSummary, panelId?: string): Promise<void>
  playTrack(summary: SpotifyTrackSummary, panelId?: string): Promise<void>
  togglePlay(panelId?: string): Promise<void>
  previousTrack(): Promise<void>
  nextTrack(): Promise<void>
  setVolume(value: number): Promise<void>
  seek(positionMs: number): Promise<void>
}

// One page of results, so a search is one request. Paging further used to
// collect fifty playlists over five sequential requests, which nothing showed
// until the last of them returned — too slow to sit behind every keystroke,
// and more than anyone scrolls through to pick something to put on.
//
// Ten, and ten is not a preference: a playlist search takes no other page
// size. Measured against the live endpoint on 2026-09-27 — 10 answers 200,
// and 11, 12, 15, 20, 30 and 50 all answer 400 "Invalid limit", whatever the
// documented 0-50 range says. The paging this replaced asked for ten a page
// for that reason, not out of caution. More than ten playlists therefore
// means more requests; it cannot mean a bigger one.
const searchResultLimit = 10

// Below this many real playlists on the first page, fetch one more page before
// showing anything. Eight fills the visible list without a second request in
// the common case.
const minFirstPageResults = 8

interface SpotifyPlaylistSearchPage {
  playlists: { next: string | null; items: Array<SpotifyPlaylistApiItem | null> }
}

/**
 * Exported for its tests. The sequence guard below decides which reply to a
 * search is still wanted, and that is only observable from inside this hook —
 * the panel sees the answer, never the race that chose it.
 */
export function useSpotifyState(board: Board | null, panels: PanelsState): SpotifyState {
  const [tokens, setTokens] = useState<SpotifyTokens | null>(loadSpotifyTokens)
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([])
  const [tracks, setTracks] = useState<SpotifyTrackSummary[]>([])
  const [track, setTrack] = useState<SpotifyTrackState | null>(null)
  const [selectedTrack, setSelectedTrack] = useState<SpotifyTrackSummary | null>(null)
  // Counts every deliberate change to the held song: chosen, cleared, or
  // superseded by playing something. A lookup still in flight when that
  // happens is answering a question about an earlier state — the visitor may
  // have opened another board, cleared the search or picked something else —
  // and must not put its answer back.
  const selectedTrackEpochRef = useRef(0)
  const changeSelectedTrack = useCallback((next: SpotifyTrackSummary | null) => {
    selectedTrackEpochRef.current += 1
    setSelectedTrack(next)
  }, [])
  const [signInFailed, setSignInFailed] = useState(false)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)
  // Only the connected panel shows this line, and it shows it before the
  // browser device has reported in. Asking someone to log in was wrong there
  // even before searching stopped needing a session: they already had one.
  const [status, setStatus] = useState('Choose a playlist to play.')
  const [error, setError] = useState<string | null>(null)
  const playerRef = useRef<Spotify.Player | null>(null)
  const tokensRef = useRef(tokens)
  // The panel searches as someone types, so a reply for "jaz" can land after
  // the reply for "jazz". Tracks and playlists share one counter because
  // switching the search type mid-flight can cross them too: only the most
  // recent request of either kind is allowed to set results.
  const searchSequenceRef = useRef(0)
  const positionBaseRef = useRef<{ positionMs: number; at: number; paused: boolean } | null>(null)
  const [playlistsHaveMore, setPlaylistsHaveMore] = useState(false)
  const playlistCursorRef = useRef<{ query: string; offset: number } | null>(null)

  useEffect(() => {
    tokensRef.current = tokens
  }, [tokens])

  // The Web Playback SDK reports state on events — a play, a pause, a track
  // change — and not while a track simply runs on. Read literally, that leaves
  // the progress bar sitting at whatever second the last event happened to
  // land on, for as long as nothing else occurs. So the bar keeps its own
  // clock between reports, and every report resets it to the truth.
  useEffect(() => {
    if (!tokens) return
    const intervalId = window.setInterval(() => {
      const base = positionBaseRef.current
      if (!base || base.paused) return
      setTrack((current) => {
        if (!current || current.paused) return current
        const next = Math.min(base.positionMs + (Date.now() - base.at), current.durationMs)
        // Below a quarter second the bar cannot show the difference, and the
        // render would cost more than it tells anyone.
        return Math.abs(next - current.positionMs) < 250 ? current : { ...current, positionMs: next }
      })
    }, 500)
    return () => window.clearInterval(intervalId)
  }, [tokens])

  useEffect(() => {
    setPlaylists([])
    setTracks([])
    setTrack(null)
    changeSelectedTrack(null)
    // A line such as "Playing <song>." describes the board just left; the
    // panel shows it whenever nothing is playing, beside this board's music.
    setStatus('Choose a playlist to play.')
  }, [board?.id, changeSelectedTrack])

  useEffect(() => {
    saveSpotifyTokens(tokens)
  }, [tokens])

  const endExpiredSession = useCallback(() => {
    playerRef.current?.disconnect()
    playerRef.current = null
    setTokens(null)
    setDeviceId(null)
    setIsReady(false)
    setTrack(null)
    setStatus('Your Spotify session has expired. Log in again to continue playback.')
    setSessionEnded(true)
    setError(null)
  }, [])

  const ensureFreshTokens = useCallback(async () => {
    if (!tokens) throw new Error('Log in to Spotify first.')
    if (tokens.expiresAt - Date.now() > 60_000) return tokens
    try {
      const refreshed = await refreshSpotifyToken(tokens)
      if (refreshed.expiresAt <= Date.now()) throw new Error('Spotify session has expired.')
      setTokens(refreshed)
      return refreshed
    } catch {
      endExpiredSession()
      throw new Error('Your Spotify session has expired. Log in again to continue playback.')
    }
  }, [endExpiredSession, tokens])

  const requestSpotify = useCallback(async <T,>(request: () => Promise<T>) => {
    try {
      return await request()
    } catch (caught) {
      if (caught instanceof SpotifyAuthenticationError) {
        endExpiredSession()
        throw new Error('Your Spotify session has expired. Log in again to continue playback.')
      }
      throw caught
    }
  }, [endExpiredSession])

  useEffect(() => {
    if (!tokens?.accessToken || playerRef.current) return
    let cancelled = false
    async function initPlayer() {
      try {
        await loadSpotifySdk()
        if (cancelled || !window.Spotify || !tokens?.accessToken) return
        const player = new window.Spotify.Player({ name: 'my-states.xyz', getOAuthToken: (callback) => callback(tokensRef.current?.accessToken ?? ''), volume: 0.7 })
        player.addListener('ready', ({ device_id }) => {
          setDeviceId(device_id)
          setIsReady(true)
          setStatus('Spotify browser device is ready.')
          setError(null)
        })
        player.addListener('not_ready', () => {
          setIsReady(false)
          setStatus('Spotify browser device is offline.')
        })
        player.addListener('player_state_changed', (state) => {
          if (!state) return
          const current = state.track_window.current_track
          // Where playback truly was, and when we heard it. The clock below
          // counts on from here until the next report corrects it.
          positionBaseRef.current = { positionMs: state.position, at: Date.now(), paused: state.paused }
          setTrack({ title: current.name, artist: current.artists.map((artist) => artist.name).join(', '), album: current.album.name, albumArt: current.album.images[0]?.url ?? null, url: spotifyUrlFromUri(current.uri), durationMs: state.duration, positionMs: state.position, paused: state.paused })
        })
        const handleError = (event: Spotify.WebPlaybackError) => {
          setError(event.message)
          setStatus('Spotify playback needs attention.')
        }
        player.addListener('initialization_error', handleError)
        player.addListener('authentication_error', endExpiredSession)
        player.addListener('account_error', handleError)
        player.addListener('playback_error', handleError)
        playerRef.current = player
        await player.connect()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not initialize Spotify.')
      }
    }
    void initPlayer()
    return () => {
      cancelled = true
    }
  }, [endExpiredSession, tokens?.accessToken])

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
    // Play pressed again for the saved song is not a new choice, and must not
    // become one more step for Undo to walk back through.
    if (panel?.type !== 'spotify' || panel.config.track?.id === next.id) return
    current.updateConfig<'spotify'>(panel.id, { playlist: { ...defaultSpotifyPlaylistReference }, track: savedTrackFrom(next) })
  }, [])

  // A playlist saved before the panel showed artwork - or restored from an
  // exported board - has a name but no image. Look the artwork up once so the
  // panel can still show which playlist is loaded.
  const savedPlaylist = spotifyPanel?.config.playlist
  const playlistMissingArtwork = savedPlaylist?.id && !savedPlaylist.image ? savedPlaylist.id : null
  // What has been asked about, and by which way of asking. "Once" means once
  // per playlist per way: the app can only describe a public playlist, so
  // "nothing found" before connecting says nothing about what the visitor's own
  // account can see, and must not stop the lookup being made with it later.
  const artworkLookupsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!playlistMissingArtwork) return
    const lookupKey = `${playlistMissingArtwork}:${tokens ? 'user' : 'app'}`
    if (artworkLookupsRef.current.has(lookupKey)) return
    artworkLookupsRef.current.add(lookupKey)
    let cancelled = false
    let answered = false
    void (async () => {
      try {
        // Artwork is public, so this works before anyone connects too: the
        // catalog endpoint answers the same question with the application's
        // credentials. An imported board therefore shows its cover either way.
        const summary = tokens
          ? mapPlaylist(await spotifyFetch<SpotifyPlaylistApiItem>(`/playlists/${playlistMissingArtwork}`, (await ensureFreshTokens()).accessToken))
          : (await fetchCuratedPlaylists([playlistMissingArtwork]))[0]
        answered = true
        if (cancelled || !summary?.image) return
        setBoardPlaylist({ id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image }, undefined, { history: 'ignore' })
      } catch {
        // Artwork is decoration: a failed lookup must not interrupt playback.
        // Nor is it final. Forgetting the attempt lets the next thing that
        // changes — connecting Spotify, most likely — try again.
        if (!cancelled) artworkLookupsRef.current.delete(lookupKey)
      }
    })()
    return () => {
      cancelled = true
      // Cut off before it could say anything (the visitor finished connecting
      // while it was in flight): the attempt did not happen, so the run that
      // replaces this one must be free to make it.
      if (!answered) artworkLookupsRef.current.delete(lookupKey)
    }
  }, [ensureFreshTokens, playlistMissingArtwork, setBoardPlaylist, tokens])

  const login = useCallback(async () => startSpotifyLogin(), [])
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
  const logout = useCallback(() => {
    playerRef.current?.disconnect()
    playerRef.current = null
    setTokens(null)
    setDeviceId(null)
    setIsReady(false)
    setTrack(null)
    setStatus('Logged out of Spotify.')
    setSessionEnded(false)
  }, [])
  const handleCallback = useCallback(async (code: string, state: string | null) => {
    try {
      setTokens(await exchangeSpotifyCode(code, state))
      setSessionEnded(false)
    } catch (caught) {
      setSignInFailed(true)
      throw caught
    }
    setSignInFailed(false)
    setStatus('Spotify login complete.')
    setError(null)
  }, [])
  const reportSignInFailure = useCallback(() => setSignInFailed(true), [])

  /**
   * One page of playlists, from whichever Spotify the asker has.
   *
   * Connected, that is Spotify itself with the visitor's own token, which is
   * what makes their results theirs. Not connected, it is this app's own
   * endpoint, which asks Spotify with the application's credentials — the
   * public catalog, and nothing that belongs to anybody.
   *
   * Both answer in the same shape, already mapped, because everything above
   * this line (the thin-first-page rule, the cursor, de-duplication, the
   * sequence guard) has no business knowing which of the two it got.
   */
  const fetchPlaylistPage = useCallback(async (query: string, offset: number, accessToken: string | null): Promise<SpotifyPlaylistSearchResult> => {
    if (accessToken === null) return searchCatalogPlaylists(query, offset)
    const params = new URLSearchParams({ q: query, type: 'playlist', limit: String(searchResultLimit), offset: String(offset) })
    const page = await requestSpotify(() => spotifyFetch<SpotifyPlaylistSearchPage>(`/search?${params.toString()}`, accessToken))
    return {
      items: page.playlists.items.filter(isSpotifyPlaylistApiItem).map(mapPlaylist),
      hasMore: Boolean(page.playlists.next),
    }
  }, [requestSpotify])

  // A search can take two requests (a thin first page is followed at once by a
  // second), and both must use the token this refreshes. Each `ensureFreshTokens`
  // call reads the `tokens` its render closed over, so a second call inside the
  // same search would find it still near expiry and refresh it again: a second
  // use of a refresh token that may already have been rotated, and a failure
  // there ends a session the first refresh had just renewed. Null when signed
  // out, which is the anonymous route.
  const searchAccessToken = useCallback(async (): Promise<string | null> => {
    if (!tokens) return null
    return (await ensureFreshTokens()).accessToken
  }, [ensureFreshTokens, tokens])

  const fetchTrackPage = useCallback(async (query: string): Promise<SpotifyTrackSearchResult> => {
    if (!tokens) return searchCatalogTracks(query)
    const fresh = await ensureFreshTokens()
    const result = await requestSpotify(() => spotifyFetch<{ tracks: { items: Array<SpotifyTrackApiItem | null> } }>(
      `/search?${new URLSearchParams({ q: query, type: 'track', limit: String(searchResultLimit) }).toString()}`,
      fresh.accessToken,
    ))
    return { items: result.tracks.items.filter(isSpotifyTrackApiItem).map(mapTrack) }
  }, [ensureFreshTokens, requestSpotify, tokens])

  const searchPlaylists = useCallback(async (query: string) => {
    const sequence = ++searchSequenceRef.current
    const trimmed = query.trim()
    if (!trimmed) {
      setPlaylists([])
      setPlaylistsHaveMore(false)
      playlistCursorRef.current = null
      return
    }
    const accessToken = await searchAccessToken()
    if (sequence !== searchSequenceRef.current) return
    const first = await fetchPlaylistPage(trimmed, 0, accessToken)
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
      const second = await fetchPlaylistPage(trimmed, offset, accessToken)
      if (sequence !== searchSequenceRef.current) return
      items = items.concat(second.items)
      offset += searchResultLimit
      hasMore = second.hasMore
    }

    setPlaylists([...new Map(items.map((item) => [item.id, item])).values()])
    playlistCursorRef.current = { query: trimmed, offset }
    setPlaylistsHaveMore(hasMore)
    setError(null)
  }, [fetchPlaylistPage, searchAccessToken])

  // Asked for by the person reading the list, so it appends rather than
  // replacing, and a search started in the meantime cancels it.
  const loadMorePlaylists = useCallback(async () => {
    const cursor = playlistCursorRef.current
    if (!cursor) return
    const sequence = searchSequenceRef.current
    const accessToken = await searchAccessToken()
    if (sequence !== searchSequenceRef.current) return
    const page = await fetchPlaylistPage(cursor.query, cursor.offset, accessToken)
    if (sequence !== searchSequenceRef.current || playlistCursorRef.current?.query !== cursor.query) return
    setPlaylists((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()])
    playlistCursorRef.current = { query: cursor.query, offset: cursor.offset + searchResultLimit }
    setPlaylistsHaveMore(page.hasMore)
    setError(null)
  }, [fetchPlaylistPage, searchAccessToken])

  const searchTracks = useCallback(async (query: string) => {
    const sequence = ++searchSequenceRef.current
    const trimmed = query.trim()
    if (!trimmed) {
      setTracks([])
      return
    }
    const result = await fetchTrackPage(buildTrackSearchQuery(trimmed))
    if (sequence !== searchSequenceRef.current) return
    setTracks(rankTracks(result.items, trimmed))
    setError(null)
  }, [fetchTrackPage])

  const loadPlaylistFromUrl = useCallback(async (url: string, panelId?: string) => {
    const id = parseSpotifyPlaylistUrl(url)
    if (!id) throw new Error('Paste a valid Spotify playlist URL or URI.')
    const fresh = await ensureFreshTokens()
    const item = await requestSpotify(() => spotifyFetch<SpotifyPlaylistApiItem>(`/playlists/${id}`, fresh.accessToken))
    const summary = mapPlaylist(item)
    const selected = { id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image }
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ context_uri: selected.uri }) }))
    // Playback has been accepted, so whatever song was being held for Play is
    // superseded. The player only reports what is playing some boards later,
    // and until it does the held song would still outrank this in the panel.
    changeSelectedTrack(null)
    chooseBoardPlaylist(selected, panelId)
    setPlaylists((current) => [summary, ...current.filter((candidate) => candidate.id !== summary.id)])
    setStatus(`Playing ${summary.name}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify, chooseBoardPlaylist])

  /**
   * Choosing a playlist, which is not the same as playing it. A visitor who
   * has not connected Spotify can still say which playlist this panel is
   * about; playback is the step that needs their account, and it is offered
   * separately rather than smuggled into the click that chose the playlist.
   */
  const selectPlaylist = useCallback((summary: SpotifyPlaylistSummary, panelId?: string) => {
    chooseBoardPlaylist({ id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image }, panelId)
    // The newest choice is the one that counts. A song chosen earlier outranks
    // the panel's playlist wherever the panel decides what is chosen, so it has
    // to go, or the panel keeps describing — and, after connecting, plays — the
    // song instead of the playlist that was just picked.
    changeSelectedTrack(null)
    setStatus(`${summary.name} is ready.`)
    setError(null)
  }, [chooseBoardPlaylist])

  const selectTrack = useCallback((summary: SpotifyTrackSummary | null, panelId?: string) => {
    changeSelectedTrack(summary)
    if (summary) {
      chooseBoardTrack(summary, panelId)
      setError(null)
    }
  }, [chooseBoardTrack])

  const lookupTrack = useCallback(async (trackId: string) => {
    if (!tokens) return
    // What the held song was when this was asked. If it has been changed by
    // the time the answer arrives, the answer is stale and is dropped.
    const epoch = selectedTrackEpochRef.current
    const fresh = await ensureFreshTokens()
    const item = await requestSpotify(() => spotifyFetch<SpotifyTrackApiItem>(`/tracks/${encodeURIComponent(trackId)}`, fresh.accessToken))
    if (selectedTrackEpochRef.current !== epoch) return
    setSelectedTrack(mapTrack(item))
  }, [ensureFreshTokens, requestSpotify, tokens])

  const playPlaylist = useCallback(async (summary?: SpotifyPlaylistSummary, panelId?: string) => {
    const panelPlaylist = (panelId ? panels.get(panelId) : undefined)?.type === 'spotify' ? (panels.get(panelId!) as Panel<'spotify'>).config.playlist : undefined
    const selected = summary ? { id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image } : panelPlaylist ?? defaultSpotifyPlaylistReference
    if (!selected.uri) throw new Error('Choose a playlist first.')
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    const fresh = await ensureFreshTokens()
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ context_uri: selected.uri }) }))
    // Playback has been accepted, so whatever song was being held for Play is
    // superseded. The player only reports what is playing some boards later,
    // and until it does the held song would still outrank this in the panel.
    changeSelectedTrack(null)
    chooseBoardPlaylist(selected, panelId)
    setStatus(`Playing ${selected.name ?? 'playlist'}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify, panels, chooseBoardPlaylist])

  const playTrack = useCallback(async (summary: SpotifyTrackSummary, panelId?: string) => {
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    const fresh = await ensureFreshTokens()
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ uris: [summary.uri] }) }))
    // Playback has been accepted, and this is now the song Play is for. It has
    // to stay that way until the player reports what is playing, which it does
    // some boards later: cleared here, a second press of Play in that gap would
    // find nothing held and fall through to the board's saved playlist,
    // replacing the song that was just started. Held, a second press only asks
    // for the same song again. The panel lets it go when the player reports.
    changeSelectedTrack(summary)
    chooseBoardTrack(summary, panelId)
    setStatus(`Playing ${summary.name} by ${summary.artists}.`)
    setError(null)
  }, [chooseBoardTrack, deviceId, ensureFreshTokens, requestSpotify])

  const togglePlay = useCallback(async (panelId?: string) => {
    const panelConfig = (panelId ? panels.get(panelId) : undefined)?.type === 'spotify' ? (panels.get(panelId!) as Panel<'spotify'>).config : undefined
    // Nothing playing yet, a board that keeps a song starts that song.
    if (!track && panelConfig?.track) {
      await playTrack(panelConfig.track, panelId)
      return
    }
    const panelPlaylist = panelConfig?.playlist
    const selectedPlaylist = panelPlaylist ?? defaultSpotifyPlaylistReference
    const action = getSpotifyPlaybackAction(Boolean(track), selectedPlaylist.uri)
    if (action === 'load-saved-playlist') {
      await playPlaylist(undefined, panelId)
      return
    }
    if (action === 'missing-playlist') {
      throw new Error('Load or choose a playlist before starting playback.')
    }

    const player = playerRef.current
    if (!player) throw new Error('Spotify browser device is not ready yet.')
    await player.togglePlay()
  }, [playPlaylist, playTrack, panels, track])

  return {
    tokens, playlists, tracks, track, selectedTrack, deviceId, isReady, status, error, login, logout, clearSearchResults, handleCallback, signInFailed, sessionEnded, reportSignInFailure, searchPlaylists, searchTracks, loadPlaylistFromUrl,
    selectPlaylist, selectTrack, lookupTrack, playPlaylist, playTrack,
    playlistsHaveMore, loadMorePlaylists,
    togglePlay,
    previousTrack: async () => playerRef.current?.previousTrack(),
    nextTrack: async () => playerRef.current?.nextTrack(),
    setVolume: async (value) => playerRef.current?.setVolume(value),
    seek: async (positionMs) => playerRef.current?.seek(positionMs),
  }
}

function spotifyUrlFromUri(uri?: string) {
  const match = uri?.match(/^spotify:(track|episode):([A-Za-z0-9]+)$/)
  return match ? `https://open.spotify.com/${match[1]}/${match[2]}` : null
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

function loadSpotifySdk() {
  if (window.Spotify) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://sdk.scdn.co/spotify-player.js"]')
    if (existing) {
      window.onSpotifyWebPlaybackSDKReady = () => resolve()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    script.onerror = () => reject(new Error('Spotify Web Playback SDK could not be loaded.'))
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    document.body.appendChild(script)
  })
}

/** Only the song's own fields: a search result may carry more than the board needs to keep. */
function savedTrackFrom(summary: SpotifyTrackSummary): SpotifySavedTrack {
  const { id, uri, name, artists, album, url, image, durationMs } = summary
  return { id, uri, name, artists, album, url, image, durationMs }
}
