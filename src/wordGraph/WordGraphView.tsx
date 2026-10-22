import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { WordGraph } from './wordGraphTypes'
import { relationshipTypes, type RelationshipType } from './wordGraphTypes'
import { visibleGraph } from './wordGraphVisibility'
import { BADGE_RADIUS, fitCamera, graphGeometry, isOutOfView, layoutGraph, nodeWidth, NODE_HEIGHT, setTextMeasurer, shownLabel, type Camera, type Point, type Region } from './wordGraphLayout'
import { gridLayout, layoutToRestore, type LayoutMode } from './wordGraphGrid'
import { arcAround, branchingEdgeIds } from './wordGraphLinks'

export interface WordGraphPresentation { expandedNodeIds?: string[]; enabledRelationshipTypes?: RelationshipType[]; nodePositions?: Record<string, Point>; layout?: LayoutMode; viewport?: Camera }
const dashes = ['', '5 3', '2 3', '8 3 2 3']

// Prototype: 'grid' snaps words to shared rows and columns and draws links between non-branching words as faint arcs.
const layoutKey = 'my-states:word-graph-layout'
function storedLayout(): LayoutMode {
  try { return localStorage.getItem(layoutKey) === 'grid' ? 'grid' : 'rings' } catch { return 'rings' }
}
function layoutFor(graph: WordGraph, mode: LayoutMode) { return mode === 'grid' ? gridLayout(graph) : layoutGraph(graph) }

// Pills are sized from the words' real printed width, so the gaps around short and long words look alike.
let measuring = false
function installTextMeasurer() {
  // Environments without a real 2D canvas (such as the test DOM) keep the layout's estimate.
  if (measuring || typeof CanvasRenderingContext2D === 'undefined') return
  try {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return
    context.font = `17px ${getComputedStyle(document.documentElement).getPropertyValue('--font-family-ui').trim() || 'sans-serif'}`
    setTextMeasurer(text => context.measureText(text).width)
    measuring = true
  } catch { /* no canvas here: the layout falls back to an estimate */ }
}

