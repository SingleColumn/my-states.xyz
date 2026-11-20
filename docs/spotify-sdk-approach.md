# Spotify account approach (Web Playback SDK)

The Music panel used to let a visitor connect their own Spotify account and play
music inside my-states. It was removed in favour of Spotify's own embedded player
(see `docs/spotify-embed-public-plan.md`). This document keeps the code so the
approach can be brought back.

The full working version is also in git: commit `2fe724d` on the
`feature/spotify-embed-public` branch is the last one that still has it.

## Why it was removed

- Spotify's development mode lets only about 5 allowlisted accounts sign in.
  Anyone else is turned away.
- Extended quota (needed to open it to everyone) requires a registered company
  and about 250,000 monthly users, so it is out of reach for this app.
- Spotify's embedded player works for every visitor without an app login, so it
  replaced this approach. Visitors without a Spotify login hear 30-second
  previews; logged in to Spotify in the same browser, they hear whole songs.

## How it worked

1. **Sign in (PKCE).** "Connect Spotify account" (`connect()` in the panel)
   saved what the visitor was doing (`spotifyReturnContext.ts`), then
   `startSpotifyLogin()` sent them to `accounts.spotify.com/authorize` with a
   PKCE code challenge. No client secret is involved.
2. **Callback.** Spotify sent them back to `/callback?code=...&state=...`.
   `App.tsx` exchanged the code for tokens (`exchangeSpotifyCode`) and stored
   them in localStorage (`mic:spotify-tokens`). Tokens were refreshed a minute
   before expiry (`refreshSpotifyToken`).
3. **Player.** With a token, `useSpotifyState` loaded the Web Playback SDK
   (`https://sdk.scdn.co/spotify-player.js`), which made the browser tab a
   Spotify device. Playback was started with the Web API
   (`PUT /me/player` then `PUT /me/player/play?device_id=...`).
4. **Panel.** Connected, the panel drew its own controls: title, seek bar,
   previous/play/next, volume (and the keyboard volume keys), "Play from a
   Spotify link" and "Log out". Search used the visitor's own token instead
   of the app's catalog endpoint.
5. **Coming back.** The panel restored the search text and the chosen song or
   playlist after the redirect, and said "Spotify is connected. Press play..."
   because a browser will not start sound without a click.

## Requirements to bring it back

- `VITE_SPOTIFY_CLIENT_ID` (browser) set to the Spotify app's Client ID.
- `VITE_SPOTIFY_REDIRECT_URI` set to the exact callback address registered in
  the Spotify dashboard (Spotify refuses `localhost`; local copies use
  `http://127.0.0.1:5173/callback`). `src/localOrigin.ts` still moves a local
  visit from `localhost` to that address.
- Scopes: `streaming user-read-email user-read-private user-read-playback-state
  user-modify-playback-state playlist-read-private playlist-read-collaborative`.
- The visitor needs Spotify Premium for the Web Playback SDK.
- While in development mode, each visitor's account must be added to the
  allowlist in the Spotify dashboard.

## The code

Each file is as it was at commit `2fe724d`. Some files also contain code that
the embed approach still uses (search, suggestions, the embed itself).

### src/spotify.ts

Sign-in (PKCE), token refresh, and the Web API helper.

```ts
import type { SpotifyTokens } from './types'

// The catalog DTOs and their mappers live in a module that carries no browser
// globals, because the server functions under api/ parse the same JSON. They
// are re-exported here so every existing `from './spotify'` import still
// reads the way it did.
export {
  isSpotifyPlaylistApiItem,
  isSpotifyTrackApiItem,
  mapPlaylist,
  mapTrack,
} from '../api/_lib/spotifyCatalogTypes'
export type {
  SpotifyPlaylistApiItem,
  SpotifyPlaylistSearchResult,
  SpotifyPlaylistSummary,
  SpotifyTrackApiItem,
  SpotifyTrackSearchResult,
  SpotifyTrackSummary,
} from '../api/_lib/spotifyCatalogTypes'

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const PKCE_VERIFIER_KEY = 'mic:spotify-code-verifier'
const PKCE_STATE_KEY = 'mic:spotify-state'

export class SpotifyAuthenticationError extends Error {
  constructor(message = 'Spotify did not accept this session.') {
    super(message)
    this.name = 'SpotifyAuthenticationError'
  }
}

export const spotifyScopes = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
]

export type SpotifyPlaybackAction = 'toggle-current' | 'load-saved-playlist' | 'missing-playlist'

export function getSpotifyPlaybackAction(hasCurrentTrack: boolean, playlistUri: string | null): SpotifyPlaybackAction {
  if (hasCurrentTrack) return 'toggle-current'
  return playlistUri ? 'load-saved-playlist' : 'missing-playlist'
}

function getClientId() {
  return import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim() ?? ''
}

export function getRedirectUri() {
  const configured = import.meta.env.VITE_SPOTIFY_REDIRECT_URI?.trim()
  if (configured) return configured
  if (typeof window !== 'undefined') return `${window.location.origin}/callback`
  return 'http://127.0.0.1:5173/callback'
}

function base64UrlEncode(bytes: ArrayBuffer) {
  const byteArray = new Uint8Array(bytes)
  let binary = ''
  for (const byte of byteArray) binary += String.fromCharCode(byte)

  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomString(length: number) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const values = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(values, (value) => possible[value % possible.length]).join('')
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value)
  return crypto.subtle.digest('SHA-256', data)
}

export async function startSpotifyLogin() {
  const clientId = getClientId()
  if (!clientId) {
    throw new Error('Missing VITE_SPOTIFY_CLIENT_ID. Create a Spotify Developer app and add the Client ID to .env.')
  }

  const verifier = randomString(96)
  const challenge = base64UrlEncode(await sha256(verifier))
  const state = randomString(24)

  window.localStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  window.localStorage.setItem(PKCE_STATE_KEY, state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: spotifyScopes.join(' '),
    redirect_uri: getRedirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  })

  window.location.assign(`${SPOTIFY_AUTH_URL}?${params.toString()}`)
}

export async function exchangeSpotifyCode(code: string, state: string | null): Promise<SpotifyTokens> {
  const expectedState = window.localStorage.getItem(PKCE_STATE_KEY)
  const verifier = window.localStorage.getItem(PKCE_VERIFIER_KEY)
  const clientId = getClientId()

  if (!clientId) throw new Error('Missing VITE_SPOTIFY_CLIENT_ID.')
  if (!verifier) throw new Error('Missing Spotify PKCE verifier. Start login again.')
  if (!state || state !== expectedState) throw new Error('Spotify login state did not match. Start login again.')

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  })

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    const message = await readSpotifyErrorMessage(response)
    throw new Error(message
      ? `Spotify token exchange failed (${response.status}): ${message}`
      : `Spotify token exchange failed (${response.status}).`)
  }

  const json = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  window.localStorage.removeItem(PKCE_VERIFIER_KEY)
  window.localStorage.removeItem(PKCE_STATE_KEY)

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
}

export async function refreshSpotifyToken(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  if (!tokens.refreshToken) return tokens

  const clientId = getClientId()
  if (!clientId) throw new Error('Missing VITE_SPOTIFY_CLIENT_ID.')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  })

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed (${response.status}).`)
  }

  const json = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
}

export function parseSpotifyPlaylistUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const uriMatch = trimmed.match(/^spotify:playlist:([A-Za-z0-9]+)$/)
  if (uriMatch) return uriMatch[1]

  try {
    const url = new URL(trimmed)
    const parts = url.pathname.split('/').filter(Boolean)
    const playlistIndex = parts.indexOf('playlist')
    if (playlistIndex >= 0 && parts[playlistIndex + 1]) {
      return parts[playlistIndex + 1]
    }
  } catch {
    return null
  }

  return null
}

