import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PanelCommands } from '../PanelHeader'
import { PanelCommandsProvider } from '../PanelHeader'
import { SpotifyPanel } from './SpotifyPanel'

const panel = vi.hoisted(() => ({ focusView: false }))

// The header's menu is closed until clicked, and a static render cannot
// click, so the real header is rendered with its menu open.
vi.mock('../PanelHeader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../PanelHeader')>()
  return {
    ...actual,
    PanelHeader: (props: Parameters<typeof actual.PanelHeader>[0]) => createElement(actual.PanelHeader, { ...props, menuDefaultOpen: true }),
  }
})

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
    moments: { activeMoment: { id: 'moment_focus' } },
    panels: {
      get: () => ({
        id: 'panel_music',
        type: 'spotify',
        visible: true,
        focusView: panel.focusView,
        config: { playlist: { id: 'p1', uri: 'spotify:playlist:p1', name: 'Deep Focus', url: 'https://open.spotify.com/playlist/p1', image: 'https://example.test/deep-focus.jpg' } },
      }),
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
  it('names the loaded playlist in both views, so it survives Reset fields', () => {
    for (const markup of [renderMusicPanel(false), renderMusicPanel(true)]) {
      expect(markup).toContain('Deep Focus')
    }
  })

  // The row names the playlist and nothing more, the same in every view, so
  // that putting the search away does not move the words that say what is
  // playing. Its cover is what made it a card the size of a result row.
  it('names the loaded playlist without its cover, in every view', () => {
    for (const markup of [renderMusicPanel(false), renderMusicPanel(true)]) {
      expect(markup).toContain('Deep Focus')
      expect(markup).not.toContain('https://example.test/deep-focus.jpg')
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

  it('drops the search, the results, and the link option from the focus view', () => {
    const focused = renderMusicPanel(true)
    expect(focused).not.toContain('Play from a Spotify link')
    expect(focused).not.toContain('Search playlists')
    expect(focused).not.toContain('Reset fields')
    expect(focused).not.toContain('Playlist search results')

    const full = renderMusicPanel(false)
    expect(full).not.toContain('is-focus-view')
    expect(full).toContain('Play from a Spotify link')
    expect(full).toContain('Search playlists')
    expect(full).toContain('Reset fields')
    expect(full).toContain('Playlist search results')
  })

  // The body offers one way in. The link field is a step someone opens from
  // the panel menu, so it is absent until they ask for it.
  it('keeps the playlist link field out of the body until it is opened', () => {
    const full = renderMusicPanel(false)
    expect(full).toContain('Play from a Spotify link')
    expect(full).not.toContain('Spotify playlist URL')
    expect(full.indexOf('Search playlists')).toBeGreaterThan(full.indexOf('panel-body'))
  })

  it('offers the focus view toggle from the panel header, before the hide button', () => {
    const markup = renderMusicPanel(false)
    expect(markup.indexOf('Reduce panel to focus view')).toBeLessThan(markup.indexOf('Hide panel'))
    expect(renderMusicPanel(true)).toContain('Expand panel to full view')
  })

  it('puts Log out last in the header menu, after every shared panel control', () => {
    const markup = renderMusicPanel(false)
    expect(markup.indexOf('>Reduce panel to focus view<')).toBeLessThan(markup.indexOf('>Log out<'))
    expect(markup.indexOf('>Hide panel<')).toBeLessThan(markup.indexOf('>Log out<'))
    expect(markup.indexOf('>Expand panel to full screen<')).toBeLessThan(markup.indexOf('>Log out<'))
    expect(markup.indexOf('>Restore panel to default size<')).toBeLessThan(markup.indexOf('>Log out<'))
  })
})
