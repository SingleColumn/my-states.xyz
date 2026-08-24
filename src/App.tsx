import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hand } from 'lucide-react'
import { Box, Editor, Tldraw, TLShape } from 'tldraw'
import { AppStateProvider, useAppState } from './AppState'
import { CanvasViewControls } from './CanvasViewControls'
import { PANEL_SHAPE_TYPE, PanelShape, PanelShapeUtil } from './PanelShape'
import { mergePanelLayouts, resetAllPanelLayouts, resetPanelLayoutSize } from './panelLayout'
import { SessionToolbar } from './SessionToolbar'
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
  const editorRef = useRef<Editor | null>(null)
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
      else fitPanelsInEditor(editor)
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
    runProgrammaticCanvasMutation(fitPanelsInEditor)
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
      fitPanelsInEditor(editor)
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
          className="app-badge-control"
          type="button"
          aria-pressed={isPanMode}
          title={isPanMode ? 'Exit pan mode' : 'Pan canvas: drag to move the view'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={togglePanMode}
        >
          <Hand size={16} aria-hidden="true" />
          <span>{isPanMode ? 'Exit pan' : 'Pan canvas'}</span>
        </button>
        <CanvasViewControls
          isReady={isCanvasReady}
          canResetSelectedPanel={selectedPanelId !== null}
          onFitPanels={fitAllPanels}
          onResetSelectedPanel={resetSelectedPanel}
          onResetPanelLayout={resetPanelLayout}
        />
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

function fitPanelsInEditor(editor: Editor) {
  const bounds = getPanelBounds(editor)
  if (!bounds) return
  editor.zoomToBounds(bounds, { inset: 72, immediate: true })
}

function getPanelBounds(editor: Editor) {
  const bounds = editor
    .getCurrentPageShapes()
    .filter(isPanelShape)
    .map((shape) => editor.getShapePageBounds(shape))
    .filter((bounds): bounds is Box => Boolean(bounds))
  return bounds.length ? Box.Common(bounds) : null
}
