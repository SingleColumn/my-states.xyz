import { ChevronsDownUp, ChevronsUpDown, EyeOff, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useEditor, useValue, type Editor } from 'tldraw'
import { useAppState } from '../AppState'
import { fitEditorToBounds, getChromeAwareInsets, getPanelBounds } from '../canvasView'
import { PanelCommandsProvider, usePanelCommands, type PanelCommands, type PanelMenuItem } from '../PanelHeader'
import { panelComponents } from '../PanelShape'
import { isTextInputTarget } from '../panelSurface'
import { getPanelFocusViewSize } from '../panelLayout'
import type { PanelType } from '../types'
import { getSpikeSnapshot, spikeState } from './spikeFlag'

/**
 * SPIKES S1 to S3, throwaway.
 *
 * S1: does a layer in tldraw's InFrontOfTheCanvas slot sit below the toolbar
 * and look the same as the canvas. S2 and S3: with the canvas hidden, do
 * tldraw's keyboard shortcuts, the app's Delete key and paste still act on
 * the canvas, and do the guards in the plan (§7.8) stop them.
 *
 * Since S3 it can also be tried by hand. The Writing page fills the screen
 * and the other panels float over it as windows that can be selected, moved,
 * resized and minimised to their header. A window always stays wholly on
 * screen. Places are kept in this browser only (`mic:spike-windows`);
 * nothing is written to the board.
 *
 * While Editor mode is on, every canvas shape draws nothing (PanelShape.tsx)
 * so no panel is mounted twice.
 */

/**
 * Editor mode draws its panels at the zoom the canvas was left at, so text,
 * borders and spacing keep the size they had a moment ago and the two modes
 * feel like one app. Held to a readable range: at 30% the panels' text is
 * too small to write in, and at 200% a page would hold a few words a line.
 * The same limits as the header menus (PanelHeader).
 */
const EDITOR_ZOOM_MIN = 0.7
const EDITOR_ZOOM_MAX = 1.25
const clampEditorZoom = (zoom: number) => Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, zoom))

interface Rect { x: number; y: number; w: number; h: number; minimised?: boolean }
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
interface Size { width: number; height: number }

const WINDOWS_KEY = 'mic:spike-windows'
const MIN_W = 260
const MIN_H = 180
const GAP = 16
// New windows are narrow so the page keeps the middle of the screen: a
// share of the width, held between these.
const COLUMN_W_MIN = 300
const COLUMN_W_MAX = 380
const COLUMN_W_SHARE = 0.22
// A press on a minimised header that moves less than this is a click, which
// opens the window again; more is a drag.
const CLICK_SLOP = 4
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
// A minimised window keeps its side and bottom edges. The sides change its
// width; pulling the bottom down opens it to that height. The top edge is
// left out: on a bar this thin it would sit on the header people drag by.
const MINIMISED_EDGES: Edge[] = ['s', 'e', 'w', 'se', 'sw']
// How far the bottom edge of a minimised window must be pulled before it
// opens, so a slip of the hand does not open it at the minimum height.
const OPEN_PULL = 12