export function WordGraphView({ graph, presentation, onPresentationChange }: { graph: WordGraph; presentation?: WordGraphPresentation; onPresentationChange?(presentation: Partial<WordGraphPresentation>): void }) {
  installTextMeasurer()
  const [mode, setMode] = useState<LayoutMode>(() => layoutToRestore(presentation, storedLayout()))
  const geometry = useMemo(() => graphGeometry(graph, { rule: mode === 'grid' ? 'angle' : 'pill' }), [graph, mode])
  const branching = useMemo(() => branchingEdgeIds(graph), [graph])
  const svg = useRef<SVGSVGElement>(null)
  const [positions, setPositions] = useState(() => ({ ...layoutFor(graph, mode), ...(presentation?.nodePositions ?? {}) }))
  const [camera, setCamera] = useState<Camera>(presentation?.viewport ?? { x: 0, y: 0, zoom: 1 })
  const [expanded, setExpanded] = useState(() => new Set(presentation?.expandedNodeIds ?? [graph.rootId]))
  const [enabled, setEnabled] = useState(() => new Set<RelationshipType>(presentation?.enabledRelationshipTypes ?? relationshipTypes))
  function notify(next: Partial<WordGraphPresentation>) { onPresentationChange?.(next) }
  // Handlers registered once (wheel, keyboard) would otherwise see stale state.
  const latest = useRef({ positions, camera, expanded, enabled })
  latest.current = { positions, camera, expanded, enabled }
  const glide = useRef({ frame: 0, timer: 0 })
  function stopGlide() { cancelAnimationFrame(glide.current.frame); clearTimeout(glide.current.timer) }
  /** The part of the drawing surface on screen, which is wider than the viewBox when the window is. */
  function visibleRegion(): Region {
    const box = svg.current?.getBoundingClientRect()
    if (!box || !box.width || !box.height) return { left: -360, top: -220, right: 360, bottom: 220 }
    const topLeft = point(box.left, box.top), bottomRight = point(box.right, box.bottom)
    return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y }
  }
  function placed(ids: readonly { id: string; label: string }[]) {
    return ids.map(node => ({ ...latest.current.positions[node.id], width: nodeWidth(node.label) }))
  }
  function moveCamera(target: Camera, animate: boolean) {
    stopGlide()
    const from = latest.current.camera
    const finish = () => { stopGlide(); setCamera(target); notify({ viewport: target }) }
    if (!animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return finish()
    const started = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 280), eased = 1 - (1 - t) ** 3
      if (t === 1) return finish()
      setCamera({ x: from.x + (target.x - from.x) * eased, y: from.y + (target.y - from.y) * eased, zoom: from.zoom + (target.zoom - from.zoom) * eased })
      glide.current.frame = requestAnimationFrame(step)
    }
    glide.current.frame = requestAnimationFrame(step)
    // Browsers pause animation frames in hidden tabs; the timer makes sure the view still lands on target.
    glide.current.timer = window.setTimeout(finish, 320)
  }
  // A restored board keeps the view it was saved with; a fresh one starts framed on what is showing.
  useLayoutEffect(() => {
    if (presentation?.viewport) return
    const { expanded, enabled } = latest.current
    setCamera(fitCamera(placed(visibleGraph(graph, expanded, enabled).nodes), visibleRegion()))
  }, [])
  useEffect(() => () => stopGlide(), [])
  const gesture = useRef<{ pointer: number; nodeId: string | null; start: Point; last: Point; moved: boolean; camera: Camera; position: Point | null } | null>(null)
  function point(clientX: number, clientY: number): Point {
    const matrix = svg.current?.getScreenCTM()
    return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : { x: 0, y: 0 }
  }
  useEffect(() => {
    const element = svg.current!
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      stopGlide()
      const p = point(event.clientX, event.clientY)
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      setCamera(current => {
        const zoom = Math.max(0.35, Math.min(3, current.zoom * Math.exp(-delta * 0.002)))
        const ratio = zoom / current.zoom
        const next = { zoom, x: p.x - (p.x - current.x) * ratio, y: p.y - (p.y - current.y) * ratio }; notify({ viewport: next }); return next
      })
    }
    const key = (event: KeyboardEvent) => {
      const id = (event.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id')
      if (id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle(id) }
    }
    element.addEventListener('keydown', key)
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('keydown', key)
      const active = gesture.current
      if (active && element.hasPointerCapture(active.pointer)) element.releasePointerCapture(active.pointer)
    }
  }, [])
  /** Switches layout: words go to the new layout's places, and the view re-frames on them. */
  function chooseLayout(next: LayoutMode) {
    if (next === mode) return
    try { localStorage.setItem(layoutKey, next) } catch { /* the choice just isn't remembered */ }
    const fresh = layoutFor(graph, next)
    setMode(next)
    setPositions(fresh)
    notify({ nodePositions: fresh, layout: next })
    const { expanded: open, enabled: shown } = latest.current
    const nodes = visibleGraph(graph, open, shown).nodes.map(node => ({ ...fresh[node.id], width: nodeWidth(node.label) }))
    moveCamera(fitCamera(nodes, visibleRegion()), true)
  }
  function toggle(id: string) {
    const { expanded: current, enabled, camera: view } = latest.current
    const next = new Set(current)
    const opening = !next.has(id)
    if (opening) next.add(id); else next.delete(id)
    setExpanded(next)
    notify({ expandedNodeIds: [...next] })
    if (!opening) return
    // Only follow the reveal when it would land off screen, so a view the person chose is left alone.
    const before = new Set(visibleGraph(graph, current, enabled).nodes.map(node => node.id))
    const after = visibleGraph(graph, next, enabled).nodes
    if (!isOutOfView(placed(after.filter(node => !before.has(node.id))), view, visibleRegion())) return
    moveCamera(fitCamera(placed(after), visibleRegion()), true)
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || gesture.current) return
    event.preventDefault()
    event.stopPropagation()
    stopGlide()
    const id = (event.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id') ?? null
    const start = point(event.clientX, event.clientY)
    gesture.current = { pointer: event.pointerId, nodeId: id, start, last: { x: event.clientX, y: event.clientY }, moved: false, camera, position: id ? positions[id] : null }
    svg.current!.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    const p = point(event.clientX, event.clientY)
    if (Math.hypot(event.clientX - active.last.x, event.clientY - active.last.y) > 4) active.moved = true
    const dx = p.x - active.start.x, dy = p.y - active.start.y
    if (active.nodeId && active.position) {
      const id = active.nodeId, position = active.position
      setPositions(current => { const next = { ...current, [id]: { x: position.x + dx / active.camera.zoom, y: position.y + dy / active.camera.zoom } }; notify({ nodePositions: next, layout: mode }); return next })
    } else { const next = { ...active.camera, x: active.camera.x + dx, y: active.camera.y + dy }; setCamera(next); notify({ viewport: next }) }
  }
  function end(event: PointerEvent, cancelled = false) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    gesture.current = null
    if (svg.current?.hasPointerCapture(active.pointer)) svg.current.releasePointerCapture(active.pointer)
    if (!cancelled && !active.moved && active.nodeId) toggle(active.nodeId)
  }
  const visible = visibleGraph(graph, expanded, enabled)
  return <>
    <div className="word-graph-toolbar">
      <p className="word-graph-hint">Word associations &middot; Click words to explore &middot; Drag space to pan &middot; Scroll to zoom</p>
      <div className="word-graph-layout-choice" role="group" aria-label="Layout (prototype)">
        <span>Layout</span>
        {(['rings', 'grid'] as const).map(choice => <button key={choice} type="button" aria-pressed={mode === choice} onClick={() => chooseLayout(choice)}>{choice === 'rings' ? 'Rings' : 'Grid'}</button>)}
      </div>
    </div>
    <svg ref={svg} className="word-graph-svg" viewBox="-360 -220 720 440" aria-label="Word associations" data-zoom={camera.zoom}
      onPointerDown={down} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}>
      <g data-testid="graph-viewport" transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
        {visible.edges.map(edge => {
          const line = geometry.connector(positions, edge)
          const dash = dashes[relationshipTypes.indexOf(edge.relationship)]
          if (mode === 'grid' && !branching.has(edge.id)) {
            // A link between words that aren't branching from one another: a faint arc round the words in its way.
            const others = visible.nodes.filter(node => node.id !== edge.source && node.id !== edge.target)
              .map(node => ({ ...positions[node.id], width: nodeWidth(node.label) }))
            return <path key={edge.id} className="word-graph-link" data-relationship={edge.relationship} data-edge-id={edge.id}
              d={arcAround(line, others).d} strokeDasharray={dash}><title>{edge.relationship}</title></path>
          }
          return <line key={edge.id} data-relationship={edge.relationship} data-edge-id={edge.id} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
            strokeDasharray={dash}><title>{edge.relationship}</title></line>
        })}
        {visible.nodes.map(node => {
          const hasChildren = graph.edges.some(edge => edge.source === node.id)
          const isRoot = node.id === graph.rootId, width = nodeWidth(node.label)
          const badge = geometry.badgeOffset(positions, node.id)
          return <g key={node.id} role="button" tabIndex={0} aria-label={node.label} aria-expanded={hasChildren ? expanded.has(node.id) : undefined}
            data-node-id={node.id} data-root={isRoot} transform={`translate(${positions[node.id].x} ${positions[node.id].y})`}>
            <title>{node.label}{hasChildren ? (expanded.has(node.id) ? ' - click to collapse' : ' - click to expand') : ''}</title>
            <rect x={-width / 2} y={-NODE_HEIGHT / 2} width={width} height={NODE_HEIGHT} rx={NODE_HEIGHT / 2} />
            <text textAnchor="middle" dominantBaseline="central">{shownLabel(node.label)}</text>
            {badge ? <g className="word-graph-expander" transform={`translate(${badge.x} ${badge.y})`}>
              <circle r={BADGE_RADIUS} />
              <path d={expanded.has(node.id) ? 'M-3 0H3' : 'M-3 0H3M0 -3V3'} />
            </g> : null}
          </g>
        })}
      </g>
    </svg>
    <fieldset className="word-graph-filters"><legend>Relationships</legend>
      {relationshipTypes.map((type, index) => <label key={type} className={`word-graph-relationship-${type}`}>
        <input type="checkbox" checked={enabled.has(type)} onChange={() => setEnabled(current => {
          const next = new Set(current)
          if (next.has(type)) next.delete(type); else next.add(type)
          notify({ enabledRelationshipTypes: [...next] })
          return next
        })} />
        <svg width="18" height="5" aria-hidden="true"><line x1="0" x2="18" y1="2" y2="2" stroke="currentColor" strokeDasharray={dashes[index]} /></svg>
        {type[0].toUpperCase() + type.slice(1)}
      </label>)}
    </fieldset>
  </>
}
