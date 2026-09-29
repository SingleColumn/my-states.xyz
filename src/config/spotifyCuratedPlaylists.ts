/**
 * The suggestions the Music panel offers before anyone has searched for
 * anything — the whole of what the administrator of this repository controls.
 *
 * Editing this file is the only way to change what is suggested. There is no
 * admin screen, no database and no remote list: a suggestion is a line here,
 * reviewed like any other change.
 *
 *
 * HOW TO ADD A PLAYLIST
 *
 * 1. Open the playlist in Spotify and copy its link, which looks like
 *      https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4AsH4n
 *    The id is the part after `/playlist/`, before any `?` — here
 *    `3cEYpjA9oz9GiPac4AsH4n`. A `spotify:playlist:3cEYpjA9oz9GiPac4AsH4n`
 *    URI carries the same id.
 *
 * 2. Add an entry to `curatedSpotifyPlaylists` below:
 *
 *      { id: '3cEYpjA9oz9GiPac4AsH4n', category: 'ambient' },
 *
 * 3. Remove one by deleting its line. Nothing else refers to these ids.
 *
 *
 * WHAT A CATEGORY DOES
 *
 * `category` is optional and free text — `ambient`, `piano`, `night`,
 * whatever this collection wants to mean. It is never shown; its only job is
 * to stop six suggestions being six of the same thing. When enough entries
 * carry categories the selection takes one per category first and only then
 * fills up from the rest; entries with no category are sampled normally.
 *
 *
 * WHAT SPOTIFY WILL AND WILL NOT SERVE
 *
 * Titles, artwork, owner and track counts are read from Spotify at runtime
 * from the id alone, which is why an entry is an id and not a copy of the
 * playlist's details.
 *
 * Spotify's Web API stopped serving its own algorithmic and editorial
 * playlists to applications in development mode in November 2024. Those are
 * the ones whose id begins `37i9dQZF1D`, and a lookup of one answers 404.
 * Use playlists made by people or by this project's own account. An id that
 * cannot be read is left out of the suggestions and the rest still appear,
 * so a playlist that is later deleted or made private costs a card and
 * nothing more.
 *
 * `name` is an optional fallback, for the rare case of an id worth keeping
 * whose metadata Spotify will not serve. It is only used when the lookup
 * comes back with nothing for that id. The id always remains the playlist's
 * real identity.
 */

export interface CuratedSpotifyPlaylist {
  /** The Spotify playlist id: the canonical identity of a suggestion. */
  id: string
  /** Optional grouping, used only to keep one set of suggestions varied. */
  category?: string
  /** Optional fallback title, for an id Spotify will not describe. */
  name?: string
}

/**
 * About six of these are shown at a time (see `suggestionCount` in
 * spotifySuggestions.ts), drawn again on each page load and by Shuffle. A
 * pool of thirty to a hundred or more works well; there is no upper bound.
 *
 * It is empty in this repository because inventing plausible-looking Spotify
 * ids would ship suggestions that 404 for everyone. The panel behaves
 * correctly with an empty pool: the suggestion area simply does not appear,
 * and search and Connect Spotify are unaffected. Add real ids here to turn
 * suggestions on.
 */
export const curatedSpotifyPlaylists: CuratedSpotifyPlaylist[] = [
  // { id: 'PASTE_A_SPOTIFY_PLAYLIST_ID_HERE', category: 'ambient' },
]