export async function spotifyFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const message = await readSpotifyErrorMessage(response)
    if (response.status === 401) throw new SpotifyAuthenticationError(message ?? undefined)
    throw new Error(message ? `Spotify request failed (${response.status}): ${message}` : `Spotify request failed (${response.status}).`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

async function readSpotifyErrorMessage(response: Response) {
  try {
    const json = (await response.clone().json()) as { error?: { message?: string } | string }
    if (typeof json.error === 'string') return json.error
    return json.error?.message ?? null
  } catch {
    try {
      const text = await response.text()
      return text.trim() || null
    } catch {
      return null
    }
  }
}
```

### src/spotifyState.ts

The hook behind the panel: tokens, the Web Playback SDK player, playback, and search with either the visitor's token or the app's catalog endpoint.

```ts
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
```

### src/spotifyReturnContext.ts

What the visitor was doing before leaving for Spotify, kept in sessionStorage so the panel can restore it on return.

```ts
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
 * sessionStorage, not a board and not localStorage: it is about one
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
   * The board the panel was in. The panel id alone is not enough to say whose
   * this is: the browser opens whichever board is active when the page comes
   * back, and another tab may have changed that while this one was at Spotify.
   * Null for a context written without one.
   */
  boardId: string | null
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
    const { panelId, boardId, choice, query, searchType } = parsed as Partial<Record<keyof SpotifyReturnContext, unknown>>
    if (typeof panelId !== 'string') return null

    return {
      panelId,
      boardId: typeof boardId === 'string' ? boardId : null,
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
```

### src/panels/SpotifyPanel.tsx

The Music panel with both modes: connected (own controls) and not connected (Spotify's embedded player).

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import {
  ChevronsDownUp,
  Disc3,
  ExternalLink,
  Link2,
  LogIn,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react'
import { useAppState } from '../AppState'
import { defaultSpotifyPlaylistReference } from '../storage'
import { debounce, formatDuration } from '../utils'
import type { DebouncedFunction } from '../utils'
import type { Panel } from '../types'
import type { SpotifyPlaylistSummary, SpotifyTrackSummary } from '../spotify'
import { fetchCuratedPlaylists } from '../spotifyCatalog'
import type { CuratedSpotifyPlaylist } from '../config/spotifyCuratedPlaylists'
import { getSessionSuggestions, shuffleSessionSuggestions } from '../spotifySuggestions'
import { forgetReturnContext, rememberReturnContext, takeReturnContext, type SpotifyReturnContext } from '../spotifyReturnContext'
import { PanelHeader, usePanelCommands } from '../PanelHeader'
import { useMomentView } from '../momentView'
import { usePanelSessionState } from '../panelSessionState'
import { musicPanelView, type MusicSearchState } from './musicPanelView'
import { panelContentProps } from '../panelSurface'
import { SpotifyEmbedStrip } from './SpotifyEmbedStrip'
import { isPreviewNoticeHidden, previewNoticeVisit, SpotifyPreviewNotice } from './SpotifyPreviewNotice'

type SpotifySearchType = 'tracks' | 'playlists'

// Long enough that a typed word is one request rather than five, short enough
// that results feel like they are keeping up with the typing.
const searchDebounceMs = 300

// A single letter matches most of Spotify, so it costs a request to tell
// someone nothing. Two is where an answer starts to mean something.
const minSearchLength = 2

export function SpotifyPanel({ panelId }: { panelId: string }) {
  const posthog = usePostHog()
  const { spotify, boards, panels } = useAppState()
  const commands = usePanelCommands()
  const found = panels.get(panelId)
  const panel = found?.type === 'spotify' ? (found as Panel<'spotify'>) : undefined
  const panelPlaylist = panel?.config.playlist ?? defaultSpotifyPlaylistReference
  // Focus view keeps what someone glances at while they write or look at
  // images: the playlist, the track, and the playback controls.
  const focusView = panel?.focusView === true
  const momentView = useMomentView()
  // Connecting Spotify is what playback needs. It is not what the panel
  // needs: searching and choosing happen either way, and this flag marks the
  // boundary between the two rather than the door into the panel.
  const connected = Boolean(spotify.tokens)
  // The choices below are kept per panel rather than in this copy of it, so
  // they survive a switch between the canvas and Editor mode (see
  // panelSessionState).
  const [query, setQuery] = usePanelSessionState(panelId, 'query', '')
  // A playlist is what this panel is for: it plays behind the images for as
  // long as someone is looking at them, where a single song stops after three
  // minutes. Songs stay available, but finding a playlist is the default step.
  const [searchType, setSearchType] = usePanelSessionState<SpotifySearchType>(panelId, 'search-type', 'playlists')
  const [playlistUrl, setPlaylistUrl] = usePanelSessionState(panelId, 'playlist-url', panelPlaylist.url ?? '')
  const [isLinkFieldOpen, setIsLinkFieldOpen] = usePanelSessionState(panelId, 'link-field-open', false)
  // Putting the search away is what brings the artwork out: the panel shows
  // one or the other, never both, and the choice is the person's to make.
  const [searchCollapsed, setSearchCollapsed] = usePanelSessionState(panelId, 'search-collapsed', false)
  const [volume, setVolume] = usePanelSessionState(panelId, 'volume', 70)
  const [busy, setBusy] = useState(false)
  // Distinct from `busy`, which any action sets: this one says a search is
  // owed an answer, so the list can wait instead of reporting no matches.
  const [searching, setSearching] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setLocalError(null)
    try {
      await action()
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Spotify action failed.')
    } finally {
      setBusy(false)
    }
  }

  const error = localError ?? spotify.error
  const runRef = useRef(run)
  runRef.current = run
  const spotifyRef = useRef(spotify)
  spotifyRef.current = spotify
  const posthogRef = useRef(posthog)
  posthogRef.current = posthog

  useEffect(() => {
    setPlaylistUrl(panelPlaylist.url ?? '')
  }, [boards.activeBoard?.id, panelPlaylist.url])

  // A keyboard's dedicated volume keys reach the page as keydown events
  // (code "AudioVolume*"), separate from the OS volume they also adjust.
  // Following them here keeps the on-screen slider, and Spotify's own
  // playback volume, in step with whichever one someone actually used.
  useEffect(() => {
    if (!spotify.tokens) return
    function handleVolumeKey(event: KeyboardEvent) {
      if (event.code !== 'AudioVolumeUp' && event.code !== 'AudioVolumeDown' && event.code !== 'AudioVolumeMute') return
      event.preventDefault()
      setVolume((current) => {
        const next = event.code === 'AudioVolumeMute'
          ? (current === 0 ? 70 : 0)
          : Math.max(0, Math.min(100, current + (event.code === 'AudioVolumeUp' ? 5 : -5)))
        void runRef.current(() => spotifyRef.current.setVolume(next / 100))
        return next
      })
    }
    window.addEventListener('keydown', handleVolumeKey)
    return () => window.removeEventListener('keydown', handleVolumeKey)
  }, [spotify.tokens])

  useEffect(() => {
    if (!spotify.tokens) setIsLinkFieldOpen(false)
  }, [spotify.tokens])

  // Searching while someone types removes the separate "now search" step that
  // a submit button asks for. The debounce keeps a typed word to one request;
  // the sequence guard inside the search calls drops any reply that a later
  // keystroke has already overtaken. None of this depends on being connected:
  // the same field, the same wait and the same guard serve both.
  const searchRef = useRef<DebouncedFunction<(text: string, type: SpotifySearchType) => void> | null>(null)
  useEffect(() => {
    const search = debounce((text: string, type: SpotifySearchType) => {
      void runRef.current(async () => {
        try {
          if (type === 'tracks') {
            await spotifyRef.current.searchTracks(text)
          } else {
            await spotifyRef.current.searchPlaylists(text)
          }
          // One event for a search, whoever asked and for whichever kind, so
          // the two paths cannot be counted twice or compared against
          // different definitions. The words typed are not sent.
          posthogRef.current?.capture('spotify_catalog_searched', {
            authenticated: Boolean(spotifyRef.current.tokens),
            search_type: type === 'tracks' ? 'track' : 'playlist',
          })
        } finally {
          setSearching(false)
        }
      })
    }, searchDebounceMs)
    searchRef.current = search
    return () => {
      search.cancel()
      searchRef.current = null
    }
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < minSearchLength) {
      // Clearing the box clears the results with it, rather than leaving the
      // answer to a question that is no longer on screen.
      searchRef.current?.cancel()
      setSearching(false)
      spotifyRef.current.clearSearchResults()
      return
    }
    setSearching(true)
    searchRef.current?.(trimmed, searchType)
  }, [query, searchType, spotify.tokens])

  // The suggestions this page session offers. Chosen once, in a module that
  // holds the choice, so that a rerender, a resize, a change of board or
  // tldraw redrawing the canvas all leave the same six cards in place.
  const [suggestions, setSuggestions] = useState<CuratedSpotifyPlaylist[]>(getSessionSuggestions)
  const [suggestionSummaries, setSuggestionSummaries] = useState<SpotifyPlaylistSummary[]>([])

  useEffect(() => {
    if (suggestions.length === 0) {
      setSuggestionSummaries([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const found = await fetchCuratedPlaylists(suggestions.map((entry) => entry.id))
        if (!cancelled) setSuggestionSummaries(found)
      } catch {
        // Discovery being unavailable costs the suggestions and nothing else,
        // and says nothing about it: the panel simply has none to offer. The
        // search field and Connect Spotify both stay where they were.
        if (!cancelled) setSuggestionSummaries([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [suggestions])

  // Kept in the curated order rather than the order Spotify answered in, and
  // skipping any id Spotify would not describe — a playlist that has been
  // deleted or made private costs a card, not the whole row of them.
  const suggestionCards = useMemo(() => {
    const bySpotifyId = new Map(suggestionSummaries.map((summary) => [summary.id, summary]))
    return suggestions
      .map((entry) => bySpotifyId.get(entry.id) ?? fallbackSuggestion(entry))
      .filter((summary): summary is SpotifyPlaylistSummary => summary !== null)
  }, [suggestions, suggestionSummaries])

  // Someone who left to connect Spotify is put back where they were, rather
  // than facing an empty box and no sign of what they had chosen. The words
  // they had typed come back and the search runs again, so the results — with
  // their playlist marked among them — are on screen when they arrive. A
  // playlist needs nothing else: the panel's reference is part of the board
  // and outlived the redirect. A song is only ever a runtime choice, so it is
  // looked up again by its id.
  //
  // Nothing plays on arrival — a browser will not start sound without a click,
  // and a page that began playing by itself would be its own surprise — so the
  // panel says so instead, and the player's own Play button is the one to press.
  const [cameBackToPlay, setCameBackToPlay] = useState(false)

  // Spotify's own player, for a visitor who has not connected Spotify.
  const [embedFailed, setEmbedFailed] = useState(false)
  // Spotify's player can send the visitor to Spotify's site to log in, and
  // this page is told nothing about it: the click happens inside Spotify's
  // iframe. What it can see is the visitor using the player, this tab being
  // left, and the tab coming back with nothing playing. That is when it
  // welcomes them back, and rebuilds the player so a login made meanwhile has
  // a chance to count.
  const [backFromSpotify, setBackFromSpotify] = useState(false)
  const [embedGeneration, setEmbedGeneration] = useState(0)
  // What to expect from Spotify's player, said in a card the first time this
  // visit that someone chooses music, unless they asked not to see it. The
  // footer reopens it.
  const [noticeOpen, setNoticeOpen] = useState(false)
  const usedEmbedRef = useRef(false)
  const leftAfterUsingEmbedRef = useRef(false)
  const embedPlayingRef = useRef(false)
  // A song chosen before connecting is looked up again on the way back, and
  // until that answers there is nothing to play it with. Without this the
  // panel falls back to the board's saved playlist in the meantime — names it,
  // and starts it on Play — when the visitor asked for a song.
  const [restoringSong, setRestoringSong] = useState(false)

  // The music saved in the board is part of the board, and is shown to
  // whoever opens it, connected or not: someone who imports or is sent a board
  // has chosen its music along with it, and an empty panel reads as music
  // lost. Not connected, it is shown with the one step left to play it.
  const shownPlaylist = panelPlaylist
  const panelTrack = panel?.config.track ?? null
  const shownSong = spotify.selectedTrack ?? panelTrack

  // A different board has a different saved playlist, and nothing chosen in
  // the last one carries over to it.
  //
  // Only a change counts. React's development mode runs every effect twice when
  // a component mounts, and this one runs before the effects that give back
  // what the visitor was doing on the way back from Spotify: run again, it wiped
  // what they had just restored, and the context they read it from was already
  // used up. So it remembers which board it last saw and does nothing when the
  // board is the same.
  const lastBoardIdRef = useRef(boards.activeBoard?.id)
  useEffect(() => {
    if (lastBoardIdRef.current === boards.activeBoard?.id) return
    lastBoardIdRef.current = boards.activeBoard?.id
    setRestoringSong(false)
    // "Welcome back" is about the music of the board it was said in.
    setBackFromSpotify(false)
    usedEmbedRef.current = false
    leftAfterUsingEmbedRef.current = false
    // The "press play to start…" prompt is about what was chosen before leaving
    // for Spotify, in the board it was chosen in. Left standing, another board
    // would show it beside its own saved playlist: music nobody picked there.
    setCameBackToPlay(false)
  }, [boards.activeBoard?.id])

  // Whose is a context? It was read from this tab's own storage, but the page
  // that came back opens whichever board is active in storage shared by every
  // tab, and another tab may have opened a different one while this tab was at
  // Spotify. A context for another panel or board is not this panel's to
  // restore — its query and song would land in the wrong board. Whatever reads
  // one has already taken it, so one that is not ours is simply dropped.
  const isOurContext = (context: SpotifyReturnContext) =>
    context.panelId === panelId && (context.boardId === null || context.boardId === boards.activeBoard?.id)

  useEffect(() => {
    if (!connected) return
    const context = takeReturnContext()
    if (!context) return
    if (!isOurContext(context)) return
    setSearchType(context.searchType)
    setQuery(context.query)
    if (!context.choice) return
    setCameBackToPlay(true)
    const { choice } = context
    if (choice.kind === 'track') {
      setRestoringSong(true)
      void runRef.current(() => spotifyRef.current.lookupTrack(choice.spotifyId)).finally(() => setRestoringSong(false))
    }
  }, [connected])

  // A sign-in that comes back without succeeding — cancelled at Spotify,
  // refused, or a code that could not be exchanged — leaves the visitor here,
  // not connected, on a page that has reloaded: the search, its results and
  // what they had chosen are gone. Some of that can be given back, and is.
  //
  // The search text and type can. What they had chosen needs nothing: a
  // playlist or song is saved in the board as soon as it is clicked, and the
  // board's music is always shown.
  //
  // This waits to be told the sign-in failed rather than restoring whenever the
  // panel opens signed out, because a sign-in that is about to succeed also
  // opens signed out for a board, and must find its context still there.
  useEffect(() => {
    if (!spotify.signInFailed || connected) return
    const context = takeReturnContext()
    if (!context) return
    if (!isOurContext(context)) return
    setSearchType(context.searchType)
    setQuery(context.query)
  }, [spotify.signInFailed])

  // Once something is playing, or the session ends, the prompt has done its job
  // — and so has a song that was only being held until Play was pressed.
  useEffect(() => {
    if (spotify.track || !connected) setCameBackToPlay(false)
    if (spotify.track && spotify.selectedTrack) spotifyRef.current.selectTrack(null)
  }, [spotify.track, spotify.selectedTrack, connected])

  // Leaving the tab after using Spotify's player, then coming back to it.
  // Coming back to music that is still playing says nothing and touches
  // nothing: the visitor only looked at another tab, and rebuilding the player
  // would cut the music off.
  useEffect(() => {
    if (connected) return
    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        if (usedEmbedRef.current) leftAfterUsingEmbedRef.current = true
        return
      }
      if (!leftAfterUsingEmbedRef.current) return
      leftAfterUsingEmbedRef.current = false
      if (embedPlayingRef.current) return
      usedEmbedRef.current = false
      setBackFromSpotify(true)
      setEmbedGeneration((generation) => generation + 1)
      posthogRef.current?.capture('spotify_embed_returned')
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [connected])

  // The menu entry that opens the link field is absent in the focus view and
  // when not connected, so the popover it opens goes with it rather than
  // outliving the only way back to it.
  const linkFieldOpen = isLinkFieldOpen && connected && !focusView
  const results = searchType === 'tracks' ? spotify.tracks : spotify.playlists
  const searchState: MusicSearchState = query.trim().length < minSearchLength
    ? 'waiting'
    : searching
      ? 'searching'
      : results.length === 0
        ? 'no-matches'
        : 'results'

  // What the panel shows -- what fills the middle, which one part names the
  // music, the one line about what to do next -- is decided in one place,
  // from these inputs, and only drawn here. See musicPanelView.ts.
  const view = musicPanelView({
    connected,
    focusView,
    momentView,
    searchCollapsed,
    searchState,
    suggestionCount: suggestionCards.length,
    playing: spotify.track,
    heldTrack: spotify.selectedTrack,
    boardTrack: panelTrack,
    boardPlaylist: panelPlaylist,
    cameBackToPlay,
    restoringSong,
    playerReady: spotify.isReady,
    sessionEnded: spotify.sessionEnded,
    embedFailed,
    backFromSpotify,
  })
  // What Spotify's player is given: the song if the board keeps one, else the
  // playlist. Both are public Spotify URIs.
  const embedEntity = shownSong?.uri ?? shownPlaylist.uri ?? null
  const searchHidden = !view.showSearch
  const chosen = view.chosen

  // The list is given whatever height the column has left over, which lands
  // mid-row as often as not and leaves a sliced playlist along the bottom
  // edge. Row height is fluid — the artwork and padding both scale with the
  // panel — so the whole number of rows that fits can only be measured, not
  // written down. Round the list down to that many. The suggestions are laid
  // out separately and deliberately stay outside this: they are a grid of
  // whole cards that is either there or not.
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const list = listRef.current
    const column = list?.parentElement
    if (!list || !column) return

    function snapToWholeRows() {
      const list = listRef.current
      const column = list?.parentElement
      if (!list || !column) return
      const row = list.querySelector<HTMLElement>('.playlist-option')
      if (!row) {
        list.style.minHeight = ''
        list.style.maxHeight = ''
        return
      }
      // offsetHeight throughout, never getBoundingClientRect: a panel is drawn
      // inside tldraw's canvas, which scales it with a CSS transform. A rect
      // comes back in screen pixels and clientHeight in the panel's own, so
      // mixing them measures the list in one unit and the room for it in
      // another — true at zoom 1, and wrong by the zoom factor everywhere
      // else. Full screen is where the two are furthest apart.
      // Measure against the stylesheet's own top margin, never the one a
      // previous pass wrote below, or each pass would count its own slack
      // again and walk the list up the panel.
      list.style.marginTop = ''
      const listStyle = getComputedStyle(list)
      const gap = Number.parseFloat(listStyle.rowGap) || 0
      const baseMarginTop = Number.parseFloat(listStyle.marginTop) || 0
      const pitch = row.offsetHeight + gap
      if (pitch <= 0) return
      // The room the column has for the list, worked out from everything that
      // is not the list. Deriving it from the list's own height instead would
      // feed each rounding back into the next one, and the list would creep
      // shorter on every pass.
      const columnStyle = getComputedStyle(column)
      let available = column.clientHeight
        - Number.parseFloat(columnStyle.paddingTop)
        - Number.parseFloat(columnStyle.paddingBottom)
        - Number.parseFloat(listStyle.marginTop)
        - Number.parseFloat(listStyle.marginBottom)
      for (const sibling of column.children) {
        if (sibling === list) continue
        const siblingStyle = getComputedStyle(sibling)
        available -= (sibling as HTMLElement).offsetHeight
          + Number.parseFloat(siblingStyle.marginTop)
          + Number.parseFloat(siblingStyle.marginBottom)
      }
      // Not even one row fits. Asking for one anyway would push the playback
      // controls out of the bottom of a column that does not scroll, and the
      // controls matter more than a whole row does.
      if (available < pitch - gap) {
        // 0, not "": clearing it hands the height back to the stylesheet's
        // floor, which is the very thing squeezing the controls out here.
        list.style.minHeight = '0px'
        list.style.maxHeight = `${Math.max(0, available)}px`
        return
      }
      const whole = Math.max(1, Math.floor((available + gap) / pitch))
      const height = (whole * pitch) - gap
      // Both ends, because the stylesheet's floor is a round pixel count and
      // would put a sliced row back at the bottom of a short panel.
      list.style.minHeight = `${height}px`
      list.style.maxHeight = `${height}px`
      // Rounding down leaves up to a row over. Left alone it settles under the
      // playback controls, which then float by however much the rounding
      // happened to leave — and shift again when the search is put away. Sent
      // above the list it costs nothing: the controls keep the bottom edge and
      // the row that names the playlist stays put. It cannot be an `auto`
      // margin, which would take the free space the list itself grows into and
      // leave the results with none.
      list.style.marginTop = `${baseMarginTop + (available - height)}px`
    }

    snapToWholeRows()
    const observer = new ResizeObserver(snapToWholeRows)
    observer.observe(column)
    observer.observe(list)
    return () => observer.disconnect()
  }, [searchHidden, searchType, results.length, view.middle, view.nextStep])

  function resetFields() {
    setQuery('')
    setPlaylistUrl('')
    setLocalError(null)
    searchRef.current?.cancel()
    spotify.clearSearchResults()
    spotify.selectTrack(null)
  }

  // A new board starts this panel short. Using it makes room: typing, a
  // search or choice restored after coming back from Spotify, or being
  // connected already all mean the panel is in use.
  const inUse = query.trim() !== '' || chosen !== null || connected
  const { expandPanelFromStartingHeight } = commands
  useEffect(() => {
    if (inUse) expandPanelFromStartingHeight(panelId)
  }, [inUse, expandPanelFromStartingHeight, panelId])

  /**
   * Connecting a Spotify account to my-states. While the app is in Spotify's
   * development mode only allowlisted accounts can use this, so it is no longer
   * offered to visitors in the body of the panel: it waits in the panel menu,
   * for the owner. Everyone else plays through Spotify's own player.
   */
  function connect() {
    // Grow now: the page is about to be left, and the panel should look the
    // same on return as the person left it.
    commands.expandPanelFromStartingHeight(panelId)
    posthog.capture('spotify_connect_clicked', { has_selection: chosen !== null })
    if (chosen || query.trim()) {
      // The crumbs that lead back to where they were: the search, and what they
      // had chosen. No token — only the words, a panel id and a public Spotify
      // id — and none of it is sent anywhere.
      rememberReturnContext({
        panelId,
        boardId: boards.activeBoard?.id ?? null,
        choice: chosen ? { kind: chosen.kind, spotifyId: chosen.id } : null,
        query,
        searchType,
      })
    } else {
      // Nothing to come back to, so nothing may be left over from an earlier
      // attempt: a sign-in that was cancelled or failed never read its context,
      // and it would be restored after this one, complete with a song the
      // visitor has since cleared.
      forgetReturnContext()
    }
    void run(spotify.login)
  }

  function explainPreviewsOnce() {
    if (previewNoticeVisit.shown || isPreviewNoticeHidden()) return
    previewNoticeVisit.shown = true
    setNoticeOpen(true)
  }

  /**
   * A click on a playlist, wherever it is offered. This is the one place the
   * two kinds of visitor differ: someone connected asked for music and gets it,
   * exactly as before; someone who has not connected has it chosen, and
   * Spotify's own player below loads it, waiting for them to press play.
   */
  function choosePlaylist(playlist: SpotifyPlaylistSummary, source: 'search' | 'curated') {
    if (source === 'curated') posthog.capture('spotify_curated_playlist_selected', { authenticated: connected })
    if (!connected) {
      spotify.selectPlaylist(playlist, panelId)
      explainPreviewsOnce()
      return
    }
    void run(async () => {
      await spotify.playPlaylist(playlist, panelId)
      posthog.capture('spotify_playlist_played', { source, authenticated: true })
    })
  }

  function chooseTrack(track: SpotifyTrackSummary) {
    if (!connected) {
      spotify.selectTrack(track, panelId)
      explainPreviewsOnce()
      return
    }
    void run(() => spotify.playTrack(track, panelId))
  }

  // The one action that goes with the line about Spotify's player, when there
  // is one: reload after a login elsewhere, or listen on Spotify itself when
  // its player cannot load here.
  const embedHelp = view.offerReload ? (
    <button className="card-icon-button is-wide spotify-embed-action" type="button" onClick={() => window.location.reload()}>
      <RotateCcw size={16} aria-hidden="true" />
      Reload page
    </button>
  ) : !connected && embedFailed && chosen?.url ? (
    <a className="card-icon-button is-wide spotify-embed-action" href={chosen.url} target="_blank" rel="noreferrer">
      <ExternalLink size={16} aria-hidden="true" />
      Open in Spotify
    </a>
  ) : null

  return (
    <section className={`panel panel-spotify-surface${focusView && !momentView ? ' is-focus-view' : ''}${searchHidden ? ' is-search-hidden' : ''}${momentView && !view.music ? ' is-moment-empty' : ''}`}>
      <PanelHeader
        panelId={panelId}
        panelType="spotify"
        title="Music"
        // SPIKE: grouped like the Writing menu -- finding music, how the panel
        // looks, the panel itself (focus view joins it, beside the other
        // sizes), and the Spotify account last.
        menuSections={[{ heading: 'Find music', items: [
          // What the search looks for is a setting, not something to decide on
          // every visit, so it lives here and the field gets the whole row. The
          // field's own placeholder says which is on.
          ...(!searchHidden ? [{
            id: 'search-type',
            kind: 'choices' as const,
            label: 'Search for',
            icon: <Search size={17} aria-hidden="true" />,
            // The field below says what it now searches, so there is nothing
            // to compare with the menu open.
            closeOnSelect: true,
            options: [
              { id: 'playlists', label: 'Search for playlists', content: 'Playlists', checked: searchType === 'playlists', onSelect: () => setSearchType('playlists') },
              { id: 'songs', label: 'Search for songs', content: 'Songs', checked: searchType === 'tracks', onSelect: () => setSearchType('tracks') },
            ],
          }] : []),
          // Pasting a link is how someone plays a playlist they already have
          // in hand, which is a rarer thing to arrive wanting than searching
          // for one. It waits here so the body holds a single way in.
          ...(connected && !focusView ? [{
            id: 'playlist-link',
            label: 'Play from a Spotify link',
            icon: <Link2 size={17} aria-hidden="true" />,
            checked: linkFieldOpen,
            onSelect: () => setIsLinkFieldOpen((current) => !current),
          }] : []),
        ] }, { heading: 'View', items: [
          // One name whether on or off, with a tick for on, so it is in the
          // same place under the same words every time it is looked for.
          ...(view.canPutSearchAway && !focusView ? [{
            id: 'search-visibility',
            label: 'Show the search',
            icon: <Disc3 size={17} aria-hidden="true" />,
            checked: !searchCollapsed,
            onSelect: () => setSearchCollapsed((current) => !current),
          }] : []),
          {
            id: 'focus-view',
            label: 'Focus view',
            icon: <ChevronsDownUp size={17} aria-hidden="true" />,
            checked: focusView,
            onSelect: () => commands.togglePanelFocusView(panelId),
          },
        ] }]}
        trailingMenuHeading="Spotify"
        trailingMenuItems={connected ? [
          { id: 'log-out', label: 'Log out', icon: <LogOut size={17} aria-hidden="true" />, onSelect: () => spotify.logout() },
        ] : [
          { id: 'connect', label: 'Connect Spotify account', icon: <LogIn size={17} aria-hidden="true" />, onSelect: connect },
        ]}
      >
        {linkFieldOpen ? (
          <section className="spotify-link-popover" id="spotify-link-field" aria-label="Play from a Spotify link" {...panelContentProps}>
            <span className="spotify-link-heading">Play from a Spotify link</span>
            <form
              className="input-row"
              onSubmit={(event) => {
                event.preventDefault()
                void run(async () => {
                  await spotify.loadPlaylistFromUrl(playlistUrl, panelId)
                  posthog.capture('spotify_playlist_played', { source: 'link', authenticated: true })
                  setIsLinkFieldOpen(false)
                })
              }}
            >
              <input aria-label="Spotify playlist URL" value={playlistUrl} onChange={(event) => setPlaylistUrl(event.target.value)} placeholder="Spotify playlist URL" />
              <button className="card-icon-button" type="submit" title="Load Spotify playlist URL" aria-label="Load Spotify playlist URL" disabled={busy}>
                <ExternalLink size={18} aria-hidden="true" />
              </button>
            </form>
          </section>
        ) : null}
      </PanelHeader>

      <div className="panel-body" {...panelContentProps}>
        {view.showSearch ? (
          <>
            {/* Results follow the typing, so the only thing left for Enter
                to do is skip the wait — there is no button to press. */}
            <form
              className="input-row spotify-search-row"
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                searchRef.current?.flush()
              }}
            >
              <input
                aria-label={searchType === 'tracks' ? 'Search songs' : 'Search playlists'}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchType === 'tracks' ? 'Search songs' : 'Search playlists'}
              />
            </form>

            {/* These two tidy up after a search, and the way back to the
                artwork and the player sits beside them. With nothing chosen
                and no account there is nothing to go back to, so Reset
                stands alone. */}
            <div className={`spotify-search-actions${view.canPutSearchAway ? '' : ' is-single'}`}>
              <button className="card-icon-button is-wide spotify-reset-button" type="button" onClick={resetFields}>
                <RotateCcw size={18} />
                Reset fields
              </button>
              {view.canPutSearchAway ? (
                <button className="card-icon-button is-wide" type="button" onClick={() => setSearchCollapsed(true)}>
                  <ChevronsDownUp size={18} />
                  Hide search
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {/* Each of these has a key because they share one spot in the panel,
            and most are a plain div. Without keys React would reuse one
            element for all of them, and the height snapToWholeRows writes
            on the list would stay behind on whatever replaced it. The two
            lists share a key: that effect runs again when they swap. */}
        {view.middle === 'cover' ? (
          /* The music shown the way an album is: its cover large, the
             words under it, the next step set apart below them. The same
             with the search open or put away, connected or not. */
          <div key="cover" className="spotify-chosen is-featured" role={view.nextStep ? 'status' : undefined}>
            <div className="spotify-featured-cover">
              {view.music?.image ? <img src={view.music.image} alt="" /> : <div className="album-frame-empty" />}
            </div>
            {view.namer === 'cover' && view.music ? (
              <div className="track-copy">
                <div className="track-title-row">
                  <p className="track-title">{view.music.title}</p>
                  {spotify.track?.url ? (
                    <a
                      className="current-playback-link"
                      href={spotify.track.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open current item in Spotify"
                      title="Open current item in Spotify"
                    >
                      <ExternalLink aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
                <p className="track-meta">{view.music.meta}</p>
              </div>
            ) : null}
            {view.nextStep ? <p className="spotify-chosen-note">{view.nextStep}</p> : null}
            {embedHelp}
          </div>
        ) : view.middle === 'suggestions' ? (
          <section className="spotify-suggestions" aria-label="Suggested playlists">
            <h3 className="spotify-suggestions-heading">Suggested for this session</h3>
            <div className="spotify-suggestion-grid">
              {suggestionCards.map((suggestion) => {
                const isChosen = suggestion.id === shownPlaylist.id
                return (
                  <button
                    className={isChosen ? 'suggestion-card is-current' : 'suggestion-card'}
                    type="button"
                    key={suggestion.id}
                    aria-pressed={isChosen}
                    disabled={busy}
                    onClick={() => choosePlaylist(suggestion, 'curated')}
                  >
                    {suggestion.image ? <img src={suggestion.image} alt="" /> : <div className="suggestion-card-art" />}
                    <strong>{suggestion.name}</strong>
                  </button>
                )
              })}
            </div>
            {/* Secondary on purpose: searching and connecting are what
                this panel is for, and this only redeals the cards. */}
            <button
              className="spotify-suggestions-shuffle"
              type="button"
              onClick={() => {
                setSuggestions(shuffleSessionSuggestions())
                posthog.capture('spotify_suggestions_shuffled')
              }}
            >
              <Shuffle size={15} aria-hidden="true" />
              Shuffle suggestions
            </button>
          </section>
        ) : view.middle === 'results' && searchType === 'tracks' ? (
          <div key="results" ref={listRef} className="playlist-list" aria-label="Track search results">
            {spotify.tracks.map((track) => {
              // Playback reports a track by its Spotify page, not its
              // id, so that is what the playing row is recognised by.
              const isPlaying = Boolean(spotify.track?.url && spotify.track.url === track.url)
              const isChosen = isPlaying || spotify.selectedTrack?.id === track.id
              return (
                <button
                  className={isChosen ? 'playlist-option is-current' : 'playlist-option'}
                  type="button"
                  key={track.id}
                  aria-pressed={isChosen}
                  disabled={busy}
                  onClick={() => chooseTrack(track)}
                >
                  {track.image ? <img src={track.image} alt="" /> : <div />}
                  <span>
                    <strong>{track.name}</strong>
                    <small>{track.artists} - {track.album}</small>
                  </span>
                </button>
              )
            })}
            {searchState === 'searching' ? <p className="playlist-list-note">Looking for songs…</p> : null}
            {searchState === 'no-matches' ? <p className="playlist-list-note">No songs match that search.</p> : null}
          </div>
        ) : view.middle === 'results' ? (
          <div key="results" ref={listRef} className="playlist-list" aria-label="Playlist search results">
            {spotify.playlists.map((playlist) => {
              const isChosen = playlist.id === shownPlaylist.id
              return (
                <button
                  className={isChosen ? 'playlist-option is-current' : 'playlist-option'}
                  type="button"
                  key={playlist.id}
                  aria-pressed={isChosen}
                  disabled={busy}
                  // Connected, this plays. Not connected, it chooses
                  // the playlist and never sends anyone to a login
                  // screen: see choosePlaylist.
                  onClick={() => choosePlaylist(playlist, 'search')}
                >
                  {playlist.image ? <img src={playlist.image} alt="" /> : <div />}
                  <span>
                    <strong>{playlist.name}</strong>
                    <small>
                      {playlist.owner} - {playlist.trackCount} tracks
                    </small>
                  </span>
                </button>
              )
            })}
            {searchState === 'results' && spotify.playlistsHaveMore ? (
              <button className="card-icon-button is-wide playlist-list-more" type="button" disabled={busy} onClick={() => void run(spotify.loadMorePlaylists)}>
                Show more playlists
              </button>
            ) : null}
            {searchState === 'searching' ? <p className="playlist-list-note">Looking for playlists…</p> : null}
            {searchState === 'no-matches' ? <p className="playlist-list-note">No playlists match that search.</p> : null}
          </div>
        ) : view.middle === 'empty' ? (
          /* Nothing chosen and nothing to suggest: one line on how to
             start, rather than a blank panel that reads as broken. */
          <div key="empty" className="spotify-empty">
            <p className="muted">{`Search for a ${searchType === 'tracks' ? 'song' : 'playlist'} to play with this board.`}</p>
          </div>
        ) : null}

        {searchCollapsed && view.canPutSearchAway && !focusView && !momentView ? (
          /* Quiet on purpose: with the search put away the artwork leads,
             and this is only the way back to choosing something else. It
             says music, not playlist, because a song may be what is loaded. */
          <button className="spotify-show-search" type="button" onClick={() => setSearchCollapsed(false)}>
            <Search size={16} aria-hidden="true" />
            Find music
          </button>
        ) : null}

        {/* Away from the cover -- while searching -- the next step sits
            under the results, with the music in a small row above it when
            nothing else names it (not connected: there is no player). */}
        {/* In the focus view the body is Spotify's player alone: drawn at
            screen size, it needs all the room a zoomed-out panel has, so
            the one line about it goes in the footer instead. */}
        {view.middle !== 'cover' && !focusView && (view.namer === 'row' || view.nextStep) ? (
          <div className="spotify-chosen" role={view.nextStep ? 'status' : undefined}>
            {view.namer === 'row' && view.music ? (
              <div className="spotify-chosen-item">
                {view.music.image ? <img src={view.music.image} alt="" /> : <div />}
                <div className="track-copy">
                  <p className="track-title">{view.music.title}</p>
                  <p className="track-meta">{view.music.meta}</p>
                </div>
              </div>
            ) : null}
            {view.nextStep ? <p className="spotify-chosen-note">{view.nextStep}</p> : null}
            {embedHelp}
          </div>
        ) : null}

        {view.embed && embedEntity ? (
          <SpotifyEmbedStrip
            // A new key is a new player: how the panel picks up a Spotify
            // login made in another tab while the visitor was away.
            key={embedGeneration}
            entity={embedEntity}
            height={view.embed.height}
            hidden={view.embed.hidden}
            onStatus={(status) => {
              if (status === 'failed') setEmbedFailed(true)
            }}
            onInteract={() => {
              usedEmbedRef.current = true
              setBackFromSpotify(false)
            }}
            onPlayingChange={(playing) => {
              embedPlayingRef.current = playing
              if (playing) setBackFromSpotify(false)
            }}
          />
        ) : null}

        {view.showPlayer ? (
          <>
            {view.namer === 'player' && view.music ? (
              <div className="track-copy">
                <div className="track-title-row">
                  <p className="track-title">{view.music.title}</p>
                  {spotify.track?.url && !focusView ? (
                    <a
                      className="current-playback-link"
                      href={spotify.track.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open current item in Spotify"
                      title="Open current item in Spotify"
                    >
                      <ExternalLink aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
                <p className="track-meta">{view.music.meta}</p>
              </div>
            ) : null}

            <div className="progress-row">
              <span>{formatDuration(spotify.track?.positionMs ?? 0)}</span>
              <input
                aria-label="Seek"
                type="range"
                min={0}
                max={spotify.track?.durationMs ?? 1}
                value={spotify.track?.positionMs ?? 0}
                onChange={(event) => void run(() => spotify.seek(Number(event.target.value)))}
              />
              <span>{formatDuration(spotify.track?.durationMs ?? 0)}</span>
            </div>

            <div className="transport-row">
              <button className="card-icon-button" type="button" title="Previous track" onClick={() => void run(spotify.previousTrack)}>
                <SkipBack size={18} />
              </button>
              <button
                className="card-icon-button is-primary is-large"
                type="button"
                title="Play or pause"
                disabled={restoringSong}
                onClick={() => void run(async () => {
                  const wasPlaying = Boolean(spotify.track)
                  // A song picked before connecting is what Play is for
                  // until something is playing; otherwise it is the panel's
                  // playlist, or a pause.
                  if (!wasPlaying && spotify.selectedTrack) {
                    await spotify.playTrack(spotify.selectedTrack, panelId)
                    return
                  }
                  await spotify.togglePlay(panelId)
                  // The first press on a panel with nothing playing is
                  // what starts the chosen playlist; a pause is not a play.
                  if (!wasPlaying) posthog.capture('spotify_playlist_played', { source: 'search', authenticated: true })
                })}
              >
                {spotify.track?.paused === false ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button className="card-icon-button" type="button" title="Next track" onClick={() => void run(spotify.nextTrack)}>
                <SkipForward size={18} />
              </button>
              <label className="volume-control">
                <Volume2 size={16} />
                <input
                  aria-label="Volume"
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setVolume(next)
                    void run(() => spotify.setVolume(next / 100))
                  }}
                />
              </label>
            </div>
          </>
        ) : null}
      </div>

      <footer className="card-footer" {...panelContentProps}>
        <span className="card-footer-meta" role={focusView && view.nextStep ? 'status' : undefined}>
          {focusView ? view.nextStep ?? loadedMusicLabel(shownSong, shownPlaylist.name) : shownSong?.name ?? shownPlaylist.name ?? 'No playlist loaded'}
        </span>
        <div className="card-footer-status">
          {focusView ? embedHelp : null}
          {/* In the focus view the text above is one left-aligned column, so
              the link to Spotify waits here rather than beside the title. */}
          {focusView && spotify.track?.url ? (
            <a
              className="current-playback-link"
              href={spotify.track.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Open current item in Spotify"
              title="Open current item in Spotify"
            >
              <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
          {/* The panel is titled "Music", so the service is credited here instead —
              and it stays visible once connected, where the body no longer names it. */}
          <span className="card-footer-service">Spotify</span>
          {error ? (
            <span className="error-text">{error}</span>
          ) : focusView && view.nextStep ? null : (
            !connected ? (
              <button className="spotify-footer-link" type="button" onClick={() => setNoticeOpen(true)} title="What to expect from Spotify's player">
                Previews without a login
              </button>
            ) : (
              <span>{spotify.isReady ? 'Ready' : spotify.status}</span>
            )
          )}
        </div>
      </footer>
      {noticeOpen && !connected ? <SpotifyPreviewNotice onClose={() => setNoticeOpen(false)} /> : null}
    </section>
  )
}

/**
 * The footer's line in the focus view, where it is the only place the loaded
 * music is named, so it says which kind it is.
 */
function loadedMusicLabel(song: { name: string } | null, playlistName: string | null) {
  if (song) return `Song: ${song.name}`
  if (playlistName) return `Playlist: ${playlistName}`
  return 'No playlist loaded'
}

/**
 * A curated entry Spotify would not describe. It is shown only when the file
 * gave it a name to fall back on; without one there is nothing to put on a
 * card, and the entry is skipped.
 */
function fallbackSuggestion(entry: CuratedSpotifyPlaylist): SpotifyPlaylistSummary | null {
  if (!entry.name) return null
  return {
    id: entry.id,
    name: entry.name,
    uri: `spotify:playlist:${entry.id}`,
    url: `https://open.spotify.com/playlist/${entry.id}`,
    image: null,
    owner: 'Spotify',
    trackCount: 0,
  }
}
```

### src/panels/musicPanelView.ts

What the panel shows, in every state, including the connected ones.

```ts
/**
 * What the Music panel shows, decided in one place.
 *
 * The panel used to decide each of its parts on its own -- the cover, the
 * line naming the song, the note saying what to do next -- and every view
 * added later found a state in which two parts said the same thing, or none
 * said anything. Here the whole view is worked out from the panel's inputs
 * at once, and the component only draws what this returns. A new view is a
 * change to this function, where every other state is in sight, and its
 * tests walk through each state the panel can be in.
 */

