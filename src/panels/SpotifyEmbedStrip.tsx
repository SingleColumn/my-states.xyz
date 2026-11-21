import { useCallback, useEffect, useRef, useState } from 'react'
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
 * stops the music when the panel is deleted or the board has nothing to play.
 */
export function SpotifyEmbedStrip({
  entity,
  height,
  hidden,
  onStatus,
  onInteract,
  onPlayingChange,
  onPlayedLength,
}: {
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
  const sessionRef = useRef<SpotifyEmbedSession | null>(null)
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

  const configure = useCallback((controller: SpotifyEmbedController) => {
    controller.addListener('ready', () => report('ready'))
    controller.addListener('playback_update', (event) => {
      const paused = event.data?.isPaused
      if (typeof paused === 'boolean') onPlayingRef.current(!paused)
      // Only while playing: a paused player loaded with new music can still
      // report the length of what it played before.
      const length = event.data?.duration
      if (paused === false && typeof length === 'number' && length > 0) onPlayedLengthRef.current?.(length)
    })
  }, [report])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let active = true
    // Spotify replaces the element it is given with its own iframe, so it gets
    // a child of its own and the frame we style stays ours.
    const host = document.createElement('div')
    frame.append(host)
    report('loading')

    void loadSpotifyIframeApi()
      .then(async (api) => {
        if (!active) return
        // Fills the frame, whose size follows the canvas zoom (see useCanvasZoom).
        sessionRef.current = new SpotifyEmbedSession(api, host, configure, '100%')
        await sessionRef.current.load(entityRef.current)
      })
      .catch(() => {
        if (active) report('failed')
      })

    return () => {
      active = false
      onPlayingRef.current(false)
      sessionRef.current?.destroy()
      sessionRef.current = null
      frame.replaceChildren()
    }
    // Built once. The player fills its frame, so a change of size (a change of
    // view, or of zoom) needs no new player and never stops the music.
  }, [configure, report])

  useEffect(() => {
    if (entityRef.current === entity) return
    entityRef.current = entity
    const session = sessionRef.current
    if (!session) return
    // A new board's music is chosen, not started: whatever was playing stops
    // here and waits for the visitor's own press of play.
    session.currentController?.pause()
    onPlayingRef.current(false)
    void session.load(entity).catch(() => report('failed'))
  }, [entity, report])

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
