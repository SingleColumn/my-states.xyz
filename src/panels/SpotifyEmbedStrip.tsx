import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadSpotifyIframeApi, SpotifyEmbedSession, type SpotifyEmbedController } from '../spotifyEmbed'

export type SpotifyEmbedStatus = 'loading' | 'ready' | 'failed'

/** Spotify's own compact heights. Anything else is not a documented size. */
export type SpotifyEmbedHeight = 152 | 80

/**
 * Spotify's own embedded player, which plays all the Music panel's music.
 *
 * It lives inside the panel, not above the canvas: a player drawn over the
 * canvas covered the panel's menus and stayed on top of panels moved in front
 * of it (see project_docs/notes/drawbacks-spotify-embed.md).
 *
 * One controller for the life of this component. A new choice goes through
 * loadEntity on that controller, so typing, searching or resizing never
 * rebuilds the iframe or cuts the music. Unmounting destroys it, which is what
 * stops the music when the panel is deleted or the board has nothing to play --
 * unless the same panel draws the player again straight away (see keptPlayers).
 */
export function SpotifyEmbedStrip({
  keepAs,
  entity,
  height,
  hidden,
  onStatus,
  onInteract,
  onPlayingChange,
  onPlayedLength,
}: {
  /**
   * Which panel and player this is. A strip mounted with the same value
   * shortly after another unmounted takes over that player, still playing.
   */
  keepAs: { panelId: string; generation: number }
  entity: string
  height: SpotifyEmbedHeight
  /** Kept playing but not drawn: the screenshot view shows the cover instead. */
  hidden: boolean
  onStatus(status: SpotifyEmbedStatus): void
  /** The visitor clicked into Spotify's player. */
  onInteract(): void
  /** Whether Spotify reports sound playing, as far as it says. */
  onPlayingChange(playing: boolean): void
  /**
   * How long Spotify says the song playing lasts, in milliseconds. Spotify
   * only says so once play is pressed, and for a visitor who is not logged in
   * it gives the 30-second preview's length rather than the song's.
   */
  onPlayedLength?(milliseconds: number): void
}) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const entityRef = useRef(entity)
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const onInteractRef = useRef(onInteract)
  onInteractRef.current = onInteract
  const onPlayingRef = useRef(onPlayingChange)
  onPlayingRef.current = onPlayingChange
  const onPlayedLengthRef = useRef(onPlayedLength)
  onPlayedLengthRef.current = onPlayedLength
  const [status, setStatus] = useState<SpotifyEmbedStatus>('loading')

  const report = useCallback((next: SpotifyEmbedStatus) => {
    setStatus(next)
    onStatusRef.current(next)
  }, [])

  // What the player says goes to whichever strip is drawing it now, which
  // after a move between views is not the one that built it.
  const ownerRef = useRef<PlayerOwner>({ report, playing: () => {}, playedLength: () => {} })
  ownerRef.current = {
    report,
    playing: (playing) => onPlayingRef.current(playing),
    playedLength: (milliseconds) => onPlayedLengthRef.current?.(milliseconds),
  }

  const { panelId, generation } = keepAs
  // A layout effect, so that its clean-up runs while the panel is still in
  // the page: an ordinary effect's runs after React has removed it, and the
  // player, removed with it, has already reloaded.
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const kept = claimKeptPlayer(panelId, generation)
    if (kept) {
      // The same player, moved here without reloading: the music goes on.
      movePreservingState(frame, kept.holder)
      kept.owner = ownerRef
      entityRef.current = kept.entity
      report(kept.status)
      onPlayingRef.current(kept.playing)
    } else {
      const player = newKeptPlayer(panelId, generation, entityRef.current)
      frame.append(player.holder)
      player.owner = ownerRef
      report('loading')
      // Spotify replaces the element it is given with its own iframe, so it
      // gets a child of its own inside the holder, which is what moves.
      const host = document.createElement('div')
      player.holder.append(host)
      void loadSpotifyIframeApi()
        .then(async (api) => {
          if (player.released) return
          // Fills the frame, whose size follows the canvas zoom (see useCanvasZoom).
          player.session = new SpotifyEmbedSession(api, host, (controller) => listen(player, controller), '100%')
          await player.session.load(player.entity)
        })
        .catch(() => {
          if (!player.released) setStatusOf(player, 'failed')
        })
    }

    return () => {
      const player = keptPlayers.get(panelId)
      if (!player || player.owner !== ownerRef) return
      player.owner = null
      // Switching between the canvas and Editor mode draws the panel afresh,
      // in another part of the page. The player waits out of sight for a
      // moment, playing, for the new panel to take it over; if none does, the
      // panel is really gone and so is the music.
      if (canMoveWithoutReload()) {
        movePreservingState(parkingLot(), player.holder)
        player.releaseTimer = window.setTimeout(() => releaseKeptPlayer(player), keepPlayerMs)
      } else {
        releaseKeptPlayer(player)
      }
      onPlayingRef.current(false)
    }
    // Built once. The player fills its frame, so a change of size (a change of
    // view, or of zoom) needs no new player and never stops the music.
  }, [panelId, generation, report])

  useEffect(() => {
    if (entityRef.current === entity) return
    entityRef.current = entity
    const player = keptPlayers.get(panelId)
    if (!player || player.owner !== ownerRef) return
    player.entity = entity
    const session = player.session
    if (!session) return
    // A new board's music is chosen, not started: whatever was playing stops
    // here and waits for the visitor's own press of play.
    session.currentController?.pause()
    onPlayingRef.current(false)
    void session.load(entity).catch(() => report('failed'))
  }, [entity, panelId, report])

  // A click inside a cross-origin iframe never reaches this page as a click.
  // What does reach it is the window losing focus to that iframe, which is the
  // one sign this page gets that the visitor used Spotify's player.
  useEffect(() => {
    function handleBlur() {
      const active = document.activeElement
      if (active instanceof HTMLIFrameElement && frameRef.current?.contains(active)) onInteractRef.current()
    }
    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [])

  const stripRef = useRef<HTMLDivElement | null>(null)
  const sharp = sharpEmbedEnabled()
  const zoom = useCanvasZoom(stripRef, !hidden && sharp)
  // Spotify chooses its layout from the iframe's height in screen pixels, and
  // between its documented sizes it leaves part of the frame blank. So the
  // player is always exactly 152 or 80 screen pixels tall, whatever the zoom,
  // and the strip in the panel is sized to give it that. Zoomed out far enough
  // that 152 would take over the panel, it drops to the 80 strip.
  const screenHeight: SpotifyEmbedHeight = height === 80 || 152 * zoom < 116 ? 80 : 152
  const stripHeight = sharp ? screenHeight / zoom : height
  // The player's corner, in the panel's own pixels, handed to whatever frames
  // the player so that frame's corner can follow the same curve one padding
  // further out. The corner is 12 screen pixels at every zoom (see
  // .spotify-embed-frame), so in the panel's pixels it changes with the zoom.
  const playerRadius = sharp ? playerCornerPx / zoom : playerCornerPx
  useEffect(() => {
    const holder = stripRef.current?.parentElement
    if (!holder || hidden) return
    holder.style.setProperty('--spotify-player-radius', `${playerRadius}px`)
    return () => {
      holder.style.removeProperty('--spotify-player-radius')
    }
  }, [playerRadius, hidden])

  const frameStyle = !sharp || zoom === 1
    ? undefined
    : { width: `${100 * zoom}%`, height: screenHeight, transform: `scale(${1 / zoom})`, transformOrigin: '0 0' }

  return (
    <div ref={stripRef} className={`spotify-embed-strip${hidden ? ' is-hidden' : ''}`} style={{ height: stripHeight }} aria-hidden={hidden || undefined}>
      <div className="spotify-embed-frame" ref={frameRef} style={frameStyle} />
      {/* Not a status message: the panel's one line about what to do next is,
          and two of them would be read out over each other. */}
      {status === 'loading' ? <p className="spotify-embed-loading">Loading Spotify’s player…</p> : null}
    </div>
  )
}

