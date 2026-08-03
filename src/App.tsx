import { useCallback, useEffect, useMemo, useState } from 'react'
import { Editor, Tldraw, TLShape } from 'tldraw'
import { AppStateProvider, useAppState } from './AppState'
import { PANEL_SHAPE_TYPE, PanelShape, PanelShapeUtil } from './PanelShape'
import { debounce } from './utils'
import { loadCanvasState, saveCanvasState } from './storage'
import type { CanvasState, PanelLayout, PanelType } from './types'

const defaultLayouts: PanelLayout[] = [
  { panelType: 'spotify', x: -720, y: -300, w: 460, h: 600 },
  { panelType: 'slideshow', x: -220, y: -300, w: 460, h: 600 },
  { panelType: 'notes', x: 280, y: -300, w: 460, h: 600 },
]

// Panel sizes prior to unifying all three cards to a single default size —
// used to migrate previously-persisted layouts that were auto-seeded at
// these old, mismatched dimensions (not layouts the user resized by hand).
const previousDefaultLayouts: PanelLayout[] = [
  { panelType: 'spotify', x: -520, y: -160, w: 430, h: 560 },
  { panelType: 'slideshow', x: -80, y: -390, w: 600, h: 860 },
  { panelType: 'notes', x: 610, y: -120, w: 430, h: 540 },
]

const shapeUtils = [PanelShapeUtil]

export default function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  )
}

function AppContent() {
  const { spotify } = useAppState()
  const [callbackStatus, setCallbackStatus] = useState<string | null>(null)

  useEffect(() => {
    if (window.location.pathname !== '/callback') return

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const error = params.get('error')

    if (error) {
      setCallbackStatus(`Spotify login failed: ${error}`)
      window.history.replaceState({}, '', '/')
      return
    }

    if (!code) {
      setCallbackStatus('Spotify did not return an authorization code.')
      window.history.replaceState({}, '', '/')
      return
    }

    setCallbackStatus('Finishing Spotify login...')
    spotify
      .handleCallback(code, state)
      .then(() => {
        setCallbackStatus(null)
        window.history.replaceState({}, '', '/')
      })
      .catch((caught) => {
        setCallbackStatus(caught instanceof Error ? caught.message : 'Spotify callback failed.')
        window.history.replaceState({}, '', '/')
      })
  }, [spotify])

  const handleMount = useCallback((editor: Editor) => {
    seedPanels(editor)

    const persisted = loadCanvasState()
    if (persisted?.camera) {
      editor.setCamera(persisted.camera)
    } else {
      editor.zoomToFit({ animation: { duration: 240 } })
    }

    const persist = debounce(() => persistCanvas(editor), 300)
    const removeStoreListener = editor.store.listen(() => persist(), { source: 'user', scope: 'all' })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .mdxeditor')
      ) {
        return
      }

      const selectedShapeIds = editor.getSelectedShapeIds()
      if (!selectedShapeIds.length) return

      event.preventDefault()
      editor.deleteShapes(selectedShapeIds)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      removeStoreListener()
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const components = useMemo(
    () => ({
      DebugPanel: null,
      DebugMenu: null,
      SharePanel: null,
      HelpMenu: null,
      MainMenu: null,
      StylePanel: null,
      Toolbar: null,
      NavigationPanel: null,
    }),
    [],
  )

  return (
    <main className="app-root">
      <Tldraw shapeUtils={shapeUtils} components={components} onMount={handleMount} />
      <div className="app-badge">
        <strong>Music Images Canvas</strong>
        <span>Pan, zoom, move, resize</span>
      </div>
      {callbackStatus ? <div className="callback-toast">{callbackStatus}</div> : null}
    </main>
  )
}

function seedPanels(editor: Editor) {
  const currentPanels = editor.getCurrentPageShapes().filter(isPanelShape)
  const existingTypes = new Set(currentPanels.map((shape) => shape.props.panelType))
  const persisted = loadCanvasState()
  const layouts = mergeLayouts(persisted?.panels ?? defaultLayouts)

  const missingLayouts = layouts.filter((layout) => !existingTypes.has(layout.panelType))
  if (!missingLayouts.length) return

  editor.createShapes(
    missingLayouts.map((layout) => ({
      type: PANEL_SHAPE_TYPE,
      x: layout.x,
      y: layout.y,
      props: {
        w: layout.w,
        h: layout.h,
        panelType: layout.panelType,
      },
    })) as never,
  )
}

function persistCanvas(editor: Editor) {
  const panels = editor
    .getCurrentPageShapes()
    .filter(isPanelShape)
    .map<PanelLayout>((shape) => ({
      panelType: shape.props.panelType as PanelType,
      x: shape.x,
      y: shape.y,
      w: shape.props.w,
      h: shape.props.h,
    }))

  const state: CanvasState = {
    camera: editor.getCamera(),
    panels: mergeLayouts(panels),
  }

  saveCanvasState(state)
}

function mergeLayouts(layouts: PanelLayout[]) {
  const byType = new Map<PanelType, PanelLayout>()
  for (const layout of layouts) {
    const isHorizontalSlideshow = layout.panelType === 'slideshow' && layout.w / layout.h > 1.05
    const isOldSlideshowDefault =
      layout.panelType === 'slideshow' &&
      ((layout.x === -40 && layout.y === -230 && layout.w === 720 && layout.h === 610) ||
        (layout.x === -50 && layout.y === -360 && layout.w === 480 && layout.h === 840))
    const matchesPreviousDefault = previousDefaultLayouts.some(
      (previous) =>
        previous.panelType === layout.panelType &&
        previous.x === layout.x &&
        previous.y === layout.y &&
        previous.w === layout.w &&
        previous.h === layout.h,
    )

    if (isHorizontalSlideshow || isOldSlideshowDefault || matchesPreviousDefault) {
      byType.set(layout.panelType, defaultLayouts.find((candidate) => candidate.panelType === layout.panelType) ?? layout)
    } else {
      byType.set(layout.panelType, layout)
    }
  }

  for (const layout of defaultLayouts) {
    if (!byType.has(layout.panelType)) byType.set(layout.panelType, layout)
  }

  return defaultLayouts.map((layout) => byType.get(layout.panelType) ?? layout)
}

function isPanelShape(shape: TLShape): shape is PanelShape {
  return shape.type === PANEL_SHAPE_TYPE
}