export function SpikeEditorLayer() {
  const { panels } = useAppState()
  const outer = usePanelCommands()
  const editor = useEditor()
  const spike = useSyncExternalStore(spikeState.subscribe, getSpikeSnapshot)

  // Console access for the spike only.
  useEffect(() => {
    ;(window as unknown as { __spike: unknown }).__spike = { editor, set: spikeState.set, get: spikeState.get }
  }, [editor])

  useHiddenCanvasGuards(editor, spike.editorMode && spike.guards)

  // Editor mode is its own full-screen view, so a panel left expanded on the
  // canvas is put back to its previous size. Otherwise the canvas keeps that
  // state through Editor mode (the flush toolbar, the remembered board) and
  // the panel fills the screen again on the way back. Re-checked whenever
  // the app's commands change, because a board can open already expanded
  // after this layer has mounted. Not while the board is read-only, as it is
  // while a board is being restored: tldraw drops the size change then, and
  // the panel would stay full size with nothing left to say so.
  const isReadonly = useValue('canvas is read-only', () => editor.getInstanceState().isReadonly, [editor])
  useEffect(() => {
    if (!spike.editorMode || isReadonly) return
    // After the current update, not during it: React runs this layer's
    // effects before the app's, and in the update where the app restores a
    // remembered full screen, its own effect then lays the panel out at full
    // size again, undoing the change made here.
    const timer = setTimeout(() => {
      for (const panel of panels.all) {
        if (outer.isPanelFullScreen(panel.id)) outer.togglePanelFullScreen(panel.id)
      }
    })
    return () => clearTimeout(timer)
  }, [spike.editorMode, isReadonly, outer, panels.all])

  // Coming back to the canvas, frame every panel. The camera has stood still
  // through Editor mode, at wherever the board last left it, which can be
  // past the panels; then the Writing ⋯ menu, the way back into Editor mode,
  // is off screen. Waits a frame so the top bar is floating again before
  // it is measured.
  const wasEditorMode = useRef(spike.editorMode)
  useEffect(() => {
    const leaving = wasEditorMode.current && !spike.editorMode
    wasEditorMode.current = spike.editorMode
    if (!leaving) return
    const frame = requestAnimationFrame(() => {
      const viewport = editor.getViewportScreenBounds()
      const chromeBottom = document.querySelector('.app-chrome')?.getBoundingClientRect().bottom
      fitEditorToBounds(editor, getPanelBounds(editor), getChromeAwareInsets(chromeBottom, { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h }))
    })
    return () => cancelAnimationFrame(frame)
  }, [spike.editorMode, editor])

  // The camera stands still through Editor mode, so this is read once per
  // visit; reading it as a value keeps it right if the board changes.
  const zoom = clampEditorZoom(useValue('editor-zoom', () => editor.getZoomLevel(), [editor]))

  if (!spike.editorMode) return null

  const visible = panels.all.filter((panel) => panel.visible)
  const host = visible.find((panel) => panel.type === 'notes')
  const others = visible.filter((panel) => panel.type === 'slideshow' || panel.type === 'spotify')

  return <Windows outer={outer} zoom={zoom} hostId={host?.id} windows={others.map((panel) => ({ id: panel.id, type: panel.type, focusView: panel.focusView }))} />
}

