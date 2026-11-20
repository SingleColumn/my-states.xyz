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
      tracks: [],
      playlists: [],
      selectedTrack: null,
      playlistsHaveMore: false,
      error: null,
      clearSearchResults: () => {},
      searchPlaylists: async () => {},
      searchTracks: async () => {},
      loadMorePlaylists: async () => {},
      loadPlaylistFromUrl: async () => {},
      selectPlaylist: () => {},
      selectTrack: () => {},
    },
    boards: { activeBoard: { id: 'board_focus' } },
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
  deletePanel: () => {},
  togglePanelFullScreen: () => {},
  restorePanelDefaultSize: () => {},
  isPanelFullScreen: () => false,
  togglePanelFocusView: () => {},
  expandPanelFromStartingHeight: () => {},
}

function renderMusicPanel(focusView: boolean) {
  panel.focusView = focusView
  return renderToStaticMarkup(createElement(PanelCommandsProvider, {
    commands,
    children: createElement(SpotifyPanel, { panelId: 'panel_music' }),
  }))
}

// The focus view is the panel a few centimetres tall: Spotify's smallest
// player, and the music's name in the footer.
describe('Music panel focus view', () => {
  it('names the loaded playlist in both views, so it survives Reset fields', () => {
    for (const markup of [renderMusicPanel(false), renderMusicPanel(true)]) {
      expect(markup).toContain('Deep Focus')
      expect(markup).not.toContain('No playlist loaded')
    }
  })

  it("holds Spotify's smallest player", () => {
    const markup = renderMusicPanel(true)
    expect(markup).toContain('is-focus-view')
    expect(markup).toContain('spotify-embed-strip')
    expect(markup).toContain('Previews without a login')
  })

  it('drops the search, the results and the suggestions from the focus view', () => {
    const focused = renderMusicPanel(true)
    expect(focused).not.toContain('Search playlists')
    expect(focused).not.toContain('Reset fields')
    expect(focused).not.toContain('Playlist search results')
    expect(focused).not.toContain('Suggested for this session')

    const full = renderMusicPanel(false)
    expect(full).not.toContain('is-focus-view')
    expect(full).toContain('Search playlists')
    expect(full).toContain('Reset fields')
    // No search typed: the chosen music fills the room the results would take.
    expect(full).toContain('is-featured')
  })

  // What the search looks for is a setting in the panel menu. It is about the
  // search, so it goes wherever the search goes: present in the full view,
  // absent in the focus view where there is no search to configure.
  it('offers what the search looks for in the menu, only where there is a search', () => {
    const full = renderMusicPanel(false)
    expect(full).toContain('Search for playlists')
    expect(full).toContain('Search for songs')
    expect(full).not.toContain('aria-label="Search type"')

    const focused = renderMusicPanel(true)
    expect(focused).not.toContain('Search for playlists')
    expect(focused).not.toContain('Search for songs')
  })

  it('offers focus view in the panel group, right after Hide panel, with the same name on or off', () => {
    const markup = renderMusicPanel(false)
    expect(markup.indexOf('>Hide panel<')).toBeLessThan(markup.indexOf('>Focus view<'))
    expect(markup.indexOf('>Focus view<')).toBeLessThan(markup.indexOf('>Expand panel to full screen<'))
    expect(renderMusicPanel(true)).toContain('>Focus view<')
  })

  // Signing in to a Spotify account went with the Web Playback SDK approach
  // (docs/spotify-sdk-approach.md).
  it('offers no Spotify account in any view', () => {
    for (const markup of [renderMusicPanel(false), renderMusicPanel(true)]) {
      expect(markup).not.toContain('Connect Spotify')
      expect(markup).not.toContain('>Log out<')
      expect(markup).not.toContain('Play from a Spotify link')
    }
  })
})
