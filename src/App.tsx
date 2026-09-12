import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, Tldraw, TLShape, type TLUiOverrides } from 'tldraw'
import { CanvasContextMenu } from './CanvasContextMenu'
import { AppChromeMenuPanel, AppChromePropsProvider, type AppChromeRect } from './AppChrome'
import { AppStateProvider, useAppState } from './AppState'
import { fitEditorToBounds, getChromeAwareInsets, getPanelBounds, getSelectedPanelPageBounds } from './canvasView'
import { PANEL_SHAPE_TYPE, PanelShape, PanelShapeUtil } from './PanelShape'
import { getCanonicalPanelLayout, getPanelFocusViewSize, getRenderablePanelLayouts, isPanelInFocusView, isPanelVisible, mergeVisiblePanelLayouts, resetAllPanelLayouts, showAllPanels } from './panelLayout'
import { applyPanelFocusViewSize, getFullScreenPanelLayout, restorePanelDefaultLayout, restorePanelDefaultSize } from './panelGeometry'
import { PanelCommandsProvider } from './PanelHeader'
import { debounce } from './utils'
import { createPanel } from './storage'
import { duplicatePanel } from './panelDuplication'
import { buildPanelArchitectureReport, type PanelArchitectureReport } from './panelArchitectureReport'
import { PanelArchitectureReportView } from './PanelArchitectureReportView'
import { HelpAbout } from './HelpAbout'
import type { CanvasState, Panel, PanelLayout, PanelType } from './types'

const shapeUtils = [PanelShapeUtil]

export default function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  )
}

