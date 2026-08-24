import { describe, expect, it } from 'vitest'
import { parseSpotifyPlaylistUrl } from './spotify'

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
