/**
 * The shapes Spotify's public catalog comes back in, and the summaries this
 * app reduces them to.
 *
 * This module is deliberately neutral: it is the one piece of Spotify code
 * that runs in both the browser bundle and the server functions, so it must
 * not touch `window`, `localStorage` or `import.meta.env`. Anything that does
 * belongs in src/spotify.ts (browser) or elsewhere in api/_lib (server).
 *
 * It lives in api/_lib, and the browser imports it from there, and not the
 * other way round, because the server is the side with a constraint: a
 * deployed function is loaded as a plain ES module, and everything it imports
 * has to be found beside it. Keeping the server code inside api/ means it can
 * be packaged and loaded on its own; the browser's bundler can read from
 * anywhere.
 *
 * Having one copy of the parsing is the point. The catalog answer for a
 * search reaches the panel either from Spotify directly (with the visitor's
 * own token) or from our own endpoint (with the application's), and those
 * two paths must not drift into two readings of the same JSON.
 */

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
    // Playlist-detail responses use `tracks.total`. Some Spotify responses
    // also expose an `items.total` compatibility field, which can be zero even
    // when the canonical tracks count is populated, so prefer tracks first.
    trackCount: item.tracks?.total ?? item.items?.total ?? 0,
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

/**
 * Spotify blanks entries in search results rather than omitting them: a full
 * page of ten can carry six real playlists and four nulls. Both the browser
 * and the server drop them the same way.
 */
export function isSpotifyPlaylistApiItem(item: SpotifyPlaylistApiItem | null | undefined): item is SpotifyPlaylistApiItem {
  return Boolean(item?.id && item.name && item.uri)
}

export function isSpotifyTrackApiItem(item: SpotifyTrackApiItem | null | undefined): item is SpotifyTrackApiItem {
  return Boolean(item?.id && item.name && item.uri)
}

/** What a catalog playlist search answers, whoever asked Spotify for it. */
export interface SpotifyPlaylistSearchResult {
  items: SpotifyPlaylistSummary[]
  /** Spotify has a further page after the one these items came from. */
  hasMore: boolean
}

export interface SpotifyTrackSearchResult {
  items: SpotifyTrackSummary[]
}
