import { useEffect, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Disc3,
  ExternalLink,
  Link2,
  LogIn,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react'
import { useAppState } from '../AppState'
import { defaultSpotifyPlaylistReference } from '../storage'
import { debounce, formatDuration } from '../utils'
import type { DebouncedFunction } from '../utils'
import type { Panel } from '../types'
import { PanelHeader, usePanelCommands } from '../PanelHeader'
import { panelContentProps } from '../panelSurface'

type SpotifySearchType = 'tracks' | 'playlists'

// Long enough that a typed word is one request rather than five, short enough
// that results feel like they are keeping up with the typing.
const searchDebounceMs = 300

// A single letter matches most of Spotify, so it costs a request to tell
// someone nothing. Two is where an answer starts to mean something.
const minSearchLength = 2

/** What the results area has to say for itself, when it has no results to show. */
type SearchState = 'waiting' | 'searching' | 'no-matches' | 'results'

export function SpotifyPanel({ panelId }: { panelId: string }) {
  const posthog = usePostHog()
  const { spotify, moments, panels } = useAppState()
  const commands = usePanelCommands()
  const found = panels.get(panelId)
  const panel = found?.type === 'spotify' ? (found as Panel<'spotify'>) : undefined
  const panelPlaylist = panel?.config.playlist ?? defaultSpotifyPlaylistReference
  // Focus view keeps what someone glances at while they write or look at
  // images: the playlist, the track, and the playback controls.
  const focusView = panel?.focusView === true
  const [query, setQuery] = useState('')
  // A playlist is what this panel is for: it plays behind the images for as
  // long as someone is looking at them, where a single song stops after three
  // minutes. Songs stay available, but finding a playlist is the default step.
  const [searchType, setSearchType] = useState<SpotifySearchType>('playlists')
  const [playlistUrl, setPlaylistUrl] = useState(panelPlaylist.url ?? '')
  const [isLinkFieldOpen, setIsLinkFieldOpen] = useState(false)
  // Putting the search away is what brings the artwork out: the panel shows
  // one or the other, never both, and the choice is the person's to make.
  const [searchCollapsed, setSearchCollapsed] = useState(false)
  const [volume, setVolume] = useState(70)
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
  }, [moments.activeMoment?.id, panelPlaylist.url])

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
  // keystroke has already overtaken.
  const searchRef = useRef<DebouncedFunction<(text: string, type: SpotifySearchType) => void> | null>(null)
  useEffect(() => {
    const search = debounce((text: string, type: SpotifySearchType) => {
      void runRef.current(async () => {
        try {
          if (type === 'tracks') {
            await spotifyRef.current.searchTracks(text)
            return
          }
          await spotifyRef.current.searchPlaylists(text)
          posthogRef.current?.capture('spotify_playlist_searched')
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
    if (!spotify.tokens) return
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

  // Focus view is the panel at its smallest, so it implies the search is put
  // away rather than being a second control that does the same thing.
  const searchHidden = focusView || searchCollapsed
  // The menu entry that opens the link field is absent in the focus view and
  // when logged out, so the popover it opens goes with it rather than
  // outliving the only way back to it.
  const linkFieldOpen = isLinkFieldOpen && Boolean(spotify.tokens) && !focusView
  const results = searchType === 'tracks' ? spotify.tracks : spotify.playlists
  const searchState: SearchState = query.trim().length < minSearchLength
    ? 'waiting'
    : searching
      ? 'searching'
      : results.length === 0
        ? 'no-matches'
        : 'results'

  // The list is given whatever height the column has left over, which lands
  // mid-row as often as not and leaves a sliced playlist along the bottom
  // edge. Row height is fluid — the artwork and padding both scale with the
  // panel — so the whole number of rows that fits can only be measured, not
  // written down. Round the list down to that many.
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
  }, [searchHidden, searchType, results.length])

  function resetFields() {
    setQuery('')
    setPlaylistUrl('')
    setLocalError(null)
    searchRef.current?.cancel()
    spotify.clearSearchResults()
  }

  return (
    <section className={`panel panel-spotify-surface${focusView ? ' is-focus-view' : ''}${searchHidden ? ' is-search-hidden' : ''}`}>
      <PanelHeader
        panelId={panelId}
        panelType="spotify"
        title="Music"
        menuItems={[
          // Pasting a link is how someone plays a playlist they already have
          // in hand, which is a rarer thing to arrive wanting than searching
          // for one. It waits here so the body holds a single way in.
          ...(spotify.tokens && !focusView ? [{
            id: 'search-visibility',
            label: searchCollapsed ? 'Show the search' : 'Hide the search and show the artwork',
            icon: searchCollapsed ? <Search size={17} aria-hidden="true" /> : <Disc3 size={17} aria-hidden="true" />,
            checked: searchCollapsed,
            onSelect: () => setSearchCollapsed((current) => !current),
          }] : []),
          ...(spotify.tokens && !focusView ? [{
            id: 'playlist-link',
            label: 'Play from a Spotify link',
            icon: <Link2 size={17} aria-hidden="true" />,
            checked: linkFieldOpen,
            onSelect: () => setIsLinkFieldOpen((current) => !current),
          }] : []),
          {
            id: 'focus-view',
            label: focusView ? 'Expand panel to full view' : 'Reduce panel to focus view',
            icon: focusView ? <ChevronsUpDown size={17} aria-hidden="true" /> : <ChevronsDownUp size={17} aria-hidden="true" />,
            onSelect: () => commands.togglePanelFocusView(panelId),
          },
        ]}
        trailingMenuItems={spotify.tokens ? [
          { id: 'log-out', label: 'Log out', icon: <LogOut size={17} aria-hidden="true" />, onSelect: () => spotify.logout() },
        ] : undefined}
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
        {!spotify.tokens ? (
          <div className="card-content spotify-login">
            <div>
              <h3>Play a playlist</h3>
              <p>{spotify.status}</p>
            </div>
            <button className="card-icon-button is-primary is-wide" type="button" onClick={() => void run(spotify.login)}>
              <LogIn size={18} />
              Log in
            </button>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        ) : (
          <>
            {searchHidden ? null : (
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
                  <select className="app-dropdown" aria-label="Search type" value={searchType} onChange={(event) => setSearchType(event.target.value as SpotifySearchType)}>
                    <option value="playlists">Playlist</option>
                    <option value="tracks">Song</option>
                  </select>
                  <input
                    aria-label={searchType === 'tracks' ? 'Search songs' : 'Search playlists'}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={searchType === 'tracks' ? 'Search songs' : 'Search playlists'}
                  />
                </form>

                {/* Putting the search away is offered here, next to Reset,
                    rather than only in the panel menu: it is the way back to
                    the artwork, and a menu is not where anyone looks for it. */}
                <div className="spotify-search-actions">
                  <button className="card-icon-button is-wide spotify-reset-button" type="button" onClick={resetFields}>
                    <RotateCcw size={18} />
                    Reset fields
                  </button>
                  <button className="card-icon-button is-wide" type="button" onClick={() => setSearchCollapsed(true)}>
                    <ChevronsDownUp size={18} />
                    Hide search
                  </button>
                </div>

                {searchType === 'tracks' ? (
                  <div ref={listRef} className="playlist-list" aria-label="Track search results">
                    {spotify.tracks.map((track) => {
                      // Playback reports a track by its Spotify page, not its
                      // id, so that is what the playing row is recognised by.
                      const isPlaying = Boolean(spotify.track?.url && spotify.track.url === track.url)
                      return (
                        <button
                          className={isPlaying ? 'playlist-option is-current' : 'playlist-option'}
                          type="button"
                          key={track.id}
                          aria-pressed={isPlaying}
                          disabled={busy}
                          onClick={() => void run(() => spotify.playTrack(track, panelId))}
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
                    {searchState === 'waiting' ? <p className="playlist-list-note">Type a song name to see what is on Spotify.</p> : null}
                  </div>
                ) : (
                  <div ref={listRef} className="playlist-list" aria-label="Playlist search results">
                    {spotify.playlists.map((playlist) => {
                      const isPlaying = playlist.id === panelPlaylist.id
                      return (
                        <button
                          className={isPlaying ? 'playlist-option is-current' : 'playlist-option'}
                          type="button"
                          key={playlist.id}
                          aria-pressed={isPlaying}
                          disabled={busy}
                          onClick={() => void run(async () => {
                            await spotify.playPlaylist(playlist, panelId)
                            posthog.capture('spotify_playlist_played')
                          })}
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
                    {searchState === 'waiting' ? <p className="playlist-list-note">Type what you feel like hearing — a mood, a genre, an artist.</p> : null}
                  </div>
                )}
              </>
            )}

            {searchCollapsed && !focusView ? (
              <button className="card-icon-button is-wide spotify-show-search" type="button" onClick={() => setSearchCollapsed(false)}>
                <Search size={18} />
                Find a playlist
              </button>
            ) : null}

            {searchHidden ? (
              <>
              <div className="card-content album-frame">
                {spotify.track?.albumArt ? (
                  <img src={spotify.track.albumArt} alt="" />
                ) : (
                  <div className="album-frame-empty" />
                )}
              </div>
              </>
            ) : null}

            {/* Which playlist is loaded, in one line, identical whether the
                search is open or put away — hiding the search must not shift
                the words that name what is playing. No cover here: with one
                it was a card the size and shape of the results above it, and
                read as one more of them. The artwork above the fold is what
                belongs to the put-away view. */}
            {panelPlaylist.name ? (
              <div className="loaded-playlist">
                <span>
                  <small>Playlist</small>
                  <strong>{panelPlaylist.name}</strong>
                </span>
              </div>
            ) : null}

            <div className="track-copy">
              <div className="track-title-row">
              <p className="track-title">{spotify.track?.title ?? panelPlaylist.name ?? 'No playlist playing'}</p>
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
              <p className="track-meta">{spotify.track ? `${spotify.track.artist} - ${spotify.track.album}` : spotify.status}</p>
            </div>

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
              <button className="card-icon-button is-primary is-large" type="button" title="Play or pause" onClick={() => void run(() => spotify.togglePlay(panelId))}>
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
        )}
      </div>

      <footer className="card-footer" {...panelContentProps}>
        <span className="card-footer-meta">{panelPlaylist.name ?? 'No playlist loaded'}</span>
        <div className="card-footer-status">
          {/* The panel is titled "Music", so the service is credited here instead —
              and it stays visible once logged in, where the body no longer names it. */}
          <span className="card-footer-service">Spotify</span>
          {error ? (
            <span className="error-text">{error}</span>
          ) : (
            /* Logged out, spotify.status is the same sentence the body already
               shows, so the footer reports connection state only. */
            <span>{!spotify.tokens ? 'Not connected' : spotify.isReady ? 'Ready' : spotify.status}</span>
          )}
        </div>
      </footer>
    </section>
  )
}
