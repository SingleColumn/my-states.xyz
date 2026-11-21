// The catalog DTOs and their mappers live in a module that carries no browser
// globals, because the server functions under api/ parse the same JSON. They
// are re-exported here so every existing `from './spotify'` import still
// reads the way it did.
//
// Signing in to Spotify and playing through the Web Playback SDK used to live
// here too; that approach is kept in docs/spotify-sdk-approach.md.
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

/** The playlist id in a Spotify playlist link or URI, or null. */
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
