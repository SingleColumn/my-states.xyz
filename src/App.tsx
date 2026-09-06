import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, Tldraw, TLShape, type TLUiOverrides } from 'tldraw'
import { CanvasContextMenu } from './CanvasContextMenu'
import { AppChrome, type AppChromeRect } from './AppChrome'
import { AppStateProvider, useAppState } from './AppState'
import { fitEditorToBounds, getChromeAwareInsets, getPanelBounds, getSelectedPanelPageBounds } from './canvasView'
import { PANEL_SHAPE_TYPE, PanelShape, PanelShapeUtil } from './PanelShape'
import { getCanonicalPanelLayout, getRenderablePanelLayouts, isPanelVisible, mergeVisiblePanelLayouts, resetAllPanelLayouts, showAllPanels } from './panelLayout'
import { getFullScreenPanelLayout, restorePanelDefaultLayout, restorePanelDefaultSize } from './panelGeometry'
import { PanelCommandsProvider } from './PanelHeader'
import { debounce } from './utils'
import { duplicatePanel } from './panelDuplication'
import { buildPanelArchitectureReport, type PanelArchitectureReport } from './panelArchitectureReport'
import { PanelArchitectureReportView } from './PanelArchitectureReportView'
import { HelpAbout } from './HelpAbout'
import type { CanvasState, Panel, PanelLayout } from './types'

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
  const callbackHandledRef = useRef(false)
  const [isPanMode, setIsPanMode] = useState(false)
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null)
  const [isCanvasReady, setIsCanvasReady] = useState(false)
  const [chromeHeight, setChromeHeight] = useState(0)
  const [architectureReport, setArchitectureReport] = useState<PanelArchitectureReport | null>(null)
  const [isHelpAboutOpen, setIsHelpAboutOpen] = useState(false)
  const helpAboutReturnFocusRef = useRef<HTMLElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const chromeRectRef = useRef<AppChromeRect | null>(null)
  const restoringCanvasRef = useRef(false)
  const programmaticCanvasMutationRef = useRef(false)
  const persistCanvasRef = useRef<ReturnType<typeof debounce> | null>(null)
  const updateCanvasRef = useRef(sessions.updateCanvas)
  const sessionPanelsRef = useRef<Panel[]>(sessions.activeSession?.panels ?? [])
  const sessionCanvasRef = useRef<CanvasState | null>(sessions.activeSession?.canvas ?? null)
  const previousPanelGeometryRef = useRef(new Map<string, PanelLayout>())

  useEffect(() => {
    updateCanvasRef.current = sessions.updateCanvas
  }, [sessions.updateCanvas])

  useEffect(() => {
    sessionPanelsRef.current = sessions.activeSession?.panels ?? []
    sessionCanvasRef.current = sessions.activeSession?.canvas ?? null
  }, [sessions.activeSession?.canvas, sessions.activeSession?.panels])

  useEffect(() => {
    if (window.location.pathname !== '/callback' || callbackHandledRef.current) return
    // The Spotify authorization code is single-use. Mark this callback as
    // handled before starting the exchange because updating Spotify state can
    // re-run this effect while the request is still in flight.
    callbackHandledRef.current = true
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
    // Remove the one-time code before awaiting the exchange. This also keeps
    // a later render from attempting to process the same authorization code.
    window.history.replaceState({}, '', '/')
    spotify
      .handleCallback(code, state)
      .then(() => {
        setCallbackStatus(null)
      })
      .catch((caught) => {
        setCallbackStatus(caught instanceof Error ? caught.message : 'Spotify callback failed.')
      })
  }, [spotify])

  const restoreCanvas = useCallback((editor: Editor, canvas: CanvasState | null) => {
    restoringCanvasRef.current = true
    try {
      const existingPanels = editor.getCurrentPageShapes().filter(isPanelShape)
      if (existingPanels.length) editor.deleteShapes(existingPanels.map((shape) => shape.id))
      const layouts = getRenderablePanelLayouts(sessionPanelsRef.current, canvas)
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      editor.createShapes(
        layouts.map((layout) => ({
          type: PANEL_SHAPE_TYPE,
          x: layout.x,
          y: layout.y,
          rotation: layout.rotation ?? 0,
          props: { w: layout.w, h: layout.h, panelId: layout.panelId },
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
    // tldraw otherwise picks its menu language from the browser, so the same
    // build reads differently machine to machine. This app is written in
    // English, so keep its wording fixed.
    editor.user.updateUserPreferences({ locale: 'en' })
    restoreCanvas(editor, sessions.activeSession?.canvas ?? null)

    const persist = debounce(() => {
      if (!restoringCanvasRef.current && !programmaticCanvasMutationRef.current) {
        updateCanvasRef.current(persistCanvas(editor, sessionPanelsRef.current, sessionCanvasRef.current))
      }
    }, 300)
    persistCanvasRef.current = persist
    const unregisterCanvasFlush = sessions.registerCanvasFlush(() => {
      persist.flush()
    })
    // Re-key duplicated panel shapes inside tldraw's creation transaction. A
    // later store listener/update can race with the duplicate command and
    // leave the new shape pointing at a panel that does not exist yet.
    const removeDuplicatePanelHandler = editor.sideEffects.registerBeforeCreateHandler('shape', (record, source) => {
      if (source !== 'user' || restoringCanvasRef.current || programmaticCanvasMutationRef.current) return record
      if (record.type !== PANEL_SHAPE_TYPE) return record

      const shape = record as PanelShape
      const panel = sessionPanelsRef.current.find((candidate) => candidate.id === shape.props.panelId)
      if (!panel) return record

      const duplicate = duplicatePanel(panel)
      if (!duplicate) return record

      sessions.addPanels([duplicate])
      return {
        ...record,
        props: {
          ...shape.props,
          panelId: duplicate.id,
        },
      }
    })
    const removeSpotifyDuplicateHandler = editor.sideEffects.registerAfterCreateHandler('shape', (record, source) => {
      if (source !== 'user' || restoringCanvasRef.current || programmaticCanvasMutationRef.current) return
      if (record.type !== PANEL_SHAPE_TYPE) return
      const shape = record as PanelShape
      const panel = sessionPanelsRef.current.find((candidate) => candidate.id === shape.props.panelId)
      if (panel?.type === 'spotify') editor.deleteShapes([shape.id])
    })
    const removePanelAfterDeleteHandler = editor.sideEffects.registerAfterDeleteHandler('shape', (record) => {
      if (restoringCanvasRef.current || programmaticCanvasMutationRef.current || !isPanelShape(record)) return
      sessions.removePanel(record.props.panelId)
    })
    const removeStoreListener = editor.store.listen(() => {
      if (!restoringCanvasRef.current && !programmaticCanvasMutationRef.current) persist()
    }, { source: 'user', scope: 'all' })
    const syncSelectedPanel = (selectedShapeIds = editor.getSelectedShapeIds()) => {
      const selected = selectedShapeIds.map((shapeId) => editor.getShape(shapeId)).filter((shape): shape is TLShape => Boolean(shape))
      const nextId = selected.length === 1 && isPanelShape(selected[0]) ? selected[0].props.panelId : null
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
      const selectedPanelIds = selectedShapeIds
        .map((shapeId) => editor.getShape(shapeId))
        .filter((shape): shape is PanelShape => shape !== undefined && isPanelShape(shape))
        .map((shape) => shape.props.panelId)
      editor.deleteShapes(selectedShapeIds)
      for (const panelId of selectedPanelIds) sessions.removePanel(panelId)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      unregisterCanvasFlush()
      persist.cancel()
      removeDuplicatePanelHandler()
      removeSpotifyDuplicateHandler()
      removePanelAfterDeleteHandler()
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
      updateCanvasRef.current(persistCanvas(editor, sessionPanelsRef.current, sessionCanvasRef.current))
      return true
    } finally {
      programmaticCanvasMutationRef.current = false
    }
  }, [])

  const hidePanel = useCallback((panelId: string) => {
    const editor = editorRef.current
    const shape = editor?.getCurrentPageShapes().find((candidate) => isPanelShape(candidate) && candidate.props.panelId === panelId)
    if (!editor || !shape || !isPanelShape(shape)) return
    sessionCanvasRef.current = {
      camera: editor.getCamera(),
      panels: [
        ...(sessionCanvasRef.current?.panels ?? []).filter((layout) => layout.panelId !== panelId),
        panelShapeToLayout(shape),
      ],
    }
    sessionPanelsRef.current = sessionPanelsRef.current.map((panel) => panel.id === panelId ? { ...panel, visible: false } : panel)
    sessions.setPanelVisibility(panelId, false)
    runProgrammaticCanvasMutation((editor) => {
      editor.deleteShapes([shape.id])
      editor.selectNone()
      setSelectedPanelId(null)
    })
  }, [runProgrammaticCanvasMutation, sessions])

  const hideSelectedPanel = useCallback(() => {
    const selected = editorRef.current?.getSelectedShapes() ?? []
    if (selected.length === 1 && isPanelShape(selected[0])) hidePanel(selected[0].props.panelId)
  }, [hidePanel])

  const togglePanelFullScreen = useCallback((panelId: string) => {
    const editor = editorRef.current
    const shape = editor?.getCurrentPageShapes().find((candidate) => isPanelShape(candidate) && candidate.props.panelId === panelId)
    if (!editor || !shape || !isPanelShape(shape)) return
    const previous = previousPanelGeometryRef.current.get(panelId)
    runProgrammaticCanvasMutation((currentEditor) => {
      if (previous) {
        currentEditor.updateShapes([{ id: shape.id, type: PANEL_SHAPE_TYPE, x: previous.x, y: previous.y, rotation: previous.rotation ?? 0, props: { w: previous.w, h: previous.h, panelId } }] as never)
        previousPanelGeometryRef.current.delete(panelId)
        return
      }
      previousPanelGeometryRef.current.set(panelId, panelShapeToLayout(shape))
      const viewport = currentEditor.getViewportScreenBounds()
      const bounds = getFullScreenPanelLayout(
        { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
        chromeRectRef.current?.bottom,
        (point) => currentEditor.screenToPage(point),
      )
      currentEditor.updateShapes([{ id: shape.id, type: PANEL_SHAPE_TYPE, x: bounds.x, y: bounds.y, props: { w: bounds.w, h: bounds.h, panelId } }] as never)
      // A full-screen panel may overlap existing panels. Keep it above them
      // so the action is immediately useful without a second arrange command.
      currentEditor.bringToFront([shape.id])
    })
  }, [runProgrammaticCanvasMutation])

  const restorePanelDefaultSizeForId = useCallback((panelId: string) => {
    const editor = editorRef.current
    const shape = editor?.getCurrentPageShapes().find((candidate) => isPanelShape(candidate) && candidate.props.panelId === panelId)
    const panel = sessions.activeSession?.panels.find((candidate) => candidate.id === panelId)
    if (!editor || !shape || !isPanelShape(shape) || !panel) return
    previousPanelGeometryRef.current.delete(panelId)
    runProgrammaticCanvasMutation((currentEditor) => {
      const layout = restorePanelDefaultLayout(panelShapeToLayout(shape), panel.type)
      currentEditor.updateShapes([{ id: shape.id, type: PANEL_SHAPE_TYPE, x: layout.x, y: layout.y, props: { w: layout.w, h: layout.h, panelId } }] as never)
    })
  }, [runProgrammaticCanvasMutation, sessions.activeSession?.panels])

  const hideSelectedPanelRef = useRef(hideSelectedPanel)

  useEffect(() => {
    hideSelectedPanelRef.current = hideSelectedPanel
  }, [hideSelectedPanel])

  const restorePanel = useCallback((panelId: string) => {
    const panel = sessions.activeSession?.panels.find((candidate) => candidate.id === panelId)
    if (!panel) return
    const layout = sessions.activeSession?.canvas?.panels.find((candidate) => candidate.panelId === panelId) ?? (() => {
      const canonical = getCanonicalPanelLayout(panel.type)
      return { panelId, x: canonical.x, y: canonical.y, w: canonical.w, h: canonical.h, rotation: 0 }
    })()
    sessionPanelsRef.current = sessionPanelsRef.current.map((candidate) => candidate.id === panelId ? { ...candidate, visible: true } : candidate)
    sessions.setPanelVisibility(panelId, true)
    runProgrammaticCanvasMutation((editor) => {
      if (editor.getCurrentPageShapes().some((shape) => isPanelShape(shape) && shape.props.panelId === panelId)) return
      editor.createShapes([{ type: PANEL_SHAPE_TYPE, x: layout.x, y: layout.y, rotation: layout.rotation ?? 0, props: { w: layout.w, h: layout.h, panelId } }] as never)
    })
  }, [runProgrammaticCanvasMutation, sessions.activeSession])

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
      const panel = sessions.activeSession?.panels.find((candidate) => candidate.id === shape.props.panelId)
      if (!panel) return
      const reset = restorePanelDefaultSize(panelShapeToLayout(shape), panel.type)
      editor.updateShapes([{
        id: shape.id,
        type: PANEL_SHAPE_TYPE,
        x: reset.x,
        y: reset.y,
        props: { w: reset.w, h: reset.h, panelId: shape.props.panelId },
      }] as never)
    })
    if (!changed) setCallbackStatus('The canvas is not ready yet.')
  }, [runProgrammaticCanvasMutation, sessions.activeSession?.panels])

  const resetPanelLayout = useCallback(() => {
    const confirmed = window.confirm('Reset panel layout? This puts every panel back to its original position and size, and brings back any hidden panels. Your Spotify, images, and notes are kept.')
    if (!confirmed) return

    setCallbackStatus(null)
    const changed = runProgrammaticCanvasMutation((editor) => {
      const canonicalLayouts = (sessions.activeSession?.panels ?? []).map((panel, order) => {
        const layout = getCanonicalPanelLayout(panel.type)
        return { panelId: panel.id, x: layout.x, y: layout.y, w: layout.w, h: layout.h, rotation: 0, order }
      })
      const existingPanels = editor.getCurrentPageShapes().filter(isPanelShape)
      const retainedIds = new Set<string>()

      for (const layout of canonicalLayouts) {
        const existing = existingPanels.find((shape) => shape.props.panelId === layout.panelId)
        if (existing) {
          retainedIds.add(existing.id)
          editor.updateShapes([{
            id: existing.id,
            type: PANEL_SHAPE_TYPE,
            x: layout.x,
            y: layout.y,
            rotation: 0,
            props: { w: layout.w, h: layout.h, panelId: layout.panelId },
          }] as never)
        } else {
          editor.createShapes([{
            type: PANEL_SHAPE_TYPE,
            x: layout.x,
            y: layout.y,
            props: { w: layout.w, h: layout.h, panelId: layout.panelId },
          }] as never)
        }
      }

      const duplicateIds = existingPanels.filter((shape) => !retainedIds.has(shape.id)).map((shape) => shape.id)
      if (duplicateIds.length) editor.deleteShapes(duplicateIds)
      editor.selectNone()
      setSelectedPanelId(null)
      fitBoundsInUsableViewport(editor, getPanelBounds(editor), chromeRectRef.current)
    })
    if (changed) {
      const editor = editorRef.current
      // The reset above puts a shape back on the canvas for every panel, hidden
      // ones included, so the stored visibility has to catch up. Otherwise a
      // panel is visible again while the menu still offers to restore it.
      for (const panel of sessionPanelsRef.current) {
        if (!isPanelVisible(panel)) sessions.setPanelVisibility(panel.id, true)
      }
      sessionPanelsRef.current = showAllPanels(sessionPanelsRef.current)
      if (editor) sessions.updateCanvas({ camera: editor.getCamera(), panels: resetAllPanelLayouts(sessions.activeSession?.panels ?? []) })
    }
    if (!changed) setCallbackStatus('The canvas is not ready yet.')
  }, [runProgrammaticCanvasMutation, sessions])

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

  const openArchitectureReport = useCallback(() => {
    const editor = editorRef.current
    const session = sessions.activeSession
    if (!editor || !session) return
    setArchitectureReport(buildPanelArchitectureReport(session, editor))
  }, [sessions.activeSession])

  const displayedArchitectureReport = architectureReport && sessions.activeSession && editorRef.current
    ? buildPanelArchitectureReport(sessions.activeSession, editorRef.current)
    : architectureReport

  const openHelpAbout = useCallback(() => {
    helpAboutReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setIsHelpAboutOpen(true)
  }, [])

  const closeHelpAbout = useCallback(() => setIsHelpAboutOpen(false), [])

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
      canHideSelectedPanel={selectedPanelId !== null}
      hiddenPanels={(sessions.activeSession?.panels ?? []).filter((panel) => !isPanelVisible(panel)).map((panel) => ({ id: panel.id, type: panel.type }))}
      onHideSelectedPanel={hideSelectedPanel}
      onRestorePanel={restorePanel}
      onOpenArchitectureReport={openArchitectureReport}
      onOpenHelpAbout={openHelpAbout}
      onMeasure={handleChromeMeasure}
    />
  ), [fitAllPanels, fitSelectedPanel, handleChromeMeasure, hideSelectedPanel, isCanvasReady, isPanMode, openArchitectureReport, openHelpAbout, resetPanelLayout, resetSelectedPanel, restorePanel, selectedPanelId, sessions.activeSession?.panels, togglePanMode])

  // One session is one page, so tldraw's "Move to page" has nowhere to move a
  // panel to. Declaring the limit hides that submenu instead of leaving a
  // dead end in the menu.
  const editorOptions = useMemo(() => ({ maxPages: 1 }), [])

  const uiOverrides = useMemo<TLUiOverrides>(() => ({
    actions: (_editor, actions) => {
      // Neither of these applies to a panel: "Flatten to image" rasterises a
      // shape, and panels are live HTML; locking one leaves it stuck with no
      // way back now that the Edit submenu is gone. Removing the actions also
      // unbinds their keyboard shortcuts, which a hidden menu item would not.
      const { 'flatten-to-image': _flattenToImage, 'toggle-lock': _toggleLock, ...remaining } = actions
      return {
        ...remaining,
        'hide-panel': {
          id: 'hide-panel',
          label: 'action.hide-panel',
          onSelect: () => hideSelectedPanelRef.current(),
        },
      }
    },
    translations: { en: { 'action.hide-panel': 'Hide panel' } },
  }), [])

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
      ContextMenu: CanvasContextMenu,
    }),
    [ChromeMenuPanel],
  )

  if (!sessions.isReady) {
    return <main className="app-root app-loading">Loading sessions...</main>
  }

  return (
    <main className="app-root" style={{ '--app-chrome-height': `${chromeHeight}px` } as CSSProperties}>
      <PanelCommandsProvider commands={{ hidePanel, togglePanelFullScreen, restorePanelDefaultSize: restorePanelDefaultSizeForId, isPanelFullScreen: (panelId) => previousPanelGeometryRef.current.has(panelId) }}>
        <Tldraw shapeUtils={shapeUtils} components={components} overrides={uiOverrides} options={editorOptions} onMount={handleMount} />
      </PanelCommandsProvider>
      {displayedArchitectureReport ? <PanelArchitectureReportView report={displayedArchitectureReport} onClose={() => setArchitectureReport(null)} /> : null}
      <HelpAbout isOpen={isHelpAboutOpen} onClose={closeHelpAbout} returnFocusRef={helpAboutReturnFocusRef} />
      {sessions.error ? <div className="callback-toast">{sessions.error}</div> : null}
      {callbackStatus ? <div className="callback-toast">{callbackStatus}</div> : null}
    </main>
  )
}

function persistCanvas(editor: Editor, sessionPanels: readonly Panel[], existingCanvas: CanvasState | null) {
  const visiblePanels = editor
    .getCurrentPageShapes()
    .filter(isPanelShape)
    .map<PanelLayout>((shape, order) => ({
      panelId: shape.props.panelId,
      x: shape.x,
      y: shape.y,
      w: shape.props.w,
      h: shape.props.h,
      rotation: shape.rotation,
      order,
    }))
  return { camera: editor.getCamera(), panels: mergeVisiblePanelLayouts(sessionPanels, existingCanvas, visiblePanels) }
}

function isPanelShape(shape: TLShape): shape is PanelShape {
  return shape.type === PANEL_SHAPE_TYPE
}

function panelShapeToLayout(shape: PanelShape): PanelLayout {
  return {
    panelId: shape.props.panelId,
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