export type MusicSearchState = 'waiting' | 'searching' | 'no-matches' | 'results'

/** A song or playlist as the panel describes it. */
export interface MusicItem {
  kind: 'playlist' | 'track'
  id: string
  title: string
  /** "Artist - Album" for a song; "Playlist" for a playlist. */
  meta: string
  image: string | null
  url: string | null
}

export interface MusicPanelInputs {
  connected: boolean
  focusView: boolean
  /** The board is showing as a moment: the music and nothing to operate. */
  momentView?: boolean
  /** The person put the search away. Only means anything when connected. */
  searchCollapsed: boolean
  searchState: MusicSearchState
  suggestionCount: number
  /** What Spotify reports playing, if anything. */
  playing: { title: string; artist: string; album: string; albumArt: string | null; url: string | null } | null
  /** A song held for Play: chosen, or looked up again after connecting. */
  heldTrack: { id: string; name: string; artists: string; album: string; url: string; image: string | null } | null
  /** The board's saved song, if it keeps one. */
  boardTrack: { id: string; name: string; artists: string; album: string; url: string; image: string | null } | null
  /** The board's saved playlist; all null when it keeps none. */
  boardPlaylist: { id: string | null; uri: string | null; name: string | null; url: string | null; image?: string | null }
  /** Back from connecting, with the choice made before leaving waiting for Play. */
  cameBackToPlay: boolean
  /** Back from connecting with a song, which is being looked up again. */
  restoringSong: boolean
  /** Spotify's player in this page is ready to play. */
  playerReady: boolean
  /** The Spotify session ended on its own (expired), not by logging out. */
  sessionEnded: boolean
  /** Spotify's own player (not connected only): could it load? */
  embedFailed?: boolean
  /**
   * The visitor used Spotify's player, left this tab, and came back with
   * nothing playing: most likely a trip to Spotify's site to log in.
   */
  backFromSpotify?: boolean
}

