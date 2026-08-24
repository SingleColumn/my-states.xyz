import { describe, expect, it } from 'vitest'
import { getSpotifyPlaybackAction, parseSpotifyPlaylistUrl } from './spotify'

describe('Spotify playlist URL parsing', () => {
  it('accepts playlist URLs and playlist URIs', () => {
    expect(parseSpotifyPlaylistUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe('37i9dQZF1DXcBWIGoYBM5M')
    expect(parseSpotifyPlaylistUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toBe('37i9dQZF1DXcBWIGoYBM5M')
  })

  it('rejects track and episode URLs', () => {
    expect(parseSpotifyPlaylistUrl('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl')).toBeNull()
    expect(parseSpotifyPlaylistUrl('spotify:track:11dFghVXANMlKmJXsNCbNl')).toBeNull()
    expect(parseSpotifyPlaylistUrl('https://open.spotify.com/episode/1234567890')).toBeNull()
  })
})

describe('Spotify playback restoration', () => {
  it('loads the saved playlist when a reloaded player has no current track', () => {
    expect(getSpotifyPlaybackAction(false, 'spotify:playlist:saved')).toBe('load-saved-playlist')
  })

  it('toggles an existing playback context without reloading the playlist', () => {
    expect(getSpotifyPlaybackAction(true, 'spotify:playlist:saved')).toBe('toggle-current')
  })

  it('reports a missing playlist when there is no playback context to restore', () => {
    expect(getSpotifyPlaybackAction(false, null)).toBe('missing-playlist')
  })
})