interface PlayerOwner {
  report(status: SpotifyEmbedStatus): void
  playing(playing: boolean): void
  playedLength(milliseconds: number): void
}

/**
 * A Spotify player that can outlive the strip that built it, one per Music
 * panel. Moving an iframe in the page normally reloads it, which stops the
 * music; the newer moveBefore moves it as it is, still playing. Where a
 * browser has no moveBefore (Safari, for now), the player is not kept and a
 * change of view restarts it, as before.
 */
interface KeptPlayer {
  panelId: string
  generation: number
  /** Ours, holding Spotify's iframe: the one element that is moved. */
  holder: HTMLDivElement
  session: SpotifyEmbedSession | null
  /** What it was last asked to play, so a strip taking it over knows. */
  entity: string
  status: SpotifyEmbedStatus
  playing: boolean
  owner: { current: PlayerOwner } | null
  releaseTimer: number
  released: boolean
}

const keptPlayers = new Map<string, KeptPlayer>()

/** Long enough for the other view to draw the panel; short enough that a deleted panel's music stops at once. */
const keepPlayerMs = 400

function newKeptPlayer(panelId: string, generation: number, entity: string): KeptPlayer {
  // One player per panel: an older one (a new generation is a new player on
  // purpose) goes now.
  const older = keptPlayers.get(panelId)
  if (older) releaseKeptPlayer(older)
  const holder = document.createElement('div')
  holder.className = 'spotify-embed-holder'
  const player: KeptPlayer = { panelId, generation, holder, session: null, entity, status: 'loading', playing: false, owner: null, releaseTimer: 0, released: false }
  keptPlayers.set(panelId, player)
  return player
}

