import { type SyntheticEvent, useEffect, useState } from 'react'
import {
  ExternalLink,
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
import { formatDuration } from '../utils'
import type { Panel } from '../types'

export function SpotifyPanel({ panelId }: { panelId: string }) {
  const { spotify, sessions } = useAppState()
  const panelPlaylist = (sessions.activeSession?.panels.find(panel => panel.id === panelId) as Extract<Panel, { type: 'spotify' }> | undefined)?.config.playlist ?? defaultSpotifyPlaylistReference
  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState<'tracks' | 'playlists'>('tracks')
  const [playlistUrl, setPlaylistUrl] = useState(panelPlaylist.url ?? '')
  const [volume, setVolume] = useState(70)
  const [busy, setBusy] = useState(false)
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

  useEffect(() => {
    setPlaylistUrl(panelPlaylist.url ?? '')
  }, [sessions.activeSession?.id, panelPlaylist.url])

  function resetFields() {
    setQuery('')
    setPlaylistUrl('')
    setLocalError(null)
    spotify.clearSearchResults()
  }

  return (
    <section className="panel panel-spotify-surface">
      <header className="card-header">
        <div>
          <h2 className="card-title">Music</h2>
        </div>
        <div className="card-header-actions">
          {spotify.tokens ? (
            <button
              className="card-icon-button"
              type="button"
              title="Log out"
              onPointerDown={stopCanvasEvent}
              onMouseDown={stopCanvasEvent}
              onClick={(event) => {
                stopCanvasEvent(event)
                spotify.logout()
              }}
            >
              <LogOut size={18} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="panel-body panel-interactive" {...canvasEventBlockerProps}>
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
            <div className="card-content album-frame">
              {spotify.track?.albumArt ? (
                <img src={spotify.track.albumArt} alt="" />
              ) : (
                <div className="album-frame-empty" />
              )}
            </div>

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
                    onPointerDown={stopCanvasEvent}
                    onMouseDown={stopCanvasEvent}
                    onClick={stopCanvasEvent}
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

            <form
              className="input-row"
              onSubmit={(event) => {
                event.preventDefault()
                void run(() => spotify.loadPlaylistFromUrl(playlistUrl, panelId))
              }}
            >
              <input aria-label="Spotify playlist URL" value={playlistUrl} onChange={(event) => setPlaylistUrl(event.target.value)} placeholder="Spotify playlist URL" />
              <button className="card-icon-button" type="submit" title="Load Spotify playlist URL" aria-label="Load Spotify playlist URL" disabled={busy}>
                <ExternalLink size={18} aria-hidden="true" />
              </button>
            </form>

            <form
              className="input-row spotify-search-row"
              onSubmit={(event) => {
                event.preventDefault()
                void run(() => searchType === 'tracks' ? spotify.searchTracks(query) : spotify.searchPlaylists(query))
              }}
            >
              <select aria-label="Search type" value={searchType} onChange={(event) => setSearchType(event.target.value as 'tracks' | 'playlists')}>
                <option value="tracks">Song</option>
                <option value="playlists">Playlist</option>
              </select>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchType === 'tracks' ? 'Search songs' : 'Search playlists'} />
              <button className="card-icon-button" type="submit" title={`Search ${searchType}`} disabled={busy}>
                <Search size={18} />
              </button>
            </form>

            <button className="card-icon-button is-wide spotify-reset-button" type="button" onClick={resetFields}>
              <RotateCcw size={18} />
              Reset fields
            </button>

            {searchType === 'tracks' ? (
              <div className="playlist-list" aria-label="Track search results">
                {spotify.tracks.map((track) => (
                  <button className="playlist-option" type="button" key={track.id} onClick={() => void run(() => spotify.playTrack(track, panelId))}>
                    {track.image ? <img src={track.image} alt="" /> : <div />}
                    <span>
                      <strong>{track.name}</strong>
                      <small>{track.artists} - {track.album}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="playlist-list" aria-label="Playlist search results">
                {spotify.playlists.map((playlist) => (
                  <button
                    className="playlist-option"
                    type="button"
                    key={playlist.id}
                    onClick={() => void run(() => spotify.playPlaylist(playlist, panelId))}
                  >
                    {playlist.image ? <img src={playlist.image} alt="" /> : <div />}
                    <span>
                      <strong>{playlist.name}</strong>
                      <small>
                        {playlist.owner} - {playlist.trackCount} tracks
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <footer className="card-footer panel-interactive" {...canvasEventBlockerProps}>
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

function stopCanvasEvent(event: SyntheticEvent) {
  if ('button' in event && event.button === 2) return
  ;(event as unknown as { isKilled?: boolean }).isKilled = true
  ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
}

const canvasEventBlockerProps = {
  onClick: stopCanvasEvent,
  onMouseDown: stopCanvasEvent,
  onPointerDown: stopCanvasEvent,
  onPointerMove: stopCanvasEvent,
  onPointerUp: stopCanvasEvent,
  onWheel: stopCanvasEvent,
}
