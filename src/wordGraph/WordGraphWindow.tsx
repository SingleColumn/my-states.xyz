import { WordGraphView } from './WordGraphView'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { markPointerEventHandled } from '../panelSurface'
import type { WordGraphRequest } from './WordGraphController'
import './wordGraph.css'
import { requestWordGraph } from '../ai/service'
import type { WordGraph } from './wordGraphTypes'
import { relationshipTypes } from './wordGraphTypes'
import type { SavedWordGraph } from './wordGraphStorage'
import { readWordGraphSettings } from './wordGraphSettings'

interface Rect { x: number; y: number; width: number; height: number }
function viewport(): Rect {
  // Keep the application toolbar accessible even when maximized.
  const chrome = document.querySelector('.app-chrome')?.getBoundingClientRect()
  const top = Math.max(8, (chrome?.bottom ?? 48) + 8)
  return { x: 8, y: top, width: Math.max(1, innerWidth - 16), height: Math.max(1, innerHeight - top - 8) }
}
function clamp(rect: Rect): Rect {
  const bounds = viewport()
  const width = Math.min(bounds.width, Math.max(Math.min(380, bounds.width), rect.width))
  const height = Math.min(bounds.height, Math.max(Math.min(300, bounds.height), rect.height))
  return { width, height, x: Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - width)), y: Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - height)) }
}

type Presentation = SavedWordGraph['presentation']