function AppContent() {
  const { spotify, moments } = useAppState()
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
  const programmaticCanvasMutationRef = useRef(false)
  const persistCanvasRef = useRef<ReturnType<typeof debounce> | null>(null)
  const updateCanvasRef = useRef(moments.updateCanvas)
  const momentPanelsRef = useRef<Panel[]>(moments.activeMoment?.panels ?? [])
  const momentCanvasRef = useRef<CanvasState | null>(moments.activeMoment?.canvas ?? null)
  const previousPanelGeometryRef = useRef(new Map<string, PanelLayout>())
  const preFocusPanelGeometryRef = useRef(new Map<string, PanelLayout>())
  // Deleting a panel removes two things that live in different stores: the
  // tldraw shape, and the Panel record holding its type and configuration.
  // Only the shape is in tldraw's undo history, so an undo brought back a
  // shape whose panel was gone and rendered "This panel is no longer
  // available". The removed record is kept here so the shape's return can put
  // it back. Entries are only reachable while the history that created them
  // is, so loading a moment clears both together.
  const deletedPanelsRef = useRef(new Map<string, Panel>())

  useEffect(() => {
    updateCanvasRef.current = moments.updateCanvas
  }, [moments.updateCanvas])

  useEffect(() => {
    momentPanelsRef.current = moments.activeMoment?.panels ?? []
    momentCanvasRef.current = moments.activeMoment?.canvas ?? null
  }, [moments.activeMoment?.canvas, moments.activeMoment?.panels])

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
      // Loading a moment is not something the user did on the canvas, so it
      // must not become an undo step. Left in history, Undo after opening a
      // moment reversed the load: it deleted the freshly created shapes --
      // and, through the after-delete side effect, the new moment's panel
      // records with them -- and brought back the previous moment's shapes,
      // now pointing at panels that live in another moment. Any history
      // that survives the switch refers to shapes that no longer exist, so it
      // is cleared outright rather than merely bypassed.
      editor.run(() => {
        const existingPanels = editor.getCurrentPageShapes().filter(isPanelShape)
        if (existingPanels.length) editor.deleteShapes(existingPanels.map((shape) => shape.id))
        const layouts = getRenderablePanelLayouts(momentPanelsRef.current, canvas)
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
      }, { history: 'ignore' })
      editor.clearHistory()
      deletedPanelsRef.current.clear()
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
    restoreCanvas(editor, moments.activeMoment?.canvas ?? null)

    const persist = debounce(() => {
      if (!restoringCanvasRef.current && !programmaticCanvasMutationRef.current) {
        updateCanvasRef.current(persistCanvas(editor, momentPanelsRef.current, momentCanvasRef.current))
      }
    }, 300)
    persistCanvasRef.current = persist
    const unregisterCanvasFlush = moments.registerCanvasFlush(() => {
      persist.flush()
    })
    // Re-key duplicated panel shapes inside tldraw's creation transaction. A
    // later store listener/update can race with the duplicate command and
    // leave the new shape pointing at a panel that does not exist yet.
    const removeDuplicatePanelHandler = editor.sideEffects.registerBeforeCreateHandler('shape', (record, source) => {
      if (source !== 'user' || restoringCanvasRef.current || programmaticCanvasMutationRef.current) return record
      if (record.type !== PANEL_SHAPE_TYPE) return record

      const shape = record as PanelShape
      const panel = momentPanelsRef.current.find((candidate) => candidate.id === shape.props.panelId)
      if (!panel) return record

      const duplicate = duplicatePanel(panel)
      if (!duplicate) return record

      moments.addPanels([duplicate])
      return {
        ...record,
        props: {
          ...shape.props,
          panelId: duplicate.id,
        },
      }
    })
    const removePanelAfterDeleteHandler = editor.sideEffects.registerAfterDeleteHandler('shape', (record) => {
      if (restoringCanvasRef.current || programmaticCanvasMutationRef.current || !isPanelShape(record)) return
      const panelId = record.props.panelId
      const panel = momentPanelsRef.current.find((candidate) => candidate.id === panelId)
      if (panel) deletedPanelsRef.current.set(panelId, panel)
      // Drop it from the ref here rather than waiting for the moment state to
      // round-trip through React. The create handlers read this ref to decide
      // whether a shape's panel is missing, and an undo can re-create the
      // shape before that re-render has happened.
      momentPanelsRef.current = momentPanelsRef.current.filter((candidate) => candidate.id !== panelId)
      moments.removePanel(panelId)
    })
    // The other half of the delete above: a panel shape that comes back
    // without its record came back through undo, so give the record back too.
    // Deliberately not gated on the change source, because what matters is
    // that this exact panel was deleted here and its shape has returned.
    const restorePanelAfterCreateHandler = editor.sideEffects.registerAfterCreateHandler('shape', (record) => {
      if (restoringCanvasRef.current || programmaticCanvasMutationRef.current || !isPanelShape(record)) return
      const panelId = record.props.panelId
      if (momentPanelsRef.current.some((candidate) => candidate.id === panelId)) return
      const deleted = deletedPanelsRef.current.get(panelId)
      if (!deleted) return
      deletedPanelsRef.current.delete(panelId)
      momentPanelsRef.current = [...momentPanelsRef.current, deleted]
      moments.addPanels([deleted])
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
      for (const panelId of selectedPanelIds) moments.removePanel(panelId)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      unregisterCanvasFlush()
      persist.cancel()
      removeDuplicatePanelHandler()
      removePanelAfterDeleteHandler()
      restorePanelAfterCreateHandler()
      persistCanvasRef.current = null
      removeStoreListener()
      removeSelectionListener()
      window.removeEventListener('keydown', handleKeyDown)
      editorRef.current = null
      setIsCanvasReady(false)
      setSelectedPanelId(null)
    }
  }, [restoreCanvas, moments.activeMoment?.id, moments.registerCanvasFlush])

  const runProgrammaticCanvasMutation = useCallback((mutation: (editor: Editor) => void) => {
    const editor = editorRef.current
    if (!editor) return false

    persistCanvasRef.current?.cancel()
    programmaticCanvasMutationRef.current = true
    try {
      mutation(editor)
      updateCanvasRef.current(persistCanvas(editor, momentPanelsRef.current, momentCanvasRef.current))
      return true
    } finally {
      programmaticCanvasMutationRef.current = false
    }
  }, [])

  const hidePanel = useCallback((panelId: string) => {
    const editor = editorRef.current
    const shape = editor?.getCurrentPageShapes().find((candidate) => isPanelShape(candidate) && candidate.props.panelId === panelId)
    if (!editor || !shape || !isPanelShape(shape)) return
    momentCanvasRef.current = {
      camera: editor.getCamera(),
      panels: [
        ...(momentCanvasRef.current?.panels ?? []).filter((layout) => layout.panelId !== panelId),
        panelShapeToLayout(shape),
      ],
    }
    momentPanelsRef.current = momentPanelsRef.current.map((panel) => panel.id === panelId ? { ...panel, visible: false } : panel)
    moments.setPanelVisibility(panelId, false)
    runProgrammaticCanvasMutation((editor) => {
      editor.deleteShapes([shape.id])
      editor.selectNone()
      setSelectedPanelId(null)
    })
  }, [runProgrammaticCanvasMutation, moments])

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
        setFullScreenPanelId(null)
        return
      }
      previousPanelGeometryRef.current.set(panelId, panelShapeToLayout(shape))
      setFullScreenPanelId(panelId)
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

  const togglePanelFocusView = useCallback((panelId: string) => {
    const editor = editorRef.current
    const shape = editor?.getCurrentPageShapes().find((candidate) => isPanelShape(candidate) && candidate.props.panelId === panelId)
    const panel = moments.activeMoment?.panels.find((candidate) => candidate.id === panelId)
    if (!editor || !shape || !isPanelShape(shape) || !panel) return
    const focused = isPanelInFocusView(panel)
    const beforeFocus = preFocusPanelGeometryRef.current.get(panelId)
    // The focus view is part of the panel, not of this canvas moment, so it is
    // saved with the panel and survives a reload alongside its smaller geometry.
    moments.updatePanel(panelId, (current) => ({ ...current, focusView: !focused, updatedAt: Date.now() }))
    // A panel whose focus view has no size of its own keeps the one it has, so
    // there is no geometry to swap: the Images panel hands the room its controls
    // used to take to the picture rather than shrinking away from it.
    if (!getPanelFocusViewSize(panel.type)) return
    runProgrammaticCanvasMutation((currentEditor) => {
      if (focused) {
        const restored = beforeFocus ?? restorePanelDefaultSize(panelShapeToLayout(shape), panel.type)
        preFocusPanelGeometryRef.current.delete(panelId)
        currentEditor.updateShapes([{ id: shape.id, type: PANEL_SHAPE_TYPE, x: restored.x, y: restored.y, props: { w: restored.w, h: restored.h, panelId } }] as never)
        return
      }
      // A panel shrunk from full screen is no longer full screen, so the size it
      // had before being expanded becomes the size focus view gives back.
      preFocusPanelGeometryRef.current.set(panelId, previousPanelGeometryRef.current.get(panelId) ?? panelShapeToLayout(shape))
      previousPanelGeometryRef.current.delete(panelId)
      setFullScreenPanelId(null)
      const layout = applyPanelFocusViewSize(panelShapeToLayout(shape), panel.type)
      currentEditor.updateShapes([{ id: shape.id, type: PANEL_SHAPE_TYPE, x: layout.x, y: layout.y, props: { w: layout.w, h: layout.h, panelId } }] as never)
      currentEditor.bringToFront([shape.id])
    })
  }, [runProgrammaticCanvasMutation, moments])

  const restorePanelDefaultSizeForId = useCallback((panelId: string) => {
    const editor = editorRef.current
    const shape = editor?.getCurrentPageShapes().find((candidate) => isPanelShape(candidate) && candidate.props.panelId === panelId)
    const panel = moments.activeMoment?.panels.find((candidate) => candidate.id === panelId)
    if (!editor || !shape || !isPanelShape(shape) || !panel) return
    previousPanelGeometryRef.current.delete(panelId)
    preFocusPanelGeometryRef.current.delete(panelId)
    setFullScreenPanelId(null)
    // The default size is the whole panel, so it also leaves the focus view.
    if (isPanelInFocusView(panel)) moments.updatePanel(panelId, (current) => ({ ...current, focusView: false, updatedAt: Date.now() }))
    runProgrammaticCanvasMutation((currentEditor) => {
      const layout = restorePanelDefaultLayout(panelShapeToLayout(shape), panel.type)
      currentEditor.updateShapes([{ id: shape.id, type: PANEL_SHAPE_TYPE, x: layout.x, y: layout.y, props: { w: layout.w, h: layout.h, panelId } }] as never)
    })
  }, [runProgrammaticCanvasMutation, moments])

  const addPanel = useCallback((panelType: PanelType) => {
    const editor = editorRef.current
    const moment = moments.activeMoment
    if (!editor || !moment) return
    if (panelType === 'spotify' && moment.panels.some((panel) => panel.type === 'spotify')) {
      setCallbackStatus('Only one Music panel is allowed on the canvas. Restore the existing panel from the panel view menu if it is hidden.')
      return
    }

    const panel = createPanel(panelType)
    const canonical = getCanonicalPanelLayout(panelType)
    momentPanelsRef.current = [...momentPanelsRef.current, panel]
    moments.addPanels([panel])
    const changed = runProgrammaticCanvasMutation((currentEditor) => {
      currentEditor.createShapes([{
        type: PANEL_SHAPE_TYPE,
        x: canonical.x,
        y: canonical.y,
        props: { w: canonical.w, h: canonical.h, panelId: panel.id },
      }] as never)
    })
    if (!changed) setCallbackStatus('The canvas is not ready yet.')
    else setCallbackStatus(null)
  }, [runProgrammaticCanvasMutation, moments])

  const hideSelectedPanelRef = useRef(hideSelectedPanel)

  useEffect(() => {
    hideSelectedPanelRef.current = hideSelectedPanel
  }, [hideSelectedPanel])

  const restorePanel = useCallback((panelId: string) => {
    const panel = moments.activeMoment?.panels.find((candidate) => candidate.id === panelId)
    if (!panel) return
    const layout = moments.activeMoment?.canvas?.panels.find((candidate) => candidate.panelId === panelId) ?? (() => {
      const canonical = getCanonicalPanelLayout(panel.type)
      return { panelId, x: canonical.x, y: canonical.y, w: canonical.w, h: canonical.h, rotation: 0 }
    })()
    momentPanelsRef.current = momentPanelsRef.current.map((candidate) => candidate.id === panelId ? { ...candidate, visible: true } : candidate)
    moments.setPanelVisibility(panelId, true)
    runProgrammaticCanvasMutation((editor) => {
      if (editor.getCurrentPageShapes().some((shape) => isPanelShape(shape) && shape.props.panelId === panelId)) return
      editor.createShapes([{ type: PANEL_SHAPE_TYPE, x: layout.x, y: layout.y, rotation: layout.rotation ?? 0, props: { w: layout.w, h: layout.h, panelId } }] as never)
    })
  }, [runProgrammaticCanvasMutation, moments.activeMoment])

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
      const panel = moments.activeMoment?.panels.find((candidate) => candidate.id === shape.props.panelId)
      if (!panel) return
      previousPanelGeometryRef.current.delete(panel.id)
      preFocusPanelGeometryRef.current.delete(panel.id)
      // Same rule as the panel header's restore button: a default-sized panel
      // shows its whole contents rather than the focus view.
      if (isPanelInFocusView(panel)) moments.updatePanel(panel.id, (current) => ({ ...current, focusView: false, updatedAt: Date.now() }))
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
  }, [runProgrammaticCanvasMutation, moments])

  const resetPanelLayout = useCallback(() => {
    const confirmed = window.confirm('Reset panel layout? This puts every panel back to its original position and size, and brings back any hidden panels. Your Spotify, images, and notes are kept.')
    if (!confirmed) return

    setCallbackStatus(null)
    const changed = runProgrammaticCanvasMutation((editor) => {
      const canonicalLayouts = (moments.activeMoment?.panels ?? []).map((panel, order) => {
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
      for (const panel of momentPanelsRef.current) {
        if (!isPanelVisible(panel)) moments.setPanelVisibility(panel.id, true)
        // Every panel is back at its original size, so none of them is in the
        // reduced focus view any more.
        if (isPanelInFocusView(panel)) moments.updatePanel(panel.id, (current) => ({ ...current, focusView: false, updatedAt: Date.now() }))
      }
      previousPanelGeometryRef.current.clear()
      preFocusPanelGeometryRef.current.clear()
      momentPanelsRef.current = showAllPanels(momentPanelsRef.current)
      if (editor) moments.updateCanvas({ camera: editor.getCamera(), panels: resetAllPanelLayouts(moments.activeMoment?.panels ?? []) })
    }
    if (!changed) setCallbackStatus('The canvas is not ready yet.')
  }, [runProgrammaticCanvasMutation, moments])

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
    const moment = moments.activeMoment
    if (!editor || !moment) return
    setArchitectureReport(buildPanelArchitectureReport(moment, editor))
  }, [moments.activeMoment])

  const displayedArchitectureReport = architectureReport && moments.activeMoment && editorRef.current
    ? buildPanelArchitectureReport(moments.activeMoment, editorRef.current)
    : architectureReport

  const openHelpAbout = useCallback(() => {
    helpAboutReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setIsHelpAboutOpen(true)
  }, [])

  const closeHelpAbout = useCallback(() => setIsHelpAboutOpen(false), [])

  useEffect(() => {
    if (editorRef.current && moments.activeMoment) restoreCanvas(editorRef.current, moments.activeMoment.canvas)
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
    hiddenPanels: (moments.activeMoment?.panels ?? []).filter((panel) => !isPanelVisible(panel)).map((panel) => ({ id: panel.id, type: panel.type })),
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
            const selectedPanel = selectedShape && isPanelShape(selectedShape) ? selectedShape : undefined
            const selectedMusicPanel = selectedPanel !== undefined
              && momentPanelsRef.current.find((panel) => panel.id === selectedPanel.props.panelId)?.type === 'spotify'
            if (selectedMusicPanel) {
              setCallbackStatus('Music panel cannot be duplicated. Only one Music panel is allowed on the canvas.')
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

function persistCanvas(editor: Editor, momentPanels: readonly Panel[], existingCanvas: CanvasState | null) {
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
  return { camera: editor.getCamera(), panels: mergeVisiblePanelLayouts(momentPanels, existingCanvas, visiblePanels) }
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
