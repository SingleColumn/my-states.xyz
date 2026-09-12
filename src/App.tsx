import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, Tldraw, TLShape, getSnapshot, loadSnapshot, type TLUiOverrides } from 'tldraw'
import { CanvasContextMenu } from './CanvasContextMenu'
import { AppChromeMenuPanel, AppChromePropsProvider, type AppChromeRect } from './AppChrome'
import { AppStateProvider, useAppState } from './AppState'
import { fitEditorToBounds, getChromeAwareInsets, getPanelBounds, getSelectedPanelPageBounds } from './canvasView'
import { createCanvasApi } from './canvasApi'
import { PanelShape, PanelShapeUtil } from './PanelShape'
import { getCanonicalPanelLayout, getPanelFocusViewSize, isPanelInFocusView } from './panelLayout'
import { applyPanelFocusViewSize, getFullScreenPanelLayout, restorePanelDefaultLayout, restorePanelDefaultSize } from './panelGeometry'
import { getPanelDefinition } from './panelRegistry'
import { getPanelShape, isPanelShape, listPanelShapes, panelFromShape, setPanelFocusView, setPanelVisible, shapesForLegacyContent, withPanelEdit, writePanelShape } from './panelStore'
import { PanelCommandsProvider } from './PanelHeader'
import { isTextInputTarget } from './panelSurface'
import { applyTheme, builtInTheme } from './theme'
import { debounce } from './utils'
import { buildPanelArchitectureReport, type PanelArchitectureReport } from './panelArchitectureReport'
import { PanelArchitectureReportView } from './PanelArchitectureReportView'
import { HelpAbout } from './HelpAbout'
import type { Moment, PanelLayout, PanelType } from './types'

const shapeUtils = [PanelShapeUtil]

export default function App() {
  useEffect(() => applyTheme(builtInTheme), [])
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  )
}