/** Spotify's own player, shown to a visitor who has not connected Spotify. */
export interface MusicEmbedView {
  /** Spotify's documented compact heights, in screen pixels. */
  height: 152 | 80
  /** Kept playing but not drawn (the screenshot view shows the cover). */
  hidden: boolean
}

export interface MusicPanelView {
  /** The search field and the buttons under it. */
  showSearch: boolean
  /**
   * The visitor may put the search away, to leave the cover and the player.
   * Connected, always; not connected, once there is music, since the cover and
   * Spotify's player are what is left to show.
   */
  canPutSearchAway: boolean
  /**
   * What takes the free room in the middle of the panel. 'cover' is the music
   * shown large; 'empty' says how to start when there is nothing else.
   */
  middle: 'cover' | 'suggestions' | 'results' | 'empty' | 'none'
  /** The music the panel is about: what is playing, else what is chosen. */
  music: MusicItem | null
  /** The music the board has chosen, which Play starts when nothing plays. */
  chosen: MusicItem | null
  /**
   * The one place that names the music -- title, artist, album. 'cover':
   * under the large cover. 'row': a small row with the cover, used while
   * searching before connecting. 'player': the player's title line.
   */
  namer: 'cover' | 'row' | 'player' | null
  /** The one line saying what to do next, or what is happening; never two. */
  nextStep: string | null
  /** The playback controls: connected, in every view. */
  showPlayer: boolean
  /**
   * Spotify's own player: not connected, with something chosen. Present in
   * every view, so a change of view never stops the music it is playing.
   */
  embed: MusicEmbedView | null
  /** Offer a reload: the one way left to pick up a Spotify login made elsewhere. */
  offerReload: boolean
}