function Windows({ outer, zoom, hostId, windows }: { outer: PanelCommands; zoom: number; hostId?: string; windows: Array<{ id: string; type: PanelType; focusView: boolean }> }) {
  const layerRef = useRef<HTMLDivElement>(null)
  // Windows live in an area below the Writing page's header bar, so they can
  // never cover its buttons (its ⋯ menu sits right where a new window goes).
  // All window positions and screen limits are measured in this area.
  const areaRef = useRef<HTMLDivElement>(null)
  const [pageHeaderHeight, setPageHeaderHeight] = useState(0)
  // The page's footer (word count) is kept clear too: windows float between
  // the header and the footer, not over either.
  const [pageFooterHeight, setPageFooterHeight] = useState(0)
  const [rects, setRects] = useState<Record<string, Rect>>(readSavedRects)
  const [order, setOrder] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [layer, setLayer] = useState<Size>(() => layerSize(null))
  const rectsRef = useRef(rects)
  rectsRef.current = rects

  useLayoutEffect(() => {
    const element = areaRef.current
    if (!element) return
    // Read once now as well: the observer's first report waits for a frame
    // to be drawn, and a hidden tab may not draw one.
    setLayer(layerSize(element))
    const observer = new ResizeObserver(() => setLayer(layerSize(element)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const header = layerRef.current?.querySelector<HTMLElement>('.spike-page .card-header')
    const footer = layerRef.current?.querySelector<HTMLElement>('.spike-page .card-footer')
    if (!header) {
      setPageHeaderHeight(0)
      setPageFooterHeight(0)
      return
    }
    // Drawn height, so the page's zoom is counted.
    const measure = () => {
      setPageHeaderHeight(header.getBoundingClientRect().height)
      setPageFooterHeight(footer?.getBoundingClientRect().height ?? 0)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    if (footer) observer.observe(footer)
    return () => observer.disconnect()
  }, [hostId])

  // The area shrinks when the header is measured; read its new size at once
  // rather than waiting for the observer, which a hidden tab may not run.
  useLayoutEffect(() => {
    if (areaRef.current) setLayer(layerSize(areaRef.current))
  }, [pageHeaderHeight, pageFooterHeight])

  // Header menus are drawn into this layer, above the page and every window
  // (see `menuLayer` in PanelHeader). State, not a ref, so the menus get it
  // once it exists.
  const [menuLayer, setMenuLayer] = useState<HTMLDivElement | null>(null)

  // How tall each minimised window draws (its header, which depends on the
  // theme). Measured before paint, so the first frame is already in place.
  const [headerHeights, setHeaderHeights] = useState<Record<string, number>>({})
  useLayoutEffect(() => {
    const measured: Record<string, number> = {}
    layerRef.current?.querySelectorAll<HTMLElement>('.spike-window.is-minimised').forEach((element) => {
      measured[element.dataset.spikeWindow!] = element.offsetHeight
    })
    const changed = Object.keys(measured).some((id) => measured[id] !== headerHeights[id])
    if (changed) setHeaderHeights((current) => ({ ...current, ...measured }))
  })

  // A window with no saved place goes into a column down one side, the first
  // on the left, the next on the right, and so on, so each side has one and
  // the page stays clear between them. A side with more than one shares its
  // height between them.
  const windowIds = windows.map((window) => window.id).join(',')
  useLayoutEffect(() => {
    const missing = windows.filter((window) => !rectsRef.current[window.id])
    if (missing.length === 0) return
    // The area below the page's header is smaller once that header is
    // measured; placing before then would size the windows for a taller area.
    if (hostId && pageHeaderHeight === 0) return
    const { width, height } = layerSize(areaRef.current)
    const columnW = Math.round(Math.min(COLUMN_W_MAX, Math.max(COLUMN_W_MIN, width * COLUMN_W_SHARE)))
    // Windows already placed count towards a side, so a window added later
    // goes where there is room rather than on top of one.
    const sides: Record<'left' | 'right', string[]> = { left: [], right: [] }
    windows.forEach((window) => {
      const rect = rectsRef.current[window.id]
      if (rect) sides[rect.x + rect.w / 2 < width / 2 ? 'left' : 'right'].push(window.id)
    })
    const added: Record<string, 'left' | 'right'> = {}
    missing.forEach((window) => {
      const side = sides.left.length <= sides.right.length ? 'left' : 'right'
      sides[side].push(window.id)
      added[window.id] = side
    })
    updateRects((current) => {
      const next = { ...current }
      for (const side of ['left', 'right'] as const) {
        const count = sides[side].length
        const h = Math.max(MIN_H, (height - GAP * (count + 1)) / count)
        sides[side].forEach((id, index) => {
          // Only the new ones are placed; the others keep their own place.
          if (!added[id]) return
          next[id] = { x: side === 'left' ? GAP : width - GAP - columnW, y: GAP + index * (h + GAP), w: columnW, h }
        })
      }
      return next
    })
  }, [windowIds, pageHeaderHeight]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape, or a press outside any window, clears the selection, as on the canvas.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelected(null)
    }
    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Element) || !event.target.closest('[data-spike-window]')) setSelected(null)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])

  // Keeps the ref current at once, so a save straight after an update
  // (minimise, then reload) writes what is on screen.
  function updateRects(change: (current: Record<string, Rect>) => Record<string, Rect>, save = false) {
    const next = change(rectsRef.current)
    rectsRef.current = next
    setRects(next)
    if (save) saveRects(next)
  }

  function bringToFront(id: string) {
    setSelected(id)
    setOrder((current) => [...current.filter((other) => other !== id), id])
  }

  // In focus view a panel with a size of its own (Music) is drawn at that
  // size, as on the canvas, where it is a size in canvas units and so scales
  // with the zoom. The saved size is left alone and comes back when focus
  // view is left.
  function focusViewSize(id: string) {
    const window = windows.find((candidate) => candidate.id === id)
    return window?.focusView ? getPanelFocusViewSize(window.type) : null
  }

  function drawnSize(id: string, saved: Rect): Rect {
    const focusSize = focusViewSize(id)
    return focusSize ? { ...saved, w: focusSize.w * zoom, h: focusSize.h * zoom } : saved
  }

  function setMinimised(id: string, minimised: boolean) {
    updateRects((current) => ({ ...current, [id]: { ...current[id], minimised } }), true)
  }

  // One gesture: the rect the window had when the press began, and how the
  // pointer's travel changes it. Listening on window keeps the gesture alive
  // when the pointer outruns the window.
  function startGesture(event: ReactPointerEvent<HTMLElement>, id: string, edge: Edge | 'move') {
    event.preventDefault()
    event.stopPropagation()
    // A minimised window is only as tall as its header; that is what has to
    // stay on screen.
    const startHeight = event.currentTarget.offsetHeight
    // The gesture starts from the window as it is drawn. In focus view that
    // is a short Music panel, which may sit lower than its full saved height
    // would fit; starting from the saved height pulled it up at the first move.
    const saved = rectsRef.current[id]
    const start = shown(drawnSize(id, saved), layerSize(areaRef.current), startHeight)
    const keepsSavedSize = focusViewSize(id) !== null
    const origin = { x: event.clientX, y: event.clientY }
    const bounds = layerSize(areaRef.current)
    const wasMinimised = !!start.minimised
    let travelled = 0
    document.documentElement.dataset.spikeGesture = edge === 'move' ? 'move' : `${edge}-resize`

    function onMove(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - origin.x
      const dy = moveEvent.clientY - origin.y
      travelled = Math.max(travelled, Math.hypot(dx, dy))
      const next = applyGesture(start, startHeight, edge, dx, dy, bounds)
      // Moving a focus-view window changes only its place; the saved size is
      // the one it returns to when focus view is left.
      updateRects((current) => ({ ...current, [id]: keepsSavedSize ? { ...saved, x: next.x, y: next.y } : next }))
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      delete document.documentElement.dataset.spikeGesture
      if (edge === 'move' && wasMinimised && travelled < CLICK_SLOP) setMinimised(id, false)
      else saveRects(rectsRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // Every press on a window selects it and brings it to the front. A press on
  // the header's own space (its title, not its buttons) starts a move.
  function onWindowPointerDown(event: ReactPointerEvent<HTMLElement>, id: string) {
    if (event.button !== 0) return
    bringToFront(id)
    const target = event.target as Element
    const edge = target.closest<HTMLElement>('[data-spike-edge]')?.dataset.spikeEdge as Edge | undefined
    if (edge) {
      startGesture(event, id, edge)
      return
    }
    const header = target.closest('.card-header')
    const onControl = target.closest('button, a, input, select, textarea, [role="menu"], [contenteditable="true"], .card-header-actions')
    if (header && !onControl) startGesture(event, id, 'move')
  }

  const commands: PanelCommands = {
    ...outer,
    menuLayer,
    // A window here has its own size, not the canvas shape's; changing the
    // shape's height would resize something nobody can see.
    setPanelHeight: undefined,
    // The page reports itself as full screen so the Writing panel shows its
    // page treatment (paper width, zoom, toolbar toggle); nothing is resized.
    isPanelFullScreen: (panelId) => panelId === hostId,
    windowMenuItems: (panelId) => {
      // The page is the document being written, not a window: it cannot be
      // minimised, and hiding or deleting it would leave an empty screen.
      // So it has no panel actions; the switch back to the canvas is in the
      // top toolbar.
      if (panelId === hostId) return []
      const rect = rects[panelId]
      if (!rect) return undefined
      return [
        rect.minimised
          ? { id: 'restore', label: 'Open window', icon: <ChevronsUpDown size={17} aria-hidden="true" />, onSelect: () => setMinimised(panelId, false) }
          : { id: 'minimise', label: 'Minimise window', icon: <ChevronsDownUp size={17} aria-hidden="true" />, onSelect: () => setMinimised(panelId, true) },
        { id: 'hide', label: 'Hide panel', icon: <EyeOff size={17} aria-hidden="true" />, onSelect: () => outer.hidePanel(panelId) },
        { id: 'delete', label: 'Delete panel', icon: <Trash2 size={17} aria-hidden="true" />, destructive: true, onSelect: () => outer.deletePanel(panelId) },
      ] satisfies PanelMenuItem[]
    },
  }

  return (
    <PanelCommandsProvider commands={commands}>
      <div ref={layerRef} className="spike-editor-layer" data-testid="spike-editor-layer">
        {hostId ? (
          <div className="spike-page">
            <Frame type="notes" panelId={hostId} fullScreen zoom={zoom} style={{ position: 'absolute', inset: 0 }} />
          </div>
        ) : null}
        <div ref={areaRef} className="spike-window-area" style={{ top: pageHeaderHeight, bottom: pageFooterHeight }}>
        {windows.map((window) => {
          const saved = rects[window.id]
          if (!saved) return null
          // Drawn inside the screen as it is now, so a window placed on a
          // larger screen, or before the browser was made smaller, is still
          // wholly visible. The saved place is left alone.
          const focusSize = focusViewSize(window.id)
          const rect = shown(drawnSize(window.id, saved), layer, headerHeights[window.id])
          const isSelected = selected === window.id
          const style: CSSProperties = {
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.minimised ? undefined : rect.h,
            zIndex: 2 + order.indexOf(window.id),
          }
          return (
            <div
              key={window.id}
              className={`spike-window${isSelected ? ' is-selected' : ''}${rect.minimised ? ' is-minimised' : ''}`}
              data-spike-window={window.id}
              style={style}
              onPointerDownCapture={(event) => onWindowPointerDown(event, window.id)}
            >
              <Frame type={window.type} panelId={window.id} zoom={zoom} style={{ position: 'absolute', inset: 0 }} />
              {/* No edges in a fixed-size focus view: dragging one would change a size that is not shown. */}
              {(focusSize ? [] : rect.minimised ? MINIMISED_EDGES : EDGES).map((edge) => <div key={edge} className={`spike-edge spike-edge-${edge}`} data-spike-edge={edge} />)}
            </div>
          )
        })}
        </div>
        <div ref={setMenuLayer} className="spike-menu-layer" />
      </div>
    </PanelCommandsProvider>
  )
}

/**
 * A rect fitted inside the screen: no larger than it, and wholly on it. A
 * minimised window is only as tall as its header, so that is what is kept
 * on screen; opening it again moves it up just enough to fit.
 */
function shown(rect: Rect, bounds: Size, headerHeight = 0): Rect {
  const w = Math.min(rect.w, bounds.width)
  const h = Math.min(rect.h, bounds.height)
  const visibleHeight = rect.minimised ? headerHeight : h
  return { ...rect, w, h, x: clamp(rect.x, 0, bounds.width - w), y: clamp(rect.y, 0, bounds.height - visibleHeight) }
}

function applyGesture(start: Rect, startHeight: number, edge: Edge | 'move', dx: number, dy: number, bounds: Size): Rect {
  if (edge === 'move') {
    // A minimised window is stopped by its header, so it can sit at the very
    // bottom; opening it again moves it up just enough to fit (see `shown`).
    return {
      ...start,
      x: clamp(start.x + dx, 0, bounds.width - start.w),
      y: clamp(start.y + dy, 0, bounds.height - startHeight),
    }
  }
  if (start.minimised) {
    let { x, w } = start
    if (edge.includes('e')) w = clamp(start.w + dx, MIN_W, bounds.width - start.x)
    if (edge.includes('w')) {
      x = clamp(start.x + dx, 0, start.x + start.w - MIN_W)
      w = start.x + start.w - x
    }
    if (edge.includes('s') && dy > OPEN_PULL) {
      // Opens from the header's own height downward, so the bottom edge
      // follows the pointer as on an open window.
      const h = clamp(startHeight + dy, MIN_H, bounds.height - start.y)
      return { ...start, x, w, h, minimised: false }
    }
    return { ...start, x, w }
  }
  const right = start.x + start.w
  const bottom = start.y + start.h
  let { x, y, w, h } = start
  // Each edge moves on its own and stops at the screen's edge; the minimum
  // size stops it before it passes the opposite edge.
  if (edge.includes('e')) w = clamp(start.w + dx, MIN_W, bounds.width - start.x)
  if (edge.includes('s')) h = clamp(start.h + dy, MIN_H, bounds.height - start.y)
  if (edge.includes('w')) {
    x = clamp(start.x + dx, 0, right - MIN_W)
    w = right - x
  }
  if (edge.includes('n')) {
    y = clamp(start.y + dy, 0, bottom - MIN_H)
    h = bottom - y
  }
  return { ...start, x, y, w, h }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

// The pane may be hidden while the page loads, which gives the layer no size;
// the window size is close enough for a first placement.
function layerSize(layer: HTMLElement | null): Size {
  const width = layer?.clientWidth || window.innerWidth || 1280
  const height = layer?.clientHeight || window.innerHeight || 800
  return { width, height }
}

function readSavedRects(): Record<string, Rect> {
  try {
    return JSON.parse(localStorage.getItem(WINDOWS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveRects(rects: Record<string, Rect>) {
  try {
    localStorage.setItem(WINDOWS_KEY, JSON.stringify(rects))
  } catch {
    // Places are a convenience; losing them only resets the column.
  }
}

/**
 * The guards from the plan (§7.8), applied while Editor mode is showing.
 *
 * tldraw binds its tool and action shortcuts, its canvas key handler and its
 * paste handler only while the editor counts itself focused, so blurring it
 * is the main guard. The shortcut preference is the second line, for any
 * path that focuses the editor again. Undo and redo are put back by hand,
 * because the preference also silences tldraw's own Ctrl+Z.
 */
function useHiddenCanvasGuards(editor: Editor, active: boolean) {
  useEffect(() => {
    // tldraw keeps this preference in the browser across reloads, so what it
    // was when Editor mode began may itself be Editor mode's "off" from an
    // earlier visit. It is set from the mode instead, every time (S2). The
    // app offers no way to turn shortcuts off, so on the canvas it is on.
    if (!active) {
      if (!editor.user.getAreKeyboardShortcutsEnabled()) editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: true })
      return
    }
    editor.selectNone()
    editor.setCurrentTool('select')
    editor.blur()
    editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: false })

    function undoRedo(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || isTextInputTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        editor.undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        editor.redo()
      }
    }
    window.addEventListener('keydown', undoRedo)
    return () => {
      window.removeEventListener('keydown', undoRedo)
      editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: true })
      // Without this, canvas shortcuts stay dead until something focuses the
      // editor again, and clicking the empty canvas does not (S2).
      editor.focus()
    }
  }, [editor, active])
}

function Frame({ type, panelId, fullScreen = false, zoom = 1, style }: { type: PanelType; panelId: string; fullScreen?: boolean; zoom?: number; style: CSSProperties }) {
  const Component = panelComponents[type]
  return (
    <div className={`canvas-panel-shell${fullScreen ? ' is-full-screen' : ''}`} data-presentation={fullScreen ? 'page' : 'window'} data-spike-panel={panelId} style={zoom === 1 ? style : { ...style, zoom }}>
      <div className="canvas-panel-wheel-scope" data-panel={type} style={{ '--accent': `var(--accent-${type})`, '--bg': `var(--bg-${type})` } as CSSProperties}>
        <Component panelId={panelId} />
      </div>
    </div>
  )
}
