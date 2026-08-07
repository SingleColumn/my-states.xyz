import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hand } from 'lucide-react'
import { Editor, Tldraw, TLShape } from 'tldraw'
import { AppStateProvider, useAppState } from './AppState'
import { PANEL_SHAPE_TYPE, PanelShape, PanelShapeUtil } from './PanelShape'
import { SessionToolbar } from './SessionToolbar'
import { debounce } from './utils'
import type { CanvasState, PanelLayout, PanelType } from './types'

const defaultLayouts: PanelLayout[] = [
  { panelType: 'spotify', x: -720, y: -300, w: 460, h: 600 },
  { panelType: 'slideshow', x: -220, y: -300, w: 460, h: 600 },
  { panelType: 'notes', x: 280, y: -300, w: 460, h: 600 },
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
  const { spotify, sessions } = useAppState()
  const [callbackStatus, setCallbackStatus] = useState<string | null>(null)
  const [isPanMode, setIsPanMode] = useState(false)
  const editorRef = useRef<Editor | null>(null)
  const restoringCanvasRef = useRef(false)
  const updateCanvasRef = useRef(sessions.updateCanvas)

  useEffect(() => {
    updateCanvasRef.current = sessions.updateCanvas
  }, [sessions.updateCanvas])

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

  const restoreCanvas = useCallback((editor: Editor, canvas: CanvasState | null) => {
    restoringCanvasRef.current = true
    try {
      const existingPanels = editor.getCurrentPageShapes().filter(isPanelShape)
      if (existingPanels.length) editor.deleteShapes(existingPanels.map((shape) => shape.id))
      const layouts = mergeLayouts(canvas?.panels ?? defaultLayouts)
      editor.createShapes(
        layouts.map((layout) => ({
          type: PANEL_SHAPE_TYPE,
          x: layout.x,
          y: layout.y,
          props: { w: layout.w, h: layout.h, panelType: layout.panelType },
        })) as never,
      )
      editor.selectNone()
      if (canvas?.camera) editor.setCamera(canvas.camera)
      else editor.zoomToFit({ animation: { duration: 0 } })
    } finally {
      restoringCanvasRef.current = false
    }
  }, [])

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    restoreCanvas(editor, sessions.activeSession?.canvas ?? null)

    const persist = debounce(() => {
      if (!restoringCanvasRef.current) updateCanvasRef.current(persistCanvas(editor))
    }, 300)
    const unregisterCanvasFlush = sessions.registerCanvasFlush(() => {
      persist.flush()
    })
    const removeStoreListener = editor.store.listen(() => persist(), { source: 'user', scope: 'all' })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .mdxeditor')) return
      const selectedShapeIds = editor.getSelectedShapeIds()
      if (!selectedShapeIds.length) return
      event.preventDefault()
      editor.deleteShapes(selectedShapeIds)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      unregisterCanvasFlush()
      persist.cancel()
      removeStoreListener()
      window.removeEventListener('keydown', handleKeyDown)
      editorRef.current = null
    }
  }, [restoreCanvas, sessions.activeSession?.id, sessions.registerCanvasFlush])

  const togglePanMode = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return

    const nextIsPanMode = editor.getCurrentToolId() !== 'hand'
    editor.setCurrentTool(nextIsPanMode ? 'hand' : 'select')
    setIsPanMode(nextIsPanMode)
  }, [])

  useEffect(() => {
    if (editorRef.current && sessions.activeSession) restoreCanvas(editorRef.current, sessions.activeSession.canvas)
  }, [restoreCanvas, sessions.activeSession?.id])

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

  if (!sessions.isReady) {
    return <main className="app-root app-loading">Loading sessions...</main>
  }

  return (
    <main className="app-root">
      <Tldraw shapeUtils={shapeUtils} components={components} onMount={handleMount} />
      <SessionToolbar />
      <div className="app-badge">
        <strong>Music Images Canvas</strong>
        <span>{sessions.activeSession?.name ?? 'No session'}</span>
        <button
          className="app-badge-pan-control"
          type="button"
          aria-pressed={isPanMode}
          title={isPanMode ? 'Exit pan mode' : 'Pan canvas: drag to move the view'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={togglePanMode}
        >
          <Hand size={16} aria-hidden="true" />
          <span>{isPanMode ? 'Exit pan' : 'Pan canvas'}</span>
        </button>
      </div>
      {sessions.error ? <div className="callback-toast">{sessions.error}</div> : null}
      {callbackStatus ? <div className="callback-toast">{callbackStatus}</div> : null}
    </main>
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
  return { camera: editor.getCamera(), panels: mergeLayouts(panels) }
}

function mergeLayouts(layouts: PanelLayout[]) {
  const byType = new Map<PanelType, PanelLayout>()
  for (const layout of layouts) byType.set(layout.panelType, layout)
  for (const layout of defaultLayouts) {
    if (!byType.has(layout.panelType)) byType.set(layout.panelType, layout)
  }
  return defaultLayouts.map((layout) => byType.get(layout.panelType) ?? layout)
}

function isPanelShape(shape: TLShape): shape is PanelShape {
  return shape.type === PANEL_SHAPE_TYPE
}