/**
 * The music the board has chosen. A song held for Play comes first: it was
 * picked most recently. Then the board's saved song, then its playlist; a
 * board keeps one or the other, never both.
 */
export function chosenMusic(inputs: Pick<MusicPanelInputs, 'heldTrack' | 'boardTrack' | 'boardPlaylist'>): MusicItem | null {
  const track = inputs.heldTrack ?? inputs.boardTrack
  if (track) {
    return { kind: 'track', id: track.id, title: track.name, meta: `${track.artists} - ${track.album}`, image: track.image, url: track.url || null }
  }
  const playlist = inputs.boardPlaylist
  if (!playlist.id || !playlist.uri) return null
  return { kind: 'playlist', id: playlist.id, title: playlist.name ?? 'Playlist', meta: 'Playlist', image: playlist.image ?? null, url: playlist.url }
}

export function musicPanelView(inputs: MusicPanelInputs): MusicPanelView {
  const { connected, focusView, playing } = inputs
  // While a song chosen before connecting is looked up again, it is the song
  // that will play: the board's playlist must not be named in its place.
  const chosen = inputs.restoringSong && !(inputs.heldTrack ?? inputs.boardTrack) ? null : chosenMusic(inputs)
  const music: MusicItem | null = playing
    ? { kind: 'track', id: playing.url ?? playing.title, title: playing.title, meta: `${playing.artist} - ${playing.album}`, image: playing.albumArt, url: playing.url }
    : chosen

  // Spotify's player belongs to whoever has not connected, whenever there is
  // something to play. It is never taken away by a change of view, only hidden
  // or made smaller, because taking it away is what stops the music.
  const embedFor = (height: MusicEmbedView['height'], hidden = false): MusicEmbedView | null =>
    !connected && chosen && !inputs.embedFailed ? { height, hidden } : null
  const offerReload = !connected && Boolean(inputs.backFromSpotify) && chosen !== null

  // A moment shows which song it is, whatever the panel was doing: a search
  // left open or a panel in its focus view gives way to the cover, and no
  // connecting step or player belongs in a picture of the board.
  if (inputs.momentView) {
    return {
      showSearch: false,
      canPutSearchAway: false,
      middle: music ? 'cover' : 'none',
      music,
      chosen,
      namer: music ? 'cover' : null,
      nextStep: null,
      showPlayer: false,
      embed: embedFor(focusView ? 80 : 152, true),
      offerReload: false,
    }
  }

  // The focus view is the panel at its smallest: no search and no cover.
  // Not connected, Spotify's smallest player is the whole of it; the footer
  // names the music. Only coming back from Spotify earns a line of text.
  if (focusView) {
    return {
      showSearch: false,
      canPutSearchAway: false,
      middle: 'none',
      music,
      chosen,
      namer: connected && music ? 'player' : null,
      // One short line, beside its button: the focus view has room for
      // Spotify's player and very little else, and the player matters more.
      nextStep: connected || !chosen
        ? null
        : inputs.embedFailed
          ? 'Spotify’s player could not load here.'
          : inputs.backFromSpotify
            ? 'Welcome back. Press play again.'
            : null,
      showPlayer: connected,
      embed: embedFor(80),
      offerReload,
    }
  }

  // Putting the search away is offered only when connected, where it
  // leaves the cover and the player.
  const canPutSearchAway = connected || chosen !== null
  const searchHidden = inputs.searchCollapsed && canPutSearchAway
  const middle: MusicPanelView['middle'] = searchHidden
    ? 'cover'
    : inputs.searchState !== 'waiting'
      ? 'results'
      : music || inputs.restoringSong
        ? 'cover'
        : inputs.suggestionCount > 0
          ? 'suggestions'
          : 'empty'

  const namer: MusicPanelView['namer'] = !music
    ? null
    : middle === 'cover'
      ? 'cover'
      : connected
        ? 'player'
        : 'row'

  return {
    showSearch: !searchHidden,
    canPutSearchAway,
    middle,
    music,
    chosen,
    namer,
    nextStep: nextStep(inputs, chosen),
    showPlayer: connected,
    embed: embedFor(152),
    offerReload,
  }
}

