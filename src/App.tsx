import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, Tldraw, TLShape } from 'tldraw'
import { AppChrome, type AppChromeRect } from './AppChrome'
import { AppStateProvider, useAppState } from './AppState'
import { fitEditorToBounds, getChromeAwareInsets, getPanelBounds, getSelectedPanelPageBounds } from './canvasView'
import { PANEL_SHAPE_TYPE, PanelShape, PanelShapeUtil } from './PanelShape'
import { mergePanelLayouts, resetAllPanelLayouts, resetPanelLayoutSize } from './panelLayout'
import { debounce } from './utils'
import type { CanvasState, PanelLayout, PanelType } from './types'

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
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null)
  const [isCanvasReady, setIsCanvasReady] = useState(false)
  const [chromeHeight, setChromeHeight] = useState(0)
  const editorRef = useRef<Editor | null>(null)
  const chromeRectRef = useRef<AppChromeRect | null>(null)
  const restoringCanvasRef = useRef(false)
  const programmaticCanvasMutationRef = useRef(false)
  const persistCanvasRef = useRef<ReturnType<typeof debounce> | null>(null)
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
      const layouts = mergePanelLayouts(canvas?.panels ?? resetAllPanelLayouts())
      editor.createShapes(
        layouts.map((layout) => ({
          type: PANEL_SHAPE_TYPE,
          x: layout.x,
          y: layout.y,
          props: { w: layout.w, h: layout.h, panelType: layout.panelType },
        })) as never,
      )
      editor.selectNone()
      setSelectedPanelId(null)
      if (canvas?.camera) editor.setCamera(canvas.camera)
      else fitBoundsInUsableViewport(editor, getPanelBounds(editor), null)
    } finally {
      restoringCanvasRef.current = false
    }
  }, [])

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    setIsCanvasReady(true)
    restoreCanvas(editor, sessions.activeSession?.canvas ?? null)

    const persist = debounce(() => {
      if (!restoringCanvasRef.current && !programmaticCanvasMutationRef.current) {
        updateCanvasRef.current(persistCanvas(editor))
      }
    }, 300)
    persistCanvasRef.current = persist
    const unregisterCanvasFlush = sessions.registerCanvasFlush(() => {
      persist.flush()
    })
    const removeStoreListener = editor.store.listen(() => {
      if (!restoringCanvasRef.current && !programmaticCanvasMutationRef.current) persist()
    }, { source: 'user', scope: 'all' })
    const syncSelectedPanel = (selectedShapeIds = editor.getSelectedShapeIds()) => {
      const selected = selectedShapeIds.map((shapeId) => editor.getShape(shapeId)).filter((shape): shape is TLShape => Boolean(shape))
      const nextId = selected.length === 1 && isPanelShape(selected[0]) ? selected[0].id : null
      setSelectedPanelId((current) => current === nextId ? current : nextId)
    }
    syncSelectedPanel()
    const removeSelectionListener = editor.sideEffects.registerAfterChangeHandler('instance_page_state', (previous, next) => {
      if (previous.selectedShapeIds !== next.selectedShapeIds && next.pageId === editor.getCurrentPageId()) {
        syncSelectedPanel(next.selectedShapeIds)
      }
    })

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
      persistCanvasRef.current = null
      removeStoreListener()
      removeSelectionListener()
      window.removeEventListener('keydown', handleKeyDown)
      editorRef.current = null
      setIsCanvasReady(false)
      setSelectedPanelId(null)
    }
  }, [restoreCanvas, sessions.activeSession?.id, sessions.registerCanvasFlush])

  const runProgrammaticCanvasMutation = useCallback((mutation: (editor: Editor) => void) => {
    const editor = editorRef.current
    if (!editor) return false

    persistCanvasRef.current?.cancel()
    programmaticCanvasMutationRef.current = true
    try {
      mutation(editor)
      updateCanvasRef.current(persistCanvas(editor))
      return true
    } finally {
      programmaticCanvasMutationRef.current = false
    }
  }, [])

  const fitAllPanels = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !getPanelBounds(editor)) {
      setCallbackStatus('There are no panels available to fit.')
      return
    }
    setCallbackStatus(null)
    runProgrammaticCanvasMutation((currentEditor) => {
      fitBoundsInUsableViewport(currentEditor, getPanelBounds(currentEditor), chromeRectRef.current)
    })
  }, [runProgrammaticCanvasMutation])

  const fitSelectedPanel = useCallback(() => {
    const editor = editorRef.current
    const bounds = editor ? getSelectedPanelPageBounds(editor) : null
    if (!editor || !bounds) {
      setCallbackStatus('Select exactly one panel to fit it into view.')
      return
    }
    setCallbackStatus(null)
    runProgrammaticCanvasMutation((currentEditor) => {
      fitBoundsInUsableViewport(currentEditor, bounds, chromeRectRef.current)
    })
  }, [runProgrammaticCanvasMutation])

  const resetSelectedPanel = useCallback(() => {
    const selected = editorRef.current?.getSelectedShapes() ?? []
    if (selected.length !== 1 || !isPanelShape(selected[0])) {
      setCallbackStatus('Select exactly one panel to reset its size.')
      return
    }
    setCallbackStatus(null)
    const changed = runProgrammaticCanvasMutation((editor) => {
      const shape = editor.getShape(selected[0].id)
      if (!shape || !isPanelShape(shape)) return
      const reset = resetPanelLayoutSize(panelShapeToLayout(shape))
      editor.updateShapes([{
        id: shape.id,
        type: PANEL_SHAPE_TYPE,
        x: reset.x,
        y: reset.y,
        props: { w: reset.w, h: reset.h },
      }] as never)
    })
    if (!changed) setCallbackStatus('The canvas is not ready yet.')
  }, [runProgrammaticCanvasMutation])

  const resetPanelLayout = useCallback(() => {
    const confirmed = window.confirm('Reset panel layout? This replaces panel positions and dimensions, but preserves Spotify, images, and notes.')
    if (!confirmed) return

    setCallbackStatus(null)
    const changed = runProgrammaticCanvasMutation((editor) => {
      const canonicalLayouts = resetAllPanelLayouts()
      const existingPanels = editor.getCurrentPageShapes().filter(isPanelShape)
      const retainedIds = new Set<string>()

      for (const layout of canonicalLayouts) {
        const existing = existingPanels.find((shape) => shape.props.panelType === layout.panelType && !retainedIds.has(shape.id))
        if (existing) {
          retainedIds.add(existing.id)
          editor.updateShapes([{
            id: existing.id,
            type: PANEL_SHAPE_TYPE,
            x: layout.x,
            y: layout.y,
            rotation: 0,
            props: { w: layout.w, h: layout.h, panelType: layout.panelType },
          }] as never)
        } else {
          editor.createShapes([{
            type: PANEL_SHAPE_TYPE,
            x: layout.x,
            y: layout.y,
            props: { w: layout.w, h: layout.h, panelType: layout.panelType },
          }] as never)
        }
      }

      const duplicateIds = existingPanels.filter((shape) => !retainedIds.has(shape.id)).map((shape) => shape.id)
      if (duplicateIds.length) editor.deleteShapes(duplicateIds)
      editor.selectNone()
      setSelectedPanelId(null)
      fitBoundsInUsableViewport(editor, getPanelBounds(editor), chromeRectRef.current)
    })
    if (!changed) setCallbackStatus('The canvas is not ready yet.')
  }, [runProgrammaticCanvasMutation])

  const togglePanMode = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return

    const nextIsPanMode = editor.getCurrentToolId() !== 'hand'
    editor.setCurrentTool(nextIsPanMode ? 'hand' : 'select')
    setIsPanMode(nextIsPanMode)
  }, [])

  const handleChromeMeasure = useCallback((rect: AppChromeRect) => {
    chromeRectRef.current = rect
    setChromeHeight((current) => Math.abs(current - rect.height) < 0.5 ? current : rect.height)
  }, [])

  useEffect(() => {
    if (editorRef.current && sessions.activeSession) restoreCanvas(editorRef.current, sessions.activeSession.canvas)
  }, [restoreCanvas, sessions.activeSession?.id])

  const ChromeMenuPanel = useCallback(() => (
    <AppChrome
      isCanvasReady={isCanvasReady}
      isPanMode={isPanMode}
      canUseSelectedPanel={selectedPanelId !== null}
      onTogglePanMode={togglePanMode}
      onFitAllPanels={fitAllPanels}
      onFitSelectedPanel={fitSelectedPanel}
      onResetSelectedPanel={resetSelectedPanel}
      onResetPanelLayout={resetPanelLayout}
      onMeasure={handleChromeMeasure}
    />
  ), [fitAllPanels, fitSelectedPanel, handleChromeMeasure, isCanvasReady, isPanMode, resetPanelLayout, resetSelectedPanel, selectedPanelId, togglePanMode])

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
      MenuPanel: ChromeMenuPanel,
      TopPanel: null,
    }),
    [ChromeMenuPanel],
  )

  if (!sessions.isReady) {
    return <main className="app-root app-loading">Loading sessions...</main>
  }

  return (
    <main className="app-root" style={{ '--app-chrome-height': `${chromeHeight}px` } as CSSProperties}>
      <Tldraw shapeUtils={shapeUtils} components={components} onMount={handleMount} />
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
  return { camera: editor.getCamera(), panels: mergePanelLayouts(panels) }
}

function isPanelShape(shape: TLShape): shape is PanelShape {
  return shape.type === PANEL_SHAPE_TYPE
}

function panelShapeToLayout(shape: PanelShape): PanelLayout {
  return {
    panelType: shape.props.panelType as PanelType,
    x: shape.x,
    y: shape.y,
    w: shape.props.w,
    h: shape.props.h,
  }
}

function fitBoundsInUsableViewport(editor: Editor, bounds: ReturnType<typeof getPanelBounds>, chromeRect: AppChromeRect | null) {
  const viewport = editor.getViewportScreenBounds()
  return fitEditorToBounds(
    editor,
    bounds,
    getChromeAwareInsets(chromeRect?.bottom, { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h }),
  )
}
