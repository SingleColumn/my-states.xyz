import { useEffect, useMemo, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Disc3,
  ExternalLink,
  Link2,
  ListMusic,
  LogIn,
  LogOut,
  Music,
  Pause,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react'
import { useAppState } from '../AppState'
import { defaultSpotifyPlaylistReference } from '../storage'
import { debounce, formatDuration } from '../utils'
import type { DebouncedFunction } from '../utils'
import type { Panel } from '../types'
import type { SpotifyPlaylistSummary, SpotifyTrackSummary } from '../spotify'
import { fetchCuratedPlaylists } from '../spotifyCatalog'
import type { CuratedSpotifyPlaylist } from '../config/spotifyCuratedPlaylists'
import { getSessionSuggestions, shuffleSessionSuggestions } from '../spotifySuggestions'
import { forgetReturnContext, rememberReturnContext, takeReturnContext, type SpotifyReturnContext } from '../spotifyReturnContext'
import { PanelHeader, usePanelCommands } from '../PanelHeader'
import { useMomentView } from '../momentView'
import { musicPanelView, type MusicSearchState } from './musicPanelView'
import { panelContentProps } from '../panelSurface'

type SpotifySearchType = 'tracks' | 'playlists'

// Long enough that a typed word is one request rather than five, short enough
// that results feel like they are keeping up with the typing.
const searchDebounceMs = 300

// A single letter matches most of Spotify, so it costs a request to tell
// someone nothing. Two is where an answer starts to mean something.
const minSearchLength = 2

export function SpotifyPanel({ panelId }: { panelId: string }) {
  const posthog = usePostHog()
  const { spotify, boards, panels } = useAppState()
  const commands = usePanelCommands()
  const found = panels.get(panelId)
  const panel = found?.type === 'spotify' ? (found as Panel<'spotify'>) : undefined
  const panelPlaylist = panel?.config.playlist ?? defaultSpotifyPlaylistReference
  // Focus view keeps what someone glances at while they write or look at
  // images: the playlist, the track, and the playback controls.
  const focusView = panel?.focusView === true
  const momentView = useMomentView()
  // Connecting Spotify is what playback needs. It is not what the panel
  // needs: searching and choosing happen either way, and this flag marks the
  // boundary between the two rather than the door into the panel.
  const connected = Boolean(spotify.tokens)
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
  }, [boards.activeBoard?.id, panelPlaylist.url])

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
  // keystroke has already overtaken. None of this depends on being connected:
  // the same field, the same wait and the same guard serve both.
  const searchRef = useRef<DebouncedFunction<(text: string, type: SpotifySearchType) => void> | null>(null)
  useEffect(() => {
    const search = debounce((text: string, type: SpotifySearchType) => {
      void runRef.current(async () => {
        try {
          if (type === 'tracks') {
            await spotifyRef.current.searchTracks(text)
          } else {
            await spotifyRef.current.searchPlaylists(text)
          }
          // One event for a search, whoever asked and for whichever kind, so
          // the two paths cannot be counted twice or compared against
          // different definitions. The words typed are not sent.
          posthogRef.current?.capture('spotify_catalog_searched', {
            authenticated: Boolean(spotifyRef.current.tokens),
            search_type: type === 'tracks' ? 'track' : 'playlist',
          })
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

  // The suggestions this page session offers. Chosen once, in a module that
  // holds the choice, so that a rerender, a resize, a change of board or
  // tldraw redrawing the canvas all leave the same six cards in place.
  const [suggestions, setSuggestions] = useState<CuratedSpotifyPlaylist[]>(getSessionSuggestions)
  const [suggestionSummaries, setSuggestionSummaries] = useState<SpotifyPlaylistSummary[]>([])

  useEffect(() => {
    if (suggestions.length === 0) {
      setSuggestionSummaries([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const found = await fetchCuratedPlaylists(suggestions.map((entry) => entry.id))
        if (!cancelled) setSuggestionSummaries(found)
      } catch {
        // Discovery being unavailable costs the suggestions and nothing else,
        // and says nothing about it: the panel simply has none to offer. The
        // search field and Connect Spotify both stay where they were.
        if (!cancelled) setSuggestionSummaries([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [suggestions])

  // Kept in the curated order rather than the order Spotify answered in, and
  // skipping any id Spotify would not describe — a playlist that has been
  // deleted or made private costs a card, not the whole row of them.
  const suggestionCards = useMemo(() => {
    const bySpotifyId = new Map(suggestionSummaries.map((summary) => [summary.id, summary]))
    return suggestions
      .map((entry) => bySpotifyId.get(entry.id) ?? fallbackSuggestion(entry))
      .filter((summary): summary is SpotifyPlaylistSummary => summary !== null)
  }, [suggestions, suggestionSummaries])

  // Someone who left to connect Spotify is put back where they were, rather
  // than facing an empty box and no sign of what they had chosen. The words
  // they had typed come back and the search runs again, so the results — with
  // their playlist marked among them — are on screen when they arrive. A
  // playlist needs nothing else: the panel's reference is part of the board
  // and outlived the redirect. A song is only ever a runtime choice, so it is
  // looked up again by its id.
  //
  // Nothing plays on arrival — a browser will not start sound without a click,
  // and a page that began playing by itself would be its own surprise — so the
  // panel says so instead, and the player's own Play button is the one to press.
  const [cameBackToPlay, setCameBackToPlay] = useState(false)
  // How many times someone has clicked a playlist or song they cannot yet play.
  // Counts rather than flags so that each click can start the glow on the
  // Connect Spotify button over again.
  const [invitations, setInvitations] = useState(0)
  // A song chosen before connecting is looked up again on the way back, and
  // until that answers there is nothing to play it with. Without this the
  // panel falls back to the board's saved playlist in the meantime — names it,
  // and starts it on Play — when the visitor asked for a song.
  const [restoringSong, setRestoringSong] = useState(false)

  // The music saved in the board is part of the board, and is shown to
  // whoever opens it, connected or not: someone who imports or is sent a board
  // has chosen its music along with it, and an empty panel reads as music
  // lost. Not connected, it is shown with the one step left to play it.
  const shownPlaylist = panelPlaylist
  const panelTrack = panel?.config.track ?? null
  const shownSong = spotify.selectedTrack ?? panelTrack

  // A different board has a different saved playlist, and nothing chosen in
  // the last one carries over to it.
  //
  // Only a change counts. React's development mode runs every effect twice when
  // a component mounts, and this one runs before the effects that give back
  // what the visitor was doing on the way back from Spotify: run again, it wiped
  // what they had just restored, and the context they read it from was already
  // used up. So it remembers which board it last saw and does nothing when the
  // board is the same.
  const lastBoardIdRef = useRef(boards.activeBoard?.id)
  useEffect(() => {
    if (lastBoardIdRef.current === boards.activeBoard?.id) return
    lastBoardIdRef.current = boards.activeBoard?.id
    setInvitations(0)
    setRestoringSong(false)
    // The "press play to start…" prompt is about what was chosen before leaving
    // for Spotify, in the board it was chosen in. Left standing, another board
    // would show it beside its own saved playlist: music nobody picked there.
    setCameBackToPlay(false)
  }, [boards.activeBoard?.id])

  // Whose is a context? It was read from this tab's own storage, but the page
  // that came back opens whichever board is active in storage shared by every
  // tab, and another tab may have opened a different one while this tab was at
  // Spotify. A context for another panel or board is not this panel's to
  // restore — its query and song would land in the wrong board. Whatever reads
  // one has already taken it, so one that is not ours is simply dropped.
  const isOurContext = (context: SpotifyReturnContext) =>
    context.panelId === panelId && (context.boardId === null || context.boardId === boards.activeBoard?.id)

  useEffect(() => {
    if (!connected) return
    const context = takeReturnContext()
    if (!context) return
    if (!isOurContext(context)) return
    setSearchType(context.searchType)
    setQuery(context.query)
    if (!context.choice) return
    setCameBackToPlay(true)
    const { choice } = context
    if (choice.kind === 'track') {
      setRestoringSong(true)
      void runRef.current(() => spotifyRef.current.lookupTrack(choice.spotifyId)).finally(() => setRestoringSong(false))
    }
  }, [connected])

  // A sign-in that comes back without succeeding — cancelled at Spotify,
  // refused, or a code that could not be exchanged — leaves the visitor here,
  // not connected, on a page that has reloaded: the search, its results and
  // what they had chosen are gone. Some of that can be given back, and is.
  //
  // The search text and type can. What they had chosen needs nothing: a
  // playlist or song is saved in the board as soon as it is clicked, and the
  // board's music is always shown.
  //
  // This waits to be told the sign-in failed rather than restoring whenever the
  // panel opens signed out, because a sign-in that is about to succeed also
  // opens signed out for a board, and must find its context still there.
  useEffect(() => {
    if (!spotify.signInFailed || connected) return
    const context = takeReturnContext()
    if (!context) return
    if (!isOurContext(context)) return
    setSearchType(context.searchType)
    setQuery(context.query)
  }, [spotify.signInFailed])

  // Once something is playing, or the session ends, the prompt has done its job
  // — and so has a song that was only being held until Play was pressed.
  useEffect(() => {
    if (spotify.track || !connected) setCameBackToPlay(false)
    if (spotify.track && spotify.selectedTrack) spotifyRef.current.selectTrack(null)
  }, [spotify.track, spotify.selectedTrack, connected])

  // Connected, there is nothing left to invite anyone to, and a later log-out
  // must not resurrect a glow for a click made in an earlier session.
  useEffect(() => {
    if (connected) setInvitations(0)
  }, [connected])

  // The menu entry that opens the link field is absent in the focus view and
  // when not connected, so the popover it opens goes with it rather than
  // outliving the only way back to it.
  const linkFieldOpen = isLinkFieldOpen && connected && !focusView
  const results = searchType === 'tracks' ? spotify.tracks : spotify.playlists
  const searchState: MusicSearchState = query.trim().length < minSearchLength
    ? 'waiting'
    : searching
      ? 'searching'
      : results.length === 0
        ? 'no-matches'
        : 'results'

  // What the panel shows -- what fills the middle, which one part names the
  // music, the one line about what to do next -- is decided in one place,
  // from these inputs, and only drawn here. See musicPanelView.ts.
  const view = musicPanelView({
    connected,
    focusView,
    momentView,
    searchCollapsed,
    searchState,
    suggestionCount: suggestionCards.length,
    playing: spotify.track,
    heldTrack: spotify.selectedTrack,
    boardTrack: panelTrack,
    boardPlaylist: panelPlaylist,
    cameBackToPlay,
    restoringSong,
    playerReady: spotify.isReady,
    sessionEnded: spotify.sessionEnded,
  })
  const searchHidden = !view.showSearch
  const chosen = view.chosen

  // The list is given whatever height the column has left over, which lands
  // mid-row as often as not and leaves a sliced playlist along the bottom
  // edge. Row height is fluid — the artwork and padding both scale with the
  // panel — so the whole number of rows that fits can only be measured, not
  // written down. Round the list down to that many. The suggestions are laid
  // out separately and deliberately stay outside this: they are a grid of
  // whole cards that is either there or not.
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
  }, [searchHidden, searchType, results.length, view.middle, view.nextStep])

  function resetFields() {
    setQuery('')
    setPlaylistUrl('')
    setLocalError(null)
    searchRef.current?.cancel()
    spotify.clearSearchResults()
    spotify.selectTrack(null)
    setInvitations(0)
  }

  // A new board starts this panel short. Using it makes room: typing, a
  // search or choice restored after coming back from Spotify, or being
  // connected already all mean the panel is in use.
  const inUse = query.trim() !== '' || chosen !== null || connected
  const { expandPanelFromStartingHeight } = commands
  useEffect(() => {
    if (inUse) expandPanelFromStartingHeight(panelId)
  }, [inUse, expandPanelFromStartingHeight, panelId])

  /**
   * Connecting Spotify. The only way to it in this panel, and the only time
   * anyone leaves the page: Spotify sends them straight back once they have
   * agreed, which is what makes it worth leaving for.
   */
  function connect() {
    // Grow now: the page is about to be left, and the panel should look the
    // same on return as the person left it.
    commands.expandPanelFromStartingHeight(panelId)
    posthog.capture('spotify_connect_clicked', { has_selection: chosen !== null })
    if (chosen || query.trim()) {
      // The crumbs that lead back to where they were: the search, and what they
      // had chosen. No token — only the words, a panel id and a public Spotify
      // id — and none of it is sent anywhere.
      rememberReturnContext({
        panelId,
        boardId: boards.activeBoard?.id ?? null,
        choice: chosen ? { kind: chosen.kind, spotifyId: chosen.id } : null,
        query,
        searchType,
      })
    } else {
      // Nothing to come back to, so nothing may be left over from an earlier
      // attempt: a sign-in that was cancelled or failed never read its context,
      // and it would be restored after this one, complete with a song the
      // visitor has since cleared.
      forgetReturnContext()
    }
    void run(spotify.login)
  }

  /**
   * A click on a playlist, wherever it is offered. This is the one place the
   * two kinds of visitor differ: someone connected asked for music and gets it,
   * exactly as before; someone who has not connected has it chosen for them,
   * and the panel then explains the one step left (see the selection card).
   */
  function choosePlaylist(playlist: SpotifyPlaylistSummary, source: 'search' | 'curated') {
    if (source === 'curated') posthog.capture('spotify_curated_playlist_selected', { authenticated: connected })
    if (!connected) {
      spotify.selectPlaylist(playlist, panelId)
      setInvitations((count) => count + 1)
      return
    }
    void run(async () => {
      await spotify.playPlaylist(playlist, panelId)
      posthog.capture('spotify_playlist_played', { source, authenticated: true })
    })
  }

  function chooseTrack(track: SpotifyTrackSummary) {
    if (!connected) {
      spotify.selectTrack(track, panelId)
      setInvitations((count) => count + 1)
      return
    }
    void run(() => spotify.playTrack(track, panelId))
  }

  // Someone has just clicked something that cannot be played until Spotify is
  // connected: the button that fixes that is where the eye should go next. It
  // follows the click, not the state — a playlist saved in the board, chosen
  // days ago, is not news, and a button that glows at every visit is noise.
  // The count is the key, so each new click starts the glow again.
  const invitingToConnect = !connected && chosen !== null && invitations > 0
  const connectButton = (
    <button
      key={invitingToConnect ? `invite-${invitations}` : 'connect'}
      className={`card-icon-button is-primary is-wide spotify-connect${invitingToConnect ? ' is-inviting' : ''}`}
      type="button"
      onClick={connect}
    >
      <LogIn size={18} />
      Connect Spotify
    </button>
  )

  return (
    <section className={`panel panel-spotify-surface${focusView && !momentView ? ' is-focus-view' : ''}${searchHidden ? ' is-search-hidden' : ''}${momentView && !view.music ? ' is-moment-empty' : ''}`}>
      <PanelHeader
        panelId={panelId}
        panelType="spotify"
        title="Music"
        menuItems={[
          // Pasting a link is how someone plays a playlist they already have
          // in hand, which is a rarer thing to arrive wanting than searching
          // for one. It waits here so the body holds a single way in.
          // What the search looks for is a setting, not something to decide on
          // every visit, so it lives here and the field gets the whole row. The
          // field's own placeholder says which is on.
          ...(!searchHidden ? [
            {
              id: 'search-playlists',
              label: 'Search for playlists',
              icon: <ListMusic size={17} aria-hidden="true" />,
              checked: searchType === 'playlists',
              onSelect: () => setSearchType('playlists'),
            },
            {
              id: 'search-songs',
              label: 'Search for songs',
              icon: <Music size={17} aria-hidden="true" />,
              checked: searchType === 'tracks',
              onSelect: () => setSearchType('tracks'),
            },
          ] : []),
          ...(connected && !focusView ? [{
            id: 'search-visibility',
            label: searchCollapsed ? 'Show the search' : 'Hide the search and show the artwork',
            icon: searchCollapsed ? <Search size={17} aria-hidden="true" /> : <Disc3 size={17} aria-hidden="true" />,
            checked: searchCollapsed,
            onSelect: () => setSearchCollapsed((current) => !current),
          }] : []),
          ...(connected && !focusView ? [{
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
        trailingMenuItems={connected ? [
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
                  posthog.capture('spotify_playlist_played', { source: 'link', authenticated: true })
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
        {view.connectOnly ? (
          /* The focus view is the panel at its smallest. Six suggestion cards
             are not what belongs in it: what it can usefully say is that
             playing needs Spotify. The footer already names the music. */
          <div className="spotify-focus-connect">
            <p className="muted">Not connected</p>
            {connectButton}
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        ) : (
          <>
            {view.showSearch ? (
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
                  <input
                    aria-label={searchType === 'tracks' ? 'Search songs' : 'Search playlists'}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={searchType === 'tracks' ? 'Search songs' : 'Search playlists'}
                  />
                </form>

                {/* Connected, these two tidy up after a search and the way
                    back to the artwork sits beside them. Not connected, the
                    second of the pair is the offer to connect: directly under
                    the search, so nobody has to choose a playlist to find it. */}
                <div className="spotify-search-actions">
                  <button className="card-icon-button is-wide spotify-reset-button" type="button" onClick={resetFields}>
                    <RotateCcw size={18} />
                    Reset fields
                  </button>
                  {connected ? (
                    <button className="card-icon-button is-wide" type="button" onClick={() => setSearchCollapsed(true)}>
                      <ChevronsDownUp size={18} />
                      Hide search
                    </button>
                  ) : connectButton}
                </div>
              </>
            ) : null}

            {/* Each of these has a key because they share one spot in the panel,
                and most are a plain div. Without keys React would reuse one
                element for all of them, and the height snapToWholeRows writes
                on the list would stay behind on whatever replaced it. The two
                lists share a key: that effect runs again when they swap. */}
            {view.middle === 'cover' ? (
              /* The music shown the way an album is: its cover large, the
                 words under it, the next step set apart below them. The same
                 with the search open or put away, connected or not. */
              <div key="cover" className="spotify-chosen is-featured" role={view.nextStep ? 'status' : undefined}>
                <div className="spotify-featured-cover">
                  {view.music?.image ? <img src={view.music.image} alt="" /> : <div className="album-frame-empty" />}
                </div>
                {view.namer === 'cover' && view.music ? (
                  <div className="track-copy">
                    <div className="track-title-row">
                      <p className="track-title">{view.music.title}</p>
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
                    <p className="track-meta">{view.music.meta}</p>
                  </div>
                ) : null}
                {view.nextStep ? <p className="spotify-chosen-note">{view.nextStep}</p> : null}
              </div>
            ) : view.middle === 'suggestions' ? (
              <section className="spotify-suggestions" aria-label="Suggested playlists">
                <h3 className="spotify-suggestions-heading">Suggested for this session</h3>
                <div className="spotify-suggestion-grid">
                  {suggestionCards.map((suggestion) => {
                    const isChosen = suggestion.id === shownPlaylist.id
                    return (
                      <button
                        className={isChosen ? 'suggestion-card is-current' : 'suggestion-card'}
                        type="button"
                        key={suggestion.id}
                        aria-pressed={isChosen}
                        disabled={busy}
                        onClick={() => choosePlaylist(suggestion, 'curated')}
                      >
                        {suggestion.image ? <img src={suggestion.image} alt="" /> : <div className="suggestion-card-art" />}
                        <strong>{suggestion.name}</strong>
                      </button>
                    )
                  })}
                </div>
                {/* Secondary on purpose: searching and connecting are what
                    this panel is for, and this only redeals the cards. */}
                <button
                  className="spotify-suggestions-shuffle"
                  type="button"
                  onClick={() => {
                    setSuggestions(shuffleSessionSuggestions())
                    posthog.capture('spotify_suggestions_shuffled')
                  }}
                >
                  <Shuffle size={15} aria-hidden="true" />
                  Shuffle suggestions
                </button>
              </section>
            ) : view.middle === 'results' && searchType === 'tracks' ? (
              <div key="results" ref={listRef} className="playlist-list" aria-label="Track search results">
                {spotify.tracks.map((track) => {
                  // Playback reports a track by its Spotify page, not its
                  // id, so that is what the playing row is recognised by.
                  const isPlaying = Boolean(spotify.track?.url && spotify.track.url === track.url)
                  const isChosen = isPlaying || spotify.selectedTrack?.id === track.id
                  return (
                    <button
                      className={isChosen ? 'playlist-option is-current' : 'playlist-option'}
                      type="button"
                      key={track.id}
                      aria-pressed={isChosen}
                      disabled={busy}
                      onClick={() => chooseTrack(track)}
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
              </div>
            ) : view.middle === 'results' ? (
              <div key="results" ref={listRef} className="playlist-list" aria-label="Playlist search results">
                {spotify.playlists.map((playlist) => {
                  const isChosen = playlist.id === shownPlaylist.id
                  return (
                    <button
                      className={isChosen ? 'playlist-option is-current' : 'playlist-option'}
                      type="button"
                      key={playlist.id}
                      aria-pressed={isChosen}
                      disabled={busy}
                      // Connected, this plays. Not connected, it chooses
                      // the playlist and never sends anyone to a login
                      // screen: see choosePlaylist.
                      onClick={() => choosePlaylist(playlist, 'search')}
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
              </div>
            ) : view.middle === 'empty' ? (
              /* Nothing chosen and nothing to suggest: one line on how to
                 start, rather than a blank panel that reads as broken. */
              <div key="empty" className="spotify-empty">
                <p className="muted">{`Search for a ${searchType === 'tracks' ? 'song' : 'playlist'} to play with this board.`}</p>
              </div>
            ) : null}

            {searchCollapsed && connected && !focusView && !momentView ? (
              /* Quiet on purpose: with the search put away the artwork leads,
                 and this is only the way back to choosing something else. It
                 says music, not playlist, because a song may be what is loaded. */
              <button className="spotify-show-search" type="button" onClick={() => setSearchCollapsed(false)}>
                <Search size={16} aria-hidden="true" />
                Find music
              </button>
            ) : null}

            {/* Away from the cover -- while searching -- the next step sits
                under the results, with the music in a small row above it when
                nothing else names it (not connected: there is no player). */}
            {view.middle !== 'cover' && (view.namer === 'row' || view.nextStep) ? (
              <div className="spotify-chosen" role={view.nextStep ? 'status' : undefined}>
                {view.namer === 'row' && view.music ? (
                  <div className="spotify-chosen-item">
                    {view.music.image ? <img src={view.music.image} alt="" /> : <div />}
                    <div className="track-copy">
                      <p className="track-title">{view.music.title}</p>
                      <p className="track-meta">{view.music.meta}</p>
                    </div>
                  </div>
                ) : null}
                {view.nextStep ? <p className="spotify-chosen-note">{view.nextStep}</p> : null}
              </div>
            ) : null}

            {view.showPlayer ? (
              <>
                {view.namer === 'player' && view.music ? (
                  <div className="track-copy">
                    <div className="track-title-row">
                      <p className="track-title">{view.music.title}</p>
                      {spotify.track?.url && !focusView ? (
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
                    <p className="track-meta">{view.music.meta}</p>
                  </div>
                ) : null}

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
                  <button
                    className="card-icon-button is-primary is-large"
                    type="button"
                    title="Play or pause"
                    disabled={restoringSong}
                    onClick={() => void run(async () => {
                      const wasPlaying = Boolean(spotify.track)
                      // A song picked before connecting is what Play is for
                      // until something is playing; otherwise it is the panel's
                      // playlist, or a pause.
                      if (!wasPlaying && spotify.selectedTrack) {
                        await spotify.playTrack(spotify.selectedTrack, panelId)
                        return
                      }
                      await spotify.togglePlay(panelId)
                      // The first press on a panel with nothing playing is
                      // what starts the chosen playlist; a pause is not a play.
                      if (!wasPlaying) posthog.capture('spotify_playlist_played', { source: 'search', authenticated: true })
                    })}
                  >
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
            ) : null}
          </>
        )}
      </div>

      <footer className="card-footer" {...panelContentProps}>
        <span className="card-footer-meta">{focusView ? loadedMusicLabel(shownSong, shownPlaylist.name) : shownSong?.name ?? shownPlaylist.name ?? 'No playlist loaded'}</span>
        <div className="card-footer-status">
          {/* In the focus view the text above is one left-aligned column, so
              the link to Spotify waits here rather than beside the title. */}
          {focusView && spotify.track?.url ? (
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
          {/* The panel is titled "Music", so the service is credited here instead —
              and it stays visible once connected, where the body no longer names it. */}
          <span className="card-footer-service">Spotify</span>
          {error ? (
            <span className="error-text">{error}</span>
          ) : (
            <span>{!connected ? 'Not connected' : spotify.isReady ? 'Ready' : spotify.status}</span>
          )}
        </div>
      </footer>
    </section>
  )
}

/**
 * The footer's line in the focus view, where it is the only place the loaded
 * music is named, so it says which kind it is.
 */
function loadedMusicLabel(song: { name: string } | null, playlistName: string | null) {
  if (song) return `Song: ${song.name}`
  if (playlistName) return `Playlist: ${playlistName}`
  return 'No playlist loaded'
}

/**
 * A curated entry Spotify would not describe. It is shown only when the file
 * gave it a name to fall back on; without one there is nothing to put on a
 * card, and the entry is skipped.
 */
function fallbackSuggestion(entry: CuratedSpotifyPlaylist): SpotifyPlaylistSummary | null {
  if (!entry.name) return null
  return {
    id: entry.id,
    name: entry.name,
    uri: `spotify:playlist:${entry.id}`,
    url: `https://open.spotify.com/playlist/${entry.id}`,
    image: null,
    owner: 'Spotify',
    trackCount: 0,
  }
}