/**
 * Said in words because a click that seems to do nothing reads as broken.
 * In order of what matters most: something in progress, a session that
 * ended, then the one step left before the chosen music can play.
 */
function nextStep(inputs: MusicPanelInputs, chosen: MusicItem | null): string | null {
  if (inputs.restoringSong) return 'Getting the song you chose ready…'
  if (!inputs.connected && inputs.sessionEnded) {
    return 'Your Spotify connection has ended. Connect Spotify again to keep listening.'
  }
  if (!inputs.connected) {
    if (!chosen) return null
    if (inputs.embedFailed) return 'Spotify’s player could not load here. You can still listen on Spotify.'
    if (inputs.backFromSpotify) {
      return 'Welcome back to my-states. If you logged in to Spotify, press play again. Still only short previews? Reload this page. Private windows stay on previews.'
    }
    // What to expect from Spotify's player is said in a card when the visitor
    // first chooses something (SpotifyPreviewNotice), not as small print here.
    return null
  }
  if (inputs.cameBackToPlay && !inputs.playing && chosen) {
    return inputs.playerReady
      ? `Spotify is connected. Press play to start ${chosen.title}.`
      : 'Spotify is connected. Getting it ready to play…'
  }
  return null
}
```

### src/App.tsx (excerpt: the /callback handler)

Runs once when Spotify sends the visitor back.

```tsx
  useEffect(() => {
    if (window.location.pathname !== '/callback' || callbackHandledRef.current) return
    // The Spotify authorization code is single-use. Mark this callback as
    // handled before starting the exchange because updating Spotify state can
    // re-run this effect while the request is still in flight.
    callbackHandledRef.current = true
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const error = params.get('error')

    if (error) {
      spotify.reportSignInFailure()
      setCallbackStatus(`Spotify login failed: ${error}`)
      window.history.replaceState({}, '', '/')
      return
    }
    if (!code) {
      spotify.reportSignInFailure()
      setCallbackStatus('Spotify did not return an authorization code.')
      window.history.replaceState({}, '', '/')
      return
    }

    setCallbackStatus('Finishing Spotify login...')
    // Remove the one-time code before awaiting the exchange. This also keeps
    // a later render from attempting to process the same authorization code.
    window.history.replaceState({}, '', '/')
    spotify
      .handleCallback(code, state)
      .then(() => {
        setCallbackStatus(null)
        posthog.capture('spotify_login_completed')
      })
      .catch((caught) => {
        setCallbackStatus(caught instanceof Error ? caught.message : 'Spotify callback failed.')
      })
  }, [posthog, spotify])
