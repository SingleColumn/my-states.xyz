import type { SpotifyTokens } from './types'

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

export interface SpotifyPlaylistSummary {
  id: string
  name: string
  uri: string
  url: string
  image: string | null
  owner: string
  trackCount: number
}

export interface SpotifyTrackSummary {
  id: string
  name: string
  uri: string
  url: string
  image: string | null
  artists: string
  album: string
  durationMs: number
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
    throw new Error(`Spotify token exchange failed (${response.status}).`)
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

export interface SpotifyPlaylistApiItem {
  id: string
  name: string
  uri: string
  external_urls?: { spotify?: string }
  images?: Array<{ url: string }>
  owner?: { display_name?: string } | null
  tracks?: { total?: number } | null
  items?: { total?: number } | null
}

export interface SpotifyTrackApiItem {
  id: string
  name: string
  uri: string
  external_urls?: { spotify?: string }
  album?: {
    name?: string
    images?: Array<{ url: string }>
  } | null
  artists?: Array<{ name?: string }> | null
  duration_ms?: number
}

export function mapPlaylist(item: SpotifyPlaylistApiItem): SpotifyPlaylistSummary {
  return {
    id: item.id,
    name: item.name,
    uri: item.uri,
    url: item.external_urls?.spotify ?? '',
    image: item.images?.[0]?.url ?? null,
    owner: item.owner?.display_name ?? 'Spotify',
    trackCount: item.items?.total ?? item.tracks?.total ?? 0,
  }
}

export function mapTrack(item: SpotifyTrackApiItem): SpotifyTrackSummary {
  return {
    id: item.id,
    name: item.name,
    uri: item.uri,
    url: item.external_urls?.spotify ?? '',
    image: item.album?.images?.[0]?.url ?? null,
    artists: item.artists?.map((artist) => artist.name).filter((name): name is string => Boolean(name)).join(', ') || 'Unknown artist',
    album: item.album?.name ?? 'Unknown album',
    durationMs: item.duration_ms ?? 0,
  }
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