function claimKeptPlayer(panelId: string, generation: number): KeptPlayer | null {
  const player = keptPlayers.get(panelId)
  if (!player || player.owner || player.generation !== generation || !canMoveWithoutReload()) return null
  window.clearTimeout(player.releaseTimer)
  return player
}

function releaseKeptPlayer(player: KeptPlayer) {
  window.clearTimeout(player.releaseTimer)
  player.released = true
  player.session?.destroy()
  player.session = null
  player.holder.remove()
  if (keptPlayers.get(player.panelId) === player) keptPlayers.delete(player.panelId)
}

function listen(player: KeptPlayer, controller: SpotifyEmbedController) {
  controller.addListener('ready', () => setStatusOf(player, 'ready'))
  controller.addListener('playback_update', (event) => {
    const paused = event.data?.isPaused
    if (typeof paused === 'boolean') {
      player.playing = !paused
      player.owner?.current.playing(!paused)
    }
    // Only while playing: a paused player loaded with new music can still
    // report the length of what it played before.
    const length = event.data?.duration
    if (paused === false && typeof length === 'number' && length > 0) player.owner?.current.playedLength(length)
  })
}

function setStatusOf(player: KeptPlayer, status: SpotifyEmbedStatus) {
  player.status = status
  player.owner?.current.report(status)
}

type MovableParent = Element & { moveBefore?: (node: Node, before: Node | null) => void }

function canMoveWithoutReload() {
  return typeof (Element.prototype as MovableParent).moveBefore === 'function'
}

function movePreservingState(parent: Element, child: Element) {
  const move = (parent as MovableParent).moveBefore
  if (move) {
    try {
      move.call(parent, child, null)
      return
    } catch {
      // Not movable as it is (for one, if either end has left the page): an
      // ordinary move, which reloads the player, is the fallback.
    }
  }
  parent.append(child)
}

/** Where a kept player waits between views: in the page, so it keeps playing, but out of sight. */
let parking: HTMLDivElement | null = null
function parkingLot() {
  if (parking?.isConnected) return parking
  parking = document.createElement('div')
  parking.setAttribute('aria-hidden', 'true')
  // Off screen rather than display: none, which some browsers treat as a
  // reason to stop; sized like the player so Spotify keeps its layout.
  Object.assign(parking.style, { position: 'fixed', left: '-10000px', top: '0', width: '400px', height: '152px', pointerEvents: 'none' })
  document.body.append(parking)
  return parking
}

/** Spotify's own card corner, matched by .spotify-embed-frame in spotify.css. */
const playerCornerPx = 12

/**
 * Whether to draw the player at screen size. On by default; `?embed-sharp=0`
 * turns it off so the two can be compared side by side while this is a
 * prototype.
 */
function sharpEmbedEnabled() {
  try {
    return new URLSearchParams(window.location.search).get('embed-sharp') !== '0'
  } catch {
    return true
  }
}

/**
 * How much the canvas is scaling this element, read from the page rather than
 * from tldraw so it holds wherever the panel is drawn.
 *
 * The canvas zooms with a CSS transform, and Spotify's iframe is a page of its
 * own: scaled by its parent, it can be drawn at its own size and then
 * stretched, which is the blur seen in the first in-panel attempt (see
 * project_docs/notes/drawbacks-spotify-embed.md). Laying the iframe out at the
 * size it will appear on screen, and undoing the canvas zoom on it, leaves it
 * nothing to stretch. Spotify then sees a wider or narrower player as the
 * canvas zooms, which is the cost of this approach.
 *
 * A transform changes no size an observer watches, so this checks once a
 * frame, and waits for a zoom to settle before relaying out Spotify's page.
 */
function useCanvasZoom(ref: { current: HTMLElement | null }, enabled: boolean) {
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    if (!enabled) {
      setZoom(1)
      return
    }
    let frame = 0
    let settle = 0
    let pending = 1
    const check = () => {
      const element = ref.current
      if (element && element.offsetWidth > 0) {
        const measured = element.getBoundingClientRect().width / element.offsetWidth
        if (Math.abs(measured - pending) > 0.01) {
          pending = measured
          window.clearTimeout(settle)
          settle = window.setTimeout(() => setZoom(Math.round(pending * 1000) / 1000), 150)
        }
      }
      frame = window.requestAnimationFrame(check)
    }
    frame = window.requestAnimationFrame(check)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settle)
    }
  }, [enabled, ref])
  return zoom
}