```

### src/storage.ts (excerpt: token storage)

Key: `const SPOTIFY_TOKENS_KEY = 'mic:spotify-tokens'`.

```ts
export function loadSpotifyTokens() {
  return readJson<SpotifyTokens | null>(SPOTIFY_TOKENS_KEY, null)
}

export function saveSpotifyTokens(tokens: SpotifyTokens | null) {
  if (!tokens) {
    window.localStorage.removeItem(SPOTIFY_TOKENS_KEY)
    return
  }
  window.localStorage.setItem(SPOTIFY_TOKENS_KEY, JSON.stringify(tokens))
}
```

### src/types.ts (excerpts)

The token and playback-state types.

```ts
export interface SpotifyTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
}

export interface SpotifyTrackState {
  title: string
  artist: string
  album: string
  albumArt: string | null
  url: string | null
  durationMs: number
  positionMs: number
  paused: boolean
}
```

### src/global.d.ts (excerpts)

Types for the Web Playback SDK, plus these entries on `Window` and `ImportMetaEnv`:

```ts
Spotify?: typeof Spotify
onSpotifyWebPlaybackSDKReady?: () => void
readonly VITE_SPOTIFY_CLIENT_ID?: string
readonly VITE_SPOTIFY_REDIRECT_URI?: string
```

```ts
  namespace Spotify {
    interface PlaybackState {
      paused: boolean
      position: number
      duration: number
      track_window: {
        current_track: {
          name: string
          uri?: string
          artists: Array<{ name: string }>
          album: {
            name: string
            images: Array<{ url: string; width?: number; height?: number }>
          }
        }
      }
    }

    interface WebPlaybackError {
      message: string
    }

    interface PlayerInit {
      name: string
      getOAuthToken: (callback: (token: string) => void) => void
      volume?: number
    }

    class Player {
      constructor(init: PlayerInit)
      connect(): Promise<boolean>
      disconnect(): void
      addListener(event: 'ready', callback: (event: { device_id: string }) => void): boolean
      addListener(event: 'not_ready', callback: (event: { device_id: string }) => void): boolean
      addListener(event: 'player_state_changed', callback: (state: PlaybackState | null) => void): boolean
      addListener(
        event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
        callback: (event: WebPlaybackError) => void,
      ): boolean
      togglePlay(): Promise<void>
      previousTrack(): Promise<void>
      nextTrack(): Promise<void>
      setVolume(volume: number): Promise<void>
      seek(positionMs: number): Promise<void>
    }
  }
```

### src/canvasApi.ts (excerpts)

Canvas commands that drove the account flow.

```ts
  | { kind: 'spotify.login' }
  | { kind: 'spotify.loadPlaylistUrl'; panelId: string; url: string }
  | { kind: 'spotify.togglePlay'; panelId: string }

        case 'spotify.login':
          await state.spotify.login()
          return
        case 'spotify.loadPlaylistUrl':
          requirePanel(command.panelId)
          await state.spotify.loadPlaylistFromUrl(command.url, command.panelId)
          return
        case 'spotify.togglePlay':
          requirePanel(command.panelId)
          await state.spotify.togglePlay(command.panelId)
          return
```

### .env.example (excerpt)

Browser configuration for sign-in.

```sh
VITE_SPOTIFY_CLIENT_ID=
# Optional. Leave blank to use the current app origin in local development.
# In Vercel Production, set this to the exact HTTPS callback URL, for example https://your-domain.example/callback.
VITE_SPOTIFY_REDIRECT_URI=
```
