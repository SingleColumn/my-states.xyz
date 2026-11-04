import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Editor } from 'tldraw'
import { listPanels } from './panelStore'

/**
 * Moment view: the board made ready for a screenshot. A moment is a picture, a
 * piece of writing and a song, so the panels lose their headers, footers and
 * controls, and everything around them goes.
 *
 * It is a way of looking at the board, not a change to it, so unlike a panel's
 * focus view it is deliberately not stored on the shapes: nothing is saved or
 * added to undo, and leaving it gives back exactly what was there. What it
 * hides is hidden by moment-view.css, keyed on the root attribute set here;
 * only what a stylesheet cannot do reads the flag through useMomentView.
 */
const MomentViewContext = createContext(false)

export const MomentViewProvider = MomentViewContext.Provider

export function useMomentView() {
  return useContext(MomentViewContext)
}

interface SlideshowPlayback {
  isPlayingFor(panelId: string): boolean
  setIsPlaying(value: boolean, panelId?: string): void
}

export function useMomentViewMode(editorRef: MutableRefObject<Editor | null>, slideshowRef: MutableRefObject<SlideshowPlayback>) {
  const [isOn, setIsOn] = useState(false)
  // What to give back on leaving. Kept in a ref because it is only ever read
  // by the handler that leaves.
  const restoreRef = useRef<{ toolId: string; camera: { x: number; y: number; z: number }; playingPanelIds: string[] } | null>(null)

  const enter = useCallback(() => {
    const editor = editorRef.current
    if (!editor || restoreRef.current) return

    // Held before the canvas goes read-only: pausing keeps the picture on
    // show by writing its position to the panel, and tldraw drops every shape
    // write made while read-only. Without the hold a picture could change just
    // as the screenshot is taken.
    const playingPanelIds = listPanels(editor)
      .filter((panel) => panel.type === 'slideshow' && slideshowRef.current.isPlayingFor(panel.id))
      .map((panel) => panel.id)
    for (const panelId of playingPanelIds) slideshowRef.current.setIsPlaying(false, panelId)

    const { x, y, z } = editor.getCamera()
    restoreRef.current = { toolId: editor.getCurrentToolId(), camera: { x, y, z }, playingPanelIds }

    editor.selectNone()
    // The hand tool leaves a drag free to frame the shot; read-only refuses
    // everything else that could change the board, keyboard shortcuts included.
    editor.setCurrentTool('hand')
    editor.updateInstanceState({ isReadonly: true })

    // A caret or a highlighted word would be in the screenshot.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.getSelection()?.removeAllRanges()
    setIsOn(true)
  }, [editorRef, slideshowRef])

  const leave = useCallback(() => {
    const editor = editorRef.current
    const restore = restoreRef.current
    if (!editor || !restore) return
    restoreRef.current = null

    editor.updateInstanceState({ isReadonly: false })
    editor.setCurrentTool(restore.toolId)
    // Moving the view to frame a shot is not moving the board's view.
    editor.setCamera(restore.camera)
    for (const panelId of restore.playingPanelIds) slideshowRef.current.setIsPlaying(true, panelId)
    setIsOn(false)
  }, [editorRef, slideshowRef])

  // A layout effect, so that the view is hidden, measured and moved before the
  // browser draws: nothing is seen at the old position first.
  useLayoutEffect(() => {
    if (!isOn) return
    const root = document.documentElement
    root.dataset.momentView = 'true'
    if (editorRef.current) centreMomentVertically(editorRef.current)

    // Capture phase, so that no key reaches the canvas: read-only stops the
    // board changing, but the shortcuts that change tool still work, and a
    // stray `z` would make the next drag zoom instead of move the view. Zooming
    // is the one thing kept, since it is part of framing the shot. Nothing is
    // prevented, so the browser's and the system's own keys still work,
    // screenshot shortcuts among them.
    function handleKeyDown(event: KeyboardEvent) {
      if (isZoomShortcut(event)) return
      event.stopPropagation()
      if (event.key !== 'Escape') return
      event.preventDefault()
      leave()
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (!isZoomShortcut(event)) event.stopPropagation()
    }

    // The canvas menu acts on panels, and none of its actions apply here.
    function handleContextMenu(event: MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
    }

    const options = { capture: true } as const
    window.addEventListener('keydown', handleKeyDown, options)
    window.addEventListener('keyup', handleKeyUp, options)
    window.addEventListener('contextmenu', handleContextMenu, options)
    return () => {
      delete root.dataset.momentView
      window.removeEventListener('keydown', handleKeyDown, options)
      window.removeEventListener('keyup', handleKeyUp, options)
      window.removeEventListener('contextmenu', handleContextMenu, options)
    }
  }, [isOn, leave, editorRef])

  return { isOn, enter }
}

const MOMENT_EDGE_MARGIN = 16

/**
 * How far to move the view so a moment sits in the middle of the window, in
 * screen pixels. The usual view leaves room above the panels for a toolbar that
 * is gone here. A moment too tall for the window starts near the top instead,
 * because centring it would cut off its top edge, which is where it lines up.
 */
export function momentVerticalShift(top: number, bottom: number, viewportHeight: number) {
  const height = bottom - top
  const targetTop = height > viewportHeight - 2 * MOMENT_EDGE_MARGIN
    ? MOMENT_EDGE_MARGIN
    : (viewportHeight - height) / 2
  return targetTop - top
}

/**
 * Measured from what is on screen rather than from the panels' stored positions,
 * because only the drawn result knows which panels this view has left out.
 */
function centreMomentVertically(editor: Editor) {
  const shown = [...document.querySelectorAll('.canvas-panel-shell')]
    .map((shell) => shell.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
  if (!shown.length) return

  const viewport = editor.getViewportScreenBounds()
  const top = Math.min(...shown.map((rect) => rect.top)) - viewport.y
  const bottom = Math.max(...shown.map((rect) => rect.bottom)) - viewport.y
  const { x, y, z } = editor.getCamera()
  editor.setCamera({ x, y: y + momentVerticalShift(top, bottom, viewport.h) / z, z })
}

function isZoomShortcut(event: KeyboardEvent) {
  return (event.ctrlKey || event.metaKey) && ['=', '+', '-', '0'].includes(event.key)
}
