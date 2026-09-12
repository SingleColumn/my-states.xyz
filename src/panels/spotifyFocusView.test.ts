import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PanelCommands } from '../PanelHeader'
import { PanelCommandsProvider } from '../PanelHeader'
import { SpotifyPanel } from './SpotifyPanel'

const panel = vi.hoisted(() => ({ focusView: false }))

vi.mock('../AppState', () => ({
  useAppState: () => ({
    spotify: {
      tokens: { accessToken: 'test-token', refreshToken: null, expiresAt: Date.now() + 600_000 },
      track: { title: 'Weightless', artist: 'Marconi Union', album: 'Distance', albumArt: null, url: null, durationMs: 8000, positionMs: 1000, paused: false },
      tracks: [],
      playlists: [],
      deviceId: 'device',
      isReady: true,
      status: 'Ready',
      error: null,
      login: async () => {},
      logout: () => {},
      clearSearchResults: () => {},
      handleCallback: async () => {},
      searchPlaylists: async () => {},
      searchTracks: async () => {},
      loadPlaylistFromUrl: async () => {},
      playPlaylist: async () => {},
      playTrack: async () => {},
      togglePlay: async () => {},
      nextTrack: async () => {},
      previousTrack: async () => {},
      seek: async () => {},
      setVolume: async () => {},
    },
    moments: {
      activeMoment: {
        id: 'moment_focus',
        panels: [{
          id: 'panel_music',
          type: 'spotify',
          focusView: panel.focusView,
          createdAt: 1,
          updatedAt: 1,
          config: { playlist: { id: 'p1', uri: 'spotify:playlist:p1', name: 'Deep Focus', url: 'https://open.spotify.com/playlist/p1', image: 'https://example.test/deep-focus.jpg' } },
        }],
      },
    },
  }),
}))

const commands: PanelCommands = {
  hidePanel: () => {},
  togglePanelFullScreen: () => {},
  restorePanelDefaultSize: () => {},
  isPanelFullScreen: () => false,
  togglePanelFocusView: () => {},
}

function renderMusicPanel(focusView: boolean) {
  panel.focusView = focusView
  return renderToStaticMarkup(createElement(PanelCommandsProvider, {
    commands,
    children: createElement(SpotifyPanel, { panelId: 'panel_music' }),
  }))
}

describe('Music panel focus view', () => {
  it('shows the loaded playlist and its cover in both views, so it survives Reset fields', () => {
    for (const markup of [renderMusicPanel(false), renderMusicPanel(true)]) {
      expect(markup).toContain('Deep Focus')
      expect(markup).toContain('https://example.test/deep-focus.jpg')
    }
  })

  it('keeps the playlist, track, and playback controls in the focus view', () => {
    const markup = renderMusicPanel(true)
    expect(markup).toContain('is-focus-view')
    expect(markup).toContain('Weightless')
    expect(markup).toContain('Marconi Union - Distance')
    expect(markup).toContain('aria-label="Seek"')
    expect(markup).toContain('title="Play or pause"')
    expect(markup).toContain('aria-label="Volume"')
  })

  it('drops the playlist URL, the search, and the results from the focus view', () => {
    const focused = renderMusicPanel(true)
    expect(focused).not.toContain('Spotify playlist URL')
    expect(focused).not.toContain('Search songs')
    expect(focused).not.toContain('Reset fields')
    expect(focused).not.toContain('Track search results')

    const full = renderMusicPanel(false)
    expect(full).not.toContain('is-focus-view')
    expect(full).toContain('Spotify playlist URL')
    expect(full).toContain('Search songs')
    expect(full).toContain('Reset fields')
    expect(full).toContain('Track search results')
  })

  it('offers the focus view toggle from the panel header, before the hide button', () => {
    const markup = renderMusicPanel(false)
    expect(markup.indexOf('Reduce panel to focus view')).toBeLessThan(markup.indexOf('Hide panel'))
    expect(renderMusicPanel(true)).toContain('Expand panel to full view')
  })

  it('puts Log out furthest to the right, after every shared panel control', () => {
    const markup = renderMusicPanel(false)
    expect(markup.indexOf('title="Reduce panel to focus view"')).toBeLessThan(markup.indexOf('title="Log out"'))
    expect(markup.indexOf('title="Hide panel"')).toBeLessThan(markup.indexOf('title="Log out"'))
    expect(markup.indexOf('title="Expand panel to full screen"')).toBeLessThan(markup.indexOf('title="Log out"'))
    expect(markup.indexOf('title="Restore panel to default size"')).toBeLessThan(markup.indexOf('title="Log out"'))
  })
})
