import { useEffect, useMemo, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import {
  ChevronsDownUp,
  Disc3,
  ExternalLink,
  RotateCcw,
  Search,
  Shuffle,
  X,
} from 'lucide-react'
import { useAppState } from '../AppState'
import { defaultSpotifyPlaylistReference } from '../storage'
import { debounce } from '../utils'
import type { DebouncedFunction } from '../utils'
import type { Panel } from '../types'
import type { SpotifyPlaylistSummary, SpotifyTrackSummary } from '../spotify'
import { fetchCuratedPlaylists } from '../spotifyCatalog'
import type { CuratedSpotifyPlaylist } from '../config/spotifyCuratedPlaylists'
import { getSessionSuggestions, shuffleSessionSuggestions } from '../spotifySuggestions'
import { PanelHeader, usePanelCommands } from '../PanelHeader'
import { useMomentView } from '../momentView'
import { usePanelSessionState } from '../panelSessionState'
import { musicPanelView, type MusicSearchState, type ReturnCheck } from './musicPanelView'
import { panelContentProps } from '../panelSurface'
import { SpotifyEmbedStrip } from './SpotifyEmbedStrip'
import { isPreviewNoticeHidden, previewNoticeVisit, SpotifyPreviewNotice } from './SpotifyPreviewNotice'

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
  // images: Spotify's player at its smallest, and the music's name.
  const focusView = panel?.focusView === true
  const momentView = useMomentView()
  // The choices below are kept per panel rather than in this copy of it, so
  // they survive a switch between the canvas and Editor mode (see
  // panelSessionState).
  const [query, setQuery] = usePanelSessionState(panelId, 'query', '')
  // A playlist is what this panel is for: it plays behind the images for as
  // long as someone is looking at them, where a single song stops after three
  // minutes. Songs stay available, but finding a playlist is the default step.
  const [searchType, setSearchType] = usePanelSessionState<SpotifySearchType>(panelId, 'search-type', 'playlists')
  // Putting the search away is what brings the artwork out: the panel shows
  // one or the other, never both, and the choice is the person's to make.
  const [searchCollapsed, setSearchCollapsed] = usePanelSessionState(panelId, 'search-collapsed', false)
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
          } else {
            await spotifyRef.current.searchPlaylists(text)
          }
          // One event for a search, for whichever kind. The words typed are
          // not sent.
          posthogRef.current?.capture('spotify_catalog_searched', {
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
  }, [query, searchType])

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
        // search field stays where it was.
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

  // Spotify's own player could not load (blocked, offline).
  const [embedFailed, setEmbedFailed] = useState(false)
  // Spotify's player can send the visitor to Spotify's site to log in, and
  // this page is told nothing about it: the click happens inside Spotify's
  // iframe. What it can see is the visitor using the player, this tab being
  // left, and the tab coming back with nothing playing. That is when it
  // welcomes them back, and rebuilds the player so a login made meanwhile has
  // a chance to count. The next press of play then shows whether it did.
  const [returnCheck, setReturnCheck] = useState<ReturnCheck | null>(null)
  // Whole songs heard in this visit: the visitor is logged in to Spotify, and
  // the panel stops offering the login.
  const [wholeSongs, setWholeSongs] = useState(() => visitPlayback.wholeSongs)
  const setSearchCollapsedRef = useRef(setSearchCollapsed)
  setSearchCollapsedRef.current = setSearchCollapsed
  const [embedGeneration, setEmbedGeneration] = useState(0)
  // What to expect from Spotify's player, said in a card the first time this
  // visit that someone chooses music, unless they asked not to see it. The
  // footer reopens it.
  const [noticeOpen, setNoticeOpen] = useState(false)
  const usedEmbedRef = useRef(false)
  const leftAfterUsingEmbedRef = useRef(false)
  const embedPlayingRef = useRef(false)

  // The music saved in the board is part of the board, and is shown to
  // whoever opens it: someone who imports or is sent a board has chosen its
  // music along with it, and an empty panel reads as music lost.
  const shownPlaylist = panelPlaylist
  const panelTrack = panel?.config.track ?? null
  const shownSong = spotify.selectedTrack ?? panelTrack

  // A different board has a different saved playlist, and nothing chosen in
  // the last one carries over to it.
  //
  // Only a change counts: React's development mode runs every effect twice when
  // a component mounts, so it remembers which board it last saw and does
  // nothing when the board is the same.
  const lastBoardIdRef = useRef(boards.activeBoard?.id)
  useEffect(() => {
    if (lastBoardIdRef.current === boards.activeBoard?.id) return
    lastBoardIdRef.current = boards.activeBoard?.id
    // "Welcome back" is about the music of the board it was said in.
    setReturnCheck(null)
    usedEmbedRef.current = false
    leftAfterUsingEmbedRef.current = false
  }, [boards.activeBoard?.id])

  // Leaving the tab after using Spotify's player, then coming back to it.
  // Coming back to music that is still playing says nothing and touches
  // nothing: the visitor only looked at another tab, and rebuilding the player
  // would cut the music off.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        if (usedEmbedRef.current) leftAfterUsingEmbedRef.current = true
        return
      }
      if (!leftAfterUsingEmbedRef.current) return
      leftAfterUsingEmbedRef.current = false
      if (embedPlayingRef.current) return
      usedEmbedRef.current = false
      setReturnCheck('waiting')
      // The results put away, so what to do next is the first thing seen,
      // beside the player it is about, rather than squeezed under a list.
      setSearchCollapsedRef.current(true)
      setEmbedGeneration((generation) => generation + 1)
      posthogRef.current?.capture('spotify_embed_returned')
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  // Spotify's login page, in a new tab so the board stays open behind it.
  // When the panel already has a player, leaving through this link counts as
  // using it: coming back then rebuilds the player, so the login can count,
  // and says what to do next.
  function leaveToLogIn() {
    if (embedEntity) usedEmbedRef.current = true
    posthogRef.current?.capture('spotify_login_link_opened')
  }

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
    focusView,
    momentView,
    searchCollapsed,
    searchState,
    suggestionCount: suggestionCards.length,
    heldTrack: spotify.selectedTrack,
    boardTrack: panelTrack,
    boardPlaylist: panelPlaylist,
    embedFailed,
    returnCheck,
    wholeSongs,
  })
  // What Spotify's player is given: the song if the board keeps one, else the
  // playlist. Both are public Spotify URIs.
  const embedEntity = shownSong?.uri ?? shownPlaylist.uri ?? null
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
      const listStyle = getComputedStyle(list)
      const gap = Number.parseFloat(listStyle.rowGap) || 0
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
      // Rounding down leaves up to a row over. It goes between the list and
      // Spotify's player (whose block takes the free space above it), never
      // above the list: there it read as a hole under the search, with the
      // results hanging below it.
    }

    snapToWholeRows()
    const observer = new ResizeObserver(snapToWholeRows)
    observer.observe(column)
    observer.observe(list)
    return () => observer.disconnect()
  }, [searchHidden, searchType, results.length, view.middle, view.nextStep])

  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // The × in the field: what was typed, and the results with it. The music
  // stays.
  function clearTyping() {
    setQuery('')
    setLocalError(null)
    setReturnCheck(null)
    searchInputRef.current?.focus()
  }

  // Back to how a new panel starts: nothing typed, nothing found, no music.
  // Undo in the top bar brings the music back, as for any other change to
  // the board.
  function resetPanel() {
    setQuery('')
    setLocalError(null)
    searchRef.current?.cancel()
    spotify.clearSearchResults()
    spotify.removeMusic(panelId)
    setReturnCheck(null)
    setSearchCollapsed(false)
  }

  // Going back to the search is moving on: the note about coming back from
  // Spotify goes, rather than squeezing in again between the results and
  // the player.
  function showSearchAgain() {
    setSearchCollapsed(false)
    setReturnCheck(null)
  }

  // Spotify gives a visitor who is not logged in a 30-second preview, and
  // says so only through the length it reports once play is pressed. A
  // little over 30 seconds leaves room for rounding; a real song that short
  // is rare, and would only bring the login link back.
  function notePlayedLength(milliseconds: number) {
    const whole = milliseconds > previewLengthLimitMs
    visitPlayback.wholeSongs = whole
    setWholeSongs(whole)
    setReturnCheck((current) => (current === null ? null : whole ? 'whole' : 'previews'))
    if (whole) posthogRef.current?.capture('spotify_whole_song_played')
  }

  // A new board starts this panel short. Using it makes room: typing or
  // music chosen both mean the panel is in use.
  const inUse = query.trim() !== '' || chosen !== null
  const { expandPanelFromStartingHeight } = commands
  useEffect(() => {
    if (inUse) expandPanelFromStartingHeight(panelId)
  }, [inUse, expandPanelFromStartingHeight, panelId])

  function explainPreviewsOnce() {
    setReturnCheck(null)
    // Whole songs already playing: there are no previews to explain.
    if (visitPlayback.wholeSongs) return
    if (previewNoticeVisit.shown || isPreviewNoticeHidden()) return
    previewNoticeVisit.shown = true
    setNoticeOpen(true)
  }

  /**
   * A click on a playlist, wherever it is offered. It is chosen, and Spotify's
   * own player below loads it, waiting for the visitor to press play.
   */
  function choosePlaylist(playlist: SpotifyPlaylistSummary, source: 'search' | 'curated') {
    if (source === 'curated') posthog.capture('spotify_curated_playlist_selected')
    spotify.selectPlaylist(playlist, panelId)
    explainPreviewsOnce()
  }

  function chooseTrack(track: SpotifyTrackSummary) {
    spotify.selectTrack(track, panelId)
    explainPreviewsOnce()
  }

  // The way to whole songs. In the body it always sits in one place, right
  // under Spotify's player, so it is found where it was last seen; the
  // footer's small print is only for where the body has no room. Gone once
  // whole songs play: the visitor is logged in.
  const loginLink = (
    <a className="spotify-login-link" href={SPOTIFY_LOGIN_URL} target="_blank" rel="noopener noreferrer" onClick={leaveToLogIn}>
      Log in to Spotify to hear whole songs
    </a>
  )
  // The line about Spotify's player goes with the player, above it. Only the
  // panel's own cover, shown when the player could not load, keeps it under
  // itself; the focus view keeps it in the footer.
  const noteWithPlayer = view.nextStep !== null && !focusView && view.middle !== 'cover'

  // The one action that goes with the line about Spotify's player, when there
  // is one: reload after a login elsewhere, or listen on Spotify itself when
  // its player cannot load here.
  const embedHelp = view.offerReload ? (
    <button className="card-icon-button is-wide spotify-embed-action" type="button" onClick={() => window.location.reload()}>
      <RotateCcw size={16} aria-hidden="true" />
      Reload page
    </button>
  ) : embedFailed && chosen?.url ? (
    <a className="card-icon-button is-wide spotify-embed-action" href={chosen.url} target="_blank" rel="noreferrer">
      <ExternalLink size={16} aria-hidden="true" />
      Open in Spotify
    </a>
  ) : null

  return (
    <section className={`panel panel-spotify-surface${focusView && !momentView ? ' is-focus-view' : ''}${searchHidden ? ' is-search-hidden' : ''}${momentView && !view.chosen ? ' is-moment-empty' : ''}${view.middle === 'player' ? ' is-player-middle' : ''}`}>
      <PanelHeader
        panelId={panelId}
        panelType="spotify"
        title="Music"
        // SPIKE: grouped like the Writing menu -- finding music, how the panel
        // looks, then the panel itself (focus view joins it, beside the other
        // sizes).
        menuSections={[{ heading: 'Find music', items: [
          // What the search looks for is a setting, not something to decide on
          // every visit, so it lives here and the field gets the whole row. The
          // field's own placeholder says which is on.
          ...(!searchHidden ? [{
            id: 'search-type',
            kind: 'choices' as const,
            label: 'Search for',
            icon: <Search size={17} aria-hidden="true" />,
            // The field below says what it now searches, so there is nothing
            // to compare with the menu open.
            closeOnSelect: true,
            options: [
              { id: 'playlists', label: 'Search for playlists', content: 'Playlists', checked: searchType === 'playlists', onSelect: () => setSearchType('playlists') },
              { id: 'songs', label: 'Search for songs', content: 'Songs', checked: searchType === 'tracks', onSelect: () => setSearchType('tracks') },
            ],
          }] : []),
        ] }, { heading: 'View', items: [
          // One name whether on or off, with a tick for on, so it is in the
          // same place under the same words every time it is looked for.
          ...(view.canPutSearchAway && !focusView ? [{
            id: 'search-visibility',
            label: 'Show the search',
            icon: <Disc3 size={17} aria-hidden="true" />,
            checked: !searchCollapsed,
            onSelect: () => (searchCollapsed ? showSearchAgain() : setSearchCollapsed(true)),
          }] : []),
          {
            id: 'focus-view',
            label: 'Focus view',
            icon: <ChevronsDownUp size={17} aria-hidden="true" />,
            checked: focusView,
            onSelect: () => commands.togglePanelFocusView(panelId),
          },
        ] }]}
      />

      <div className="panel-body" {...panelContentProps}>
        {view.showSearch ? (
          /* Results follow the typing, so the only thing left for Enter to
             do is skip the wait -- there is no button to press. */
          <form
            className="input-row spotify-search-row"
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              searchRef.current?.flush()
            }}
          >
            <input
              ref={searchInputRef}
              aria-label={searchType === 'tracks' ? 'Search songs' : 'Search playlists'}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setReturnCheck(null)
              }}
              placeholder={searchType === 'tracks' ? 'Search songs' : 'Search playlists'}
            />
            {/* Clears what was typed and nothing else, inside the field it
                belongs to. Reset panel, below, is the bigger step. */}
            {query !== '' ? (
              <button className="spotify-search-clear" type="button" onClick={clearTyping} aria-label="Clear what you typed" title="Clear what you typed">
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </form>
        ) : null}

        {view.showSearchActions ? (
          /* Once there is music: start over, or put the search away and
             leave Spotify's player. Two halves, so neither looks like the
             more important one. */
          <div className="spotify-search-actions">
            <button className="card-icon-button is-wide spotify-reset-button" type="button" onClick={resetPanel} title="Clears the search and takes the music off the board. Undo brings it back.">
              <RotateCcw size={18} />
              Reset panel
            </button>
            <button className="card-icon-button is-wide" type="button" onClick={() => setSearchCollapsed(true)}>
              <ChevronsDownUp size={18} />
              Hide search
            </button>
          </div>
        ) : null}

        {searchCollapsed && view.canPutSearchAway && !focusView && !momentView ? (
          /* Quiet on purpose: with the search put away the music leads, and
             this is only the way back to choosing something else. It says
             music, not playlist, because a song may be what is loaded. */
          <button className="spotify-show-search" type="button" onClick={showSearchAgain}>
            <Search size={16} aria-hidden="true" />
            Find music
          </button>
        ) : null}

        {/* Each of these has a key because they share one spot in the panel,
            and most are a plain div. Without keys React would reuse one
            element for all of them, and the height snapToWholeRows writes
            on the list would stay behind on whatever replaced it. The two
            lists share a key: that effect runs again when they swap. */}
        {view.middle === 'cover' ? (
          /* The music shown the way an album is, where Spotify's player is
             not there to show it: in a moment, or when the player could not
             load. */
          <div key="cover" className="spotify-chosen is-featured" role={view.nextStep ? 'status' : undefined}>
            <div className="spotify-featured-cover">
              {view.chosen?.image ? <img src={view.chosen.image} alt="" /> : <div className="album-frame-empty" />}
            </div>
            {view.namer === 'cover' && view.chosen ? (
              <div className="track-copy">
                <p className="track-title">{view.chosen.title}</p>
                <p className="track-meta">{view.chosen.meta}</p>
              </div>
            ) : null}
            {view.nextStep ? <p className="spotify-chosen-note">{view.nextStep}</p> : null}
            {embedHelp}
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
            {/* Secondary on purpose: searching is what this panel is for,
                and this only redeals the cards. */}
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
              const isChosen = spotify.selectedTrack?.id === track.id
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
                  // Chooses the playlist; Spotify's player loads it.
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
            {view.login === 'body' ? loginLink : null}
          </div>
        ) : null}

        {focusView && !momentView && !chosen ? (
          /* The focus view has no search, so with nothing chosen it would be
             an empty box. Say so, and offer the way back to the search. */
          <div key="focus-empty" className="spotify-empty spotify-focus-empty">
            <p className="muted">No music chosen yet.</p>
            <button className="card-icon-button is-wide" type="button" onClick={() => commands.togglePanelFocusView(panelId)}>
              <Search size={16} aria-hidden="true" />
              Find music
            </button>
          </div>
        ) : null}

        {/* Spotify's player with what goes with it: the line about it above,
            the way to log in under it. One block in one place in every view,
            so the player never jumps and the login is always found under it.
            It is always drawn, even empty, so that a change of view never
            moves the player in the page, which would restart it. */}
        <div className="spotify-player-block" role={noteWithPlayer ? 'status' : undefined}>
          {noteWithPlayer ? <p className="spotify-chosen-note">{view.nextStep}</p> : null}
          {noteWithPlayer ? embedHelp : null}
          {view.embed && embedEntity ? (
            <SpotifyEmbedStrip
              // A new key is a new player: how the panel picks up a Spotify
              // login made in another tab while the visitor was away.
              key={embedGeneration}
              entity={embedEntity}
              height={view.embed.height}
              hidden={view.embed.hidden}
              onStatus={(status) => {
                if (status === 'failed') setEmbedFailed(true)
              }}
              onInteract={() => {
                usedEmbedRef.current = true
              }}
              onPlayingChange={(playing) => {
                embedPlayingRef.current = playing
              }}
              onPlayedLength={notePlayedLength}
            />
          ) : null}
          {view.login === 'body' && view.embed && !view.embed.hidden ? loginLink : null}
        </div>

      </div>

      <footer className="card-footer" {...panelContentProps}>
        <span className="card-footer-meta" role={focusView && view.nextStep ? 'status' : undefined}>
          {focusView ? view.nextStep ?? loadedMusicLabel(shownSong, shownPlaylist.name) : shownSong?.name ?? shownPlaylist.name ?? 'No playlist loaded'}
        </span>
        <div className="card-footer-status">
          {focusView ? embedHelp : null}
          {/* The panel is titled "Music", so the service is credited here instead. */}
          <span className="card-footer-service">Spotify</span>
          {error ? (
            <span className="error-text">{error}</span>
          ) : (focusView && view.nextStep) || wholeSongs ? null : (
            <>
              <button className="spotify-footer-link" type="button" onClick={() => setNoticeOpen(true)} title="What to expect from Spotify's player">
                Previews without a login
              </button>
              {/* Only where the body has no room for it: the focus view, and
                  the suggestions or results before anything is chosen. */}
              {view.login === 'footer' ? (
                <a className="spotify-footer-link" href={SPOTIFY_LOGIN_URL} target="_blank" rel="noopener noreferrer" onClick={leaveToLogIn} title="Opens Spotify's login page in a new tab">
                  Log in to Spotify
                </a>
              ) : null}
            </>
          )}
        </div>
      </footer>
      {noticeOpen ? <SpotifyPreviewNotice onClose={() => setNoticeOpen(false)} loginUrl={SPOTIFY_LOGIN_URL} onLogIn={leaveToLogIn} /> : null}
    </section>
  )
}

/** Spotify's own login page. my-states never sees the login itself. */
const SPOTIFY_LOGIN_URL = 'https://accounts.spotify.com/login'

/**
 * Longest length Spotify reports for a preview. Measured: 29,713 ms for a
 * preview of a 4:49 song, for a visitor not logged in.
 */
const previewLengthLimitMs = 31_000

/**
 * What this visit has learned from Spotify's player, kept outside any one
 * copy of the panel so a second Music panel, or the same one redrawn in
 * Editor mode, does not offer a login the visitor already has.
 */
export const visitPlayback = { wholeSongs: false }

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