export function WordGraphWindow({ request, onGraphReady, onPresentationChange, onClose }: { request: WordGraphRequest; onGraphReady(graph: WordGraph, presentation: Partial<Presentation>): void; onPresentationChange?(presentation: Partial<Presentation>): void; onClose(): void }) {
  const [graph, setGraph] = useState<import('./wordGraphTypes').WordGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const requestId = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const root = useRef<HTMLElement>(null)
  const restoredWindow = request.restoredPresentation?.window
  const [rect, setRect] = useState(() => clamp(restoredWindow ?? { ...request.anchor, width: 700, height: 500 }))
  const [maximized, setMaximized] = useState(() => restoredWindow?.maximized ?? false)
  const [bounds, setBounds] = useState(viewport)
  const rectRef = useRef(rect)
  const maximizedRef = useRef(maximized)
  const presentationRef = useRef<Partial<Presentation>>(request.restoredPresentation ?? {})
  const gesture = useRef<{ pointer: number; element: HTMLElement; mode: 'move' | 'resize'; x: number; y: number; rect: Rect } | null>(null)
  function changePresentation(next: Partial<Presentation>) {
    presentationRef.current = { ...presentationRef.current, ...next }
    onPresentationChange?.(next)
  }
  function changeWindow(nextRect: Rect, nextMaximized: boolean) {
    changePresentation({ window: { ...nextRect, maximized: nextMaximized } })
  }
  function completeGeneration(id: number, value: WordGraph) {
    if (id !== requestId.current) return
    setGraph(value)
    onGraphReady(value, presentationRef.current)
    setLoading(false)
  }
  function failGeneration(id: number, value: unknown) {
    if (id !== requestId.current || (value as { name?: string })?.name === 'AbortError') return
    setError(value instanceof Error ? value.message : 'The graph could not be generated.')
    setLoading(false)
  }
  function generate() {
    const id = ++requestId.current
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setLoading(true)
    setError(null)
    setGraph(null)
    void requestWordGraph({ word: request.word, context: request.context, ...readWordGraphSettings(), relationshipTypes: [...relationshipTypes] }, controller.signal)
      .then(value => completeGeneration(id, value))
      .catch(value => failGeneration(id, value))
  }
  useEffect(() => {
    if (request.restoredGraph) { setGraph(request.restoredGraph); setLoading(false); return undefined }
    generate()
    return () => { requestId.current += 1; abort.current?.abort() }
  }, [request.word, request.context, request.restoredGraph])
  useEffect(() => {
    root.current?.focus({ preventScroll: true })
    const resize = () => { setBounds(viewport()); setRect(current => { const next = clamp(current); rectRef.current = next; return next }) }
    const wheel = (event: WheelEvent) => { event.preventDefault(); event.stopPropagation() }
    // tldraw also registers hotkeys on body. Stop native bubbling before body,
    // while leaving the browser's Tab, checkbox and button defaults available.
    const key = (event: KeyboardEvent) => {
      const higherOverlay = [...document.querySelectorAll('[aria-modal="true"], [role="menu"]')]
        .some(node => node.getClientRects().length > 0 && !root.current?.contains(node))
      if (higherOverlay && event.key === 'Escape') return
      event.stopPropagation()
      // Browser clipboard defaults can target the retained Notes selection,
      // even while focus is in this non-editable window.
      if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'x', 'v', 'd', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault()
      if (event.type === 'keydown' && event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Delete' || event.key === 'Backspace') event.preventDefault()
    }
    const clipboard = (event: Event) => { event.preventDefault(); event.stopPropagation() }
    const element = root.current!
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('keydown', key)
    element.addEventListener('keyup', key)
    const clipboardEvents = ['copy', 'cut', 'paste']
    clipboardEvents.forEach(name => element.addEventListener(name, clipboard))
    window.addEventListener('resize', resize)
    return () => {
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('keydown', key)
      element.removeEventListener('keyup', key)
      clipboardEvents.forEach(name => element.removeEventListener(name, clipboard))
      window.removeEventListener('resize', resize)
      const active = gesture.current
      if (active?.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer)
    }
  }, [onClose])
  function begin(event: PointerEvent<HTMLElement>, mode: 'move' | 'resize') {
    if (maximized || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { pointer: event.pointerId, element: event.currentTarget, mode, x: event.clientX, y: event.clientY, rect }
  }
  function move(event: PointerEvent) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    const dx = event.clientX - active.x, dy = event.clientY - active.y
    const next = clamp(active.mode === 'move'
      ? { ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy }
      : { ...active.rect, width: Math.min(active.rect.width + dx, bounds.x + bounds.width - active.rect.x), height: Math.min(active.rect.height + dy, bounds.y + bounds.height - active.rect.y) })
    rectRef.current = next
    setRect(next)
  }
  function end(event: PointerEvent) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    gesture.current = null
    if (active.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer)
    changeWindow(rectRef.current, maximizedRef.current)
  }
  const shown = maximized ? bounds : rect
  return createPortal(<section ref={root} className="word-graph-window" role="dialog" aria-label="Word Graph" tabIndex={-1}
    style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height }}
    onPointerDownCapture={event => {
      markPointerEventHandled(event)
      if (!(event.target instanceof Element && event.target.closest('button, input'))) root.current?.focus({ preventScroll: true })
    }}
    onPointerDown={event => event.stopPropagation()} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}>
    <header className="word-graph-header">
      <div className="word-graph-drag" data-testid="word-graph-drag" onPointerDown={event => begin(event, 'move')}>
        <strong>Word Graph</strong><span>{request.word}</span>
      </div>
      <button className="card-icon-button" aria-label={maximized ? 'Restore Word Graph' : 'Maximize Word Graph'} onClick={() => setMaximized(value => { const next = !value; maximizedRef.current = next; changeWindow(rectRef.current, next); return next })}>{maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      <button className="card-icon-button" aria-label="Close Word Graph" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="word-graph-content">{loading ? <p className="word-graph-status">Generating associations…</p> : error ? <div className="word-graph-status"><p>{error}</p><button type="button" className="app-chrome-control" onClick={generate}>Try again</button></div> : graph ? <>
      {graph.generation?.status === 'partial' ? <div className="word-graph-incomplete" role="status"><span>Graph incomplete: {graph.generation.failedRequests} AI request{graph.generation.failedRequests === 1 ? '' : 's'} failed.</span><button type="button" className="app-chrome-control" onClick={generate}>Try again</button></div> : null}
      <WordGraphView graph={graph} presentation={request.restoredPresentation} onPresentationChange={changePresentation} />
    </> : null}</div>
    {!maximized ? <div role="separator" aria-label="Resize Word Graph" title="Drag to resize" className="word-graph-resize" onPointerDown={event => begin(event, 'resize')} /> : null}
  </section>, document.body)
}