function AppContent() {
  const appState = useAppState()
  const { spotify, moments, panels } = appState
  const [callbackStatus, setCallbackStatus] = useState<string | null>(null)
  const callbackHandledRef = useRef(false)
  const [isPanMode, setIsPanMode] = useState(false)
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null)
  const [isCanvasReady, setIsCanvasReady] = useState(false)
  const [chromeHeight, setChromeHeight] = useState(0)
  const [architectureReport, setArchitectureReport] = useState<PanelArchitectureReport | null>(null)
  const [isHelpAboutOpen, setIsHelpAboutOpen] = useState(false)
  // previousPanelGeometryRef stays the source of truth for restoring geometry;
  // this mirrors it purely so the root element re-renders when a panel enters
  // or leaves full screen.
  const [fullScreenPanelId, setFullScreenPanelId] = useState<string | null>(null)
  const helpAboutReturnFocusRef = useRef<HTMLElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const chromeRectRef = useRef<AppChromeRect | null>(null)
  const restoringCanvasRef = useRef(false)
  const persistCanvasRef = useRef<ReturnType<typeof debounce> | null>(null)
  const momentsRef = useRef(moments)
  const panelsRef = useRef(panels)
  const appStateRef = useRef(appState)
  const previousPanelGeometryRef = useRef(new Map<string, PanelLayout>())
  const preFocusPanelGeometryRef = useRef(new Map<string, PanelLayout>())

  useEffect(() => {
    momentsRef.current = moments
    panelsRef.current = panels
    appStateRef.current = appState
  }, [appState, moments, panels])

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

  /**
   * Puts a moment on the canvas. A moment that has been opened before carries
   * tldraw's document and is loaded as it is, ids and all. One that has not
   * (a new moment, an import, or one saved before the document was the unit
   * of persistence) carries its panels in the older shape; they become
   * shapes here, once, and the document that results is saved back so the
   * older shape is never read again.
   *
   * Loading is not something the user did on the canvas, so none of it goes
   * into the undo history, and whatever history there was is cleared: it
   * could only refer to shapes of another moment.
   */
  const restoreCanvas = useCallback((editor: Editor, moment: Moment) => {
    restoringCanvasRef.current = true
    try {
      editor.run(() => {
        if (moment.document) {
          loadSnapshot(editor.store, moment.document)
        } else {
          const existing = listPanelShapes(editor)
          if (existing.length) editor.deleteShapes(existing.map((shape) => shape.id))
          editor.createShapes(shapesForLegacyContent(moment.legacy ?? { panels: [], canvas: null }))
        }
        editor.selectNone()
        setSelectedPanelId(null)
        const camera = moment.camera ?? moment.legacy?.canvas?.camera ?? null
        if (camera) editor.setCamera(camera)
        else fitBoundsInUsableViewport(editor, getPanelBounds(editor), null)
      }, { history: 'ignore', ignoreShapeLock: true })
      editor.clearHistory()
      if (!moment.document) momentsRef.current.updateDocument(getSnapshot(editor.store).document, editor.getCamera())
    } finally {
      restoringCanvasRef.current = false
    }
    previousPanelGeometryRef.current.clear()
    preFocusPanelGeometryRef.current.clear()
    setFullScreenPanelId(null)
    // Through the ref, not the value: the panels state is rebuilt whenever a
    // shape changes, and a restore changes every shape. Depending on it here
    // would make the restore re-run itself.
    panelsRef.current.markRestored(moment.id)
  }, [])

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    panelsRef.current.attachEditor(editor)
    setIsCanvasReady(true)
    // tldraw otherwise picks its menu language from the browser, so the same
    // build reads differently machine to machine. This app is written in
    // English, so keep its wording fixed. The colour scheme is the theme's
    // to choose: theme.css hands tldraw the app's palette under the names of
    // that scheme, so the two must agree or tldraw's menus and outlines fall
    // back to its own colours.
    editor.user.updateUserPreferences({ locale: 'en', colorScheme: builtInTheme.tldrawColorScheme })
    if (moments.activeMoment) restoreCanvas(editor, moments.activeMoment)

    // Whatever changes on the canvas, by the user's hand or the app's, the
    // document snapshot is what the moment keeps. Loads are the one exception
    // and are fenced off by the ref.
    const saveNow = () => {
      if (restoringCanvasRef.current) return
      momentsRef.current.updateDocument(getSnapshot(editor.store).document, editor.getCamera())
    }
    const persist = debounce(saveNow, 300)
    persistCanvasRef.current = persist
    // A flush takes a fresh snapshot rather than only firing a pending save:
    // tldraw delivers store changes on the next animation frame, and a hidden
    // tab has no frames, so a change made just before the tab was hidden may
    // not have reached the listener below at all. The same is true when the
    // tab goes hidden or is closed, so both save directly too.
    const unregisterCanvasFlush = moments.registerCanvasFlush(() => {
      persist.cancel()
      saveNow()
    })
    const saveWhenLeaving = () => {
      if (document.visibilityState === 'hidden') {
        persist.cancel()
        saveNow()
      }
    }
    document.addEventListener('visibilitychange', saveWhenLeaving)
    window.addEventListener('pagehide', saveWhenLeaving)
    const removeStoreListener = editor.store.listen(() => {
      if (!restoringCanvasRef.current) persist()
    }, { source: 'all', scope: 'all' })

    // A copy of a panel shape arrives with the original's panelId (tldraw's
    // duplicate and alt-drag both copy props verbatim). The copy gets its own
    // identity and a fresh config from the registry, or, for a kind that
    // allows only one, is removed again. This runs inside tldraw's
    // transaction, so undo and redo treat the fix-up as part of the copy.
    const removeCopyHandler = editor.sideEffects.registerBeforeCreateHandler('shape', (record, source) => {
      if (source !== 'user' || restoringCanvasRef.current || !isPanelShape(record)) return record
      const shape = record as PanelShape
      const twin = listPanelShapes(editor).find((candidate) => candidate.id !== shape.id && candidate.props.panelId === shape.props.panelId)
      if (!twin) return record
      const definition = getPanelDefinition(shape.props.panel.type)
      const config = (definition.duplicateConfig as (config: PanelShape['props']['panel']['config']) => PanelShape['props']['panel']['config'] | null)(shape.props.panel.config)
      if (!config) {
        setCallbackStatus(`Only one ${definition.label} panel is allowed on the canvas.`)
        queueMicrotask(() => { if (editor.getShape(shape.id)) editor.run(() => editor.deleteShapes([shape.id]), { history: 'ignore' }) })
        return record
      }
      return { ...record, props: { ...shape.props, panelId: `${shape.props.panelId}-${Math.random().toString(36).slice(2, 8)}`, panel: { type: shape.props.panel.type, config } } } as typeof record
    })

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
      if (isTextInputTarget(event.target)) return
      const selectedShapeIds = editor.getSelectedShapeIds()
      if (!selectedShapeIds.length) return
      event.preventDefault()
      editor.markHistoryStoppingPoint('delete panel')
      editor.deleteShapes(selectedShapeIds)
    }

    window.addEventListener('keydown', handleKeyDown)
    // The agent surface: everything on the canvas as data, and every verb the
    // UI has as a command that takes data.
    window.myStates = createCanvasApi(editor, () => appStateRef.current)
    return () => {
      unregisterCanvasFlush()
      persist.cancel()
      removeCopyHandler()
      persistCanvasRef.current = null
      removeStoreListener()
      removeSelectionListener()
      document.removeEventListener('visibilitychange', saveWhenLeaving)
      window.removeEventListener('pagehide', saveWhenLeaving)
      window.removeEventListener('keydown', handleKeyDown)
      delete window.myStates
      editorRef.current = null
      panelsRef.current.attachEditor(null)
      panelsRef.current.markRestored(null)
      setIsCanvasReady(false)
      setSelectedPanelId(null)
    }
  }, [restoreCanvas, moments.activeMoment?.id, moments.registerCanvasFlush])

  const hidePanel = useCallback((panelId: string) => {
    const editor = editorRef.current
    if (!editor) return
    setPanelVisible(editor, panelId, false)
    editor.selectNone()
    setSelectedPanelId(null)
  }, [])

  const hideSelectedPanel = useCallback(() => {
    const selected = editorRef.current?.getSelectedShapes() ?? []
    if (selected.length === 1 && isPanelShape(selected[0])) hidePanel(selected[0].props.panelId)
  }, [hidePanel])

  const togglePanelFullScreen = useCallback((panelId: string) => {
    const editor = editorRef.current
    const shape = editor ? getPanelShape(editor, panelId) : undefined
    if (!editor || !shape) return
    const previous = previousPanelGeometryRef.current.get(panelId)
    if (previous) {
      writePanelShape(editor, panelId, { x: previous.x, y: previous.y, rotation: previous.rotation ?? 0, props: { w: previous.w, h: previous.h } })
      previousPanelGeometryRef.current.delete(panelId)
      setFullScreenPanelId(null)
      return
    }
    previousPanelGeometryRef.current.set(panelId, panelShapeToLayout(shape))
    setFullScreenPanelId(panelId)
    const viewport = editor.getViewportScreenBounds()
    const bounds = getFullScreenPanelLayout(
      { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
      chromeRectRef.current?.bottom,
      (point) => editor.screenToPage(point),
    )
    withPanelEdit(editor, 'expand panel', () => {
      writePanelShape(editor, panelId, { x: bounds.x, y: bounds.y, props: { w: bounds.w, h: bounds.h } })
      // A full-screen panel may overlap existing panels. Keep it above them
      // so the action is immediately useful without a second arrange command.
      editor.bringToFront([shape.id])
    })
  }, [])

  const togglePanelFocusView = useCallback((panelId: string) => {
    const editor = editorRef.current
    const shape = editor ? getPanelShape(editor, panelId) : undefined
    if (!editor || !shape) return
    const panel = panelFromShape(shape)
    const focused = isPanelInFocusView(panel)
    const beforeFocus = preFocusPanelGeometryRef.current.get(panelId)
    withPanelEdit(editor, focused ? 'leave focus view' : 'enter focus view', () => {
      setPanelFocusView(editor, panelId, !focused)
      // A panel whose focus view has no size of its own keeps the one it has,
      // so there is no geometry to swap: the Images panel hands the room its
      // controls used to take to the picture rather than shrinking away from it.
      if (!getPanelFocusViewSize(panel.type)) return
      if (focused) {
        const restored = beforeFocus ?? restorePanelDefaultSize(panelShapeToLayout(shape), panel.type)
        preFocusPanelGeometryRef.current.delete(panelId)
        writePanelShape(editor, panelId, { x: restored.x, y: restored.y, props: { w: restored.w, h: restored.h } })
        return
      }
      // A panel shrunk from full screen is no longer full screen, so the size
      // it had before being expanded becomes the size focus view gives back.
      preFocusPanelGeometryRef.current.set(panelId, previousPanelGeometryRef.current.get(panelId) ?? panelShapeToLayout(shape))
      previousPanelGeometryRef.current.delete(panelId)
      setFullScreenPanelId(null)
      const layout = applyPanelFocusViewSize(panelShapeToLayout(shape), panel.type)
      writePanelShape(editor, panelId, { x: layout.x, y: layout.y, props: { w: layout.w, h: layout.h } })
      editor.bringToFront([shape.id])
    })
  }, [])

  const restorePanelDefaultSizeForId = useCallback((panelId: string) => {
    const editor = editorRef.current
    const shape = editor ? getPanelShape(editor, panelId) : undefined
    if (!editor || !shape) return
    const panel = panelFromShape(shape)
    previousPanelGeometryRef.current.delete(panelId)
    preFocusPanelGeometryRef.current.delete(panelId)
    setFullScreenPanelId(null)
    const layout = restorePanelDefaultLayout(panelShapeToLayout(shape), panel.type)
    // The default size is the whole panel, so it also leaves the focus view.
    writePanelShape(editor, panelId, { x: layout.x, y: layout.y, props: { w: layout.w, h: layout.h, focusView: false } })
  }, [])

  const addPanel = useCallback((panelType: PanelType) => {
    if (!editorRef.current) {
      setCallbackStatus('The canvas is not ready yet.')
      return
    }
    const added = panels.add(panelType)
    if (!added) {
      setCallbackStatus(`Only one ${getPanelDefinition(panelType).label} panel is allowed on the canvas. Restore the existing panel from the panel view menu if it is hidden.`)
      return
    }
    setCallbackStatus(null)
  }, [panels])

  const hideSelectedPanelRef = useRef(hideSelectedPanel)

  useEffect(() => {
    hideSelectedPanelRef.current = hideSelectedPanel
  }, [hideSelectedPanel])

  const restorePanel = useCallback((panelId: string) => {
    const editor = editorRef.current
    const shape = editor ? getPanelShape(editor, panelId) : undefined
    if (!editor || !shape) return
    withPanelEdit(editor, 'show panel', () => {
      setPanelVisible(editor, panelId, true)
      editor.bringToFront([shape.id])
    }, { ignoreShapeLock: true })
  }, [])

  const fitAllPanels = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !getPanelBounds(editor)) {
      setCallbackStatus('There are no panels available to fit.')
      return
    }
    setCallbackStatus(null)
    fitBoundsInUsableViewport(editor, getPanelBounds(editor), chromeRectRef.current)
  }, [])

  const fitSelectedPanel = useCallback(() => {
    const editor = editorRef.current
    const bounds = editor ? getSelectedPanelPageBounds(editor) : null
    if (!editor || !bounds) {
      setCallbackStatus('Select exactly one panel to fit it into view.')
      return
    }
    setCallbackStatus(null)
    fitBoundsInUsableViewport(editor, bounds, chromeRectRef.current)
  }, [])

  const resetSelectedPanel = useCallback(() => {
    const editor = editorRef.current
    const selected = editor?.getSelectedShapes() ?? []
    if (!editor || selected.length !== 1 || !isPanelShape(selected[0])) {
      setCallbackStatus('Select exactly one panel to reset its size.')
      return
    }
    setCallbackStatus(null)
    const shape = selected[0]
    const panel = panelFromShape(shape)
    previousPanelGeometryRef.current.delete(panel.id)
    preFocusPanelGeometryRef.current.delete(panel.id)
    setFullScreenPanelId(null)
    const reset = restorePanelDefaultSize(panelShapeToLayout(shape), panel.type)
    // Same rule as the panel header's restore button: a default-sized panel
    // shows its whole contents rather than the focus view.
    writePanelShape(editor, panel.id, { x: reset.x, y: reset.y, props: { w: reset.w, h: reset.h, focusView: false } })
  }, [])

  const resetPanelLayout = useCallback(() => {
    const editor = editorRef.current
    if (!editor) {
      setCallbackStatus('The canvas is not ready yet.')
      return
    }
    const confirmed = window.confirm('Reset panel layout? This puts every panel back to its original position and size, and brings back any hidden panels. Your Spotify, images, and notes are kept.')
    if (!confirmed) return

    setCallbackStatus(null)
    withPanelEdit(editor, 'reset panel layout', () => {
      for (const shape of listPanelShapes(editor)) {
        const layout = getCanonicalPanelLayout(shape.props.panel.type)
        // Every panel is back at its original size and place, shown, and out
        // of the reduced focus view.
        writePanelShape(editor, shape.props.panelId, {
          x: layout.x,
          y: layout.y,
          rotation: 0,
          isLocked: false,
          props: { w: layout.w, h: layout.h, visible: true, focusView: false },
        })
      }
      editor.selectNone()
      setSelectedPanelId(null)
      fitBoundsInUsableViewport(editor, getPanelBounds(editor), chromeRectRef.current)
    }, { ignoreShapeLock: true })
    previousPanelGeometryRef.current.clear()
    preFocusPanelGeometryRef.current.clear()
    setFullScreenPanelId(null)
  }, [])

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

  // The report reads the moment as last written, not the one in React state,
  // because the document is kept out of state.
  const openArchitectureReport = useCallback(() => {
    const editor = editorRef.current
    const moment = moments.getActiveMomentRecord()
    if (!editor || !moment) return
    setArchitectureReport(buildPanelArchitectureReport(moment, editor))
  }, [moments])

  const latestMoment = moments.getActiveMomentRecord()
  const displayedArchitectureReport = architectureReport && latestMoment && editorRef.current
    ? buildPanelArchitectureReport(latestMoment, editorRef.current)
    : architectureReport

  const openHelpAbout = useCallback(() => {
    helpAboutReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setIsHelpAboutOpen(true)
  }, [])

  const closeHelpAbout = useCallback(() => setIsHelpAboutOpen(false), [])

  useEffect(() => {
    if (editorRef.current && moments.activeMoment) restoreCanvas(editorRef.current, moments.activeMoment)
  }, [restoreCanvas, moments.activeMoment?.id])

  // tldraw remounts components.MenuPanel whenever its reference changes, which would wipe
  // AppChrome's internal state (e.g. the About-button pulse) on almost every interaction.
  // AppChromeMenuPanel is a stable reference that reads these props from context instead.
  const appChromeProps = {
    isCanvasReady,
    isPanMode,
    canUseSelectedPanel: selectedPanelId !== null,
    onTogglePanMode: togglePanMode,
    onFitAllPanels: fitAllPanels,
    onFitSelectedPanel: fitSelectedPanel,
    onResetSelectedPanel: resetSelectedPanel,
    onResetPanelLayout: resetPanelLayout,
    canHideSelectedPanel: selectedPanelId !== null,
    hiddenPanels: panels.all.filter((panel) => panel.visible === false).map((panel) => ({ id: panel.id, type: panel.type })),
    onHideSelectedPanel: hideSelectedPanel,
    onRestorePanel: restorePanel,
    onAddPanel: addPanel,
    onOpenArchitectureReport: openArchitectureReport,
    onOpenHelpAbout: openHelpAbout,
    onMeasure: handleChromeMeasure,
  }

  // One moment is one page, so tldraw's "Move to page" has nowhere to move a
  // panel to. Declaring the limit hides that submenu instead of leaving a
  // dead end in the menu.
  const editorOptions = useMemo(() => ({ maxPages: 1 }), [])

  const uiOverrides = useMemo<TLUiOverrides>(() => ({
    actions: (editor, actions) => {
      // Neither of these applies to a panel: "Flatten to image" rasterises a
      // shape, and panels are live HTML; locking one leaves it stuck with no
      // way back now that the Edit submenu is gone. Removing the actions also
      // unbinds their keyboard shortcuts, which a hidden menu item would not.
      const { 'flatten-to-image': _flattenToImage, 'toggle-lock': _toggleLock, duplicate, ...remaining } = actions
      return {
        ...remaining,
        duplicate: {
          ...duplicate,
          onSelect: (source) => {
            const selected = editor.getSelectedShapes()
            const selectedShape = selected.length === 1 ? selected[0] : undefined
            const definition = selectedShape && isPanelShape(selectedShape) ? getPanelDefinition(selectedShape.props.panel.type) : undefined
            if (definition?.singleton) {
              setCallbackStatus(`The ${definition.label} panel cannot be duplicated. Only one ${definition.label} panel is allowed on the canvas.`)
              return
            }
            duplicate.onSelect(source)
          },
        },
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
      MenuPanel: AppChromeMenuPanel,
      TopPanel: null,
      ContextMenu: CanvasContextMenu,
    }),
    [],
  )

  if (!moments.isReady) {
    return <main className="app-root app-loading">Loading moments...</main>
  }

  return (
    <main
      className="app-root"
      data-panel-full-screen={fullScreenPanelId ? 'true' : undefined}
      style={{ '--app-chrome-height': `${chromeHeight}px` } as CSSProperties}
    >
      <PanelCommandsProvider commands={{ hidePanel, togglePanelFullScreen, restorePanelDefaultSize: restorePanelDefaultSizeForId, isPanelFullScreen: (panelId) => previousPanelGeometryRef.current.has(panelId), togglePanelFocusView }}>
        <AppChromePropsProvider value={appChromeProps}>
          <Tldraw shapeUtils={shapeUtils} components={components} overrides={uiOverrides} options={editorOptions} onMount={handleMount} />
        </AppChromePropsProvider>
      </PanelCommandsProvider>
      {displayedArchitectureReport ? <PanelArchitectureReportView report={displayedArchitectureReport} onClose={() => setArchitectureReport(null)} /> : null}
      <HelpAbout isOpen={isHelpAboutOpen} onClose={closeHelpAbout} returnFocusRef={helpAboutReturnFocusRef} />
      {moments.error ? <div className="callback-toast">{moments.error}</div> : null}
      {callbackStatus ? <div className="callback-toast">{callbackStatus}</div> : null}
    </main>
  )
}

function panelShapeToLayout(shape: PanelShape): PanelLayout {
  return {
    panelId: shape.props.panelId,
    x: shape.x,
    y: shape.y,
    w: shape.props.w,
    h: shape.props.h,
    rotation: shape.rotation,
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
