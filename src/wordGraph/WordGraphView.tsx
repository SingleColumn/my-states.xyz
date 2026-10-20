import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { WordGraph } from './wordGraphTypes'
import { relationshipTypes, type RelationshipType } from './wordGraphTypes'
import { visibleGraph } from './wordGraphVisibility'

type Point = { x: number; y: number }
type Camera = Point & { zoom: number }
export interface WordGraphPresentation { expandedNodeIds?: string[]; enabledRelationshipTypes?: RelationshipType[]; nodePositions?: Record<string, Point>; viewport?: Camera }
const dashes = ['', '5 3', '2 3', '8 3 2 3', '1 4', '10 5']

function initialPositions(graph: WordGraph): Record<string, Point> {
  const positions: Record<string, Point> = { [graph.rootId]: { x: 0, y: 0 } }
  const first = graph.nodes.filter(node => node.depth === 1)
  first.forEach((node, i) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / first.length
    positions[node.id] = { x: Math.cos(angle) * 145, y: Math.sin(angle) * 105 }
    const children = graph.edges.filter(edge => edge.source === node.id).map(edge => edge.target)
    children.forEach((id, j) => {
      if (positions[id] || id === graph.rootId || graph.nodes.find(node => node.id === id)?.depth !== 2) return
      const childAngle = angle + (j - (children.length - 1) / 2) * 0.38
      positions[id] = { x: Math.cos(childAngle) * 260, y: Math.sin(childAngle) * 180 }
    })
  })
  graph.nodes.forEach((node, i) => {
    if (!positions[node.id]) positions[node.id] = { x: Math.cos(i * 2.4) * 300, y: Math.sin(i * 2.4) * 190 }
  })
  return positions
}

export function WordGraphView({ graph, presentation, onPresentationChange }: { graph: WordGraph; presentation?: WordGraphPresentation; onPresentationChange?(presentation: Partial<WordGraphPresentation>): void }) {
  const svg = useRef<SVGSVGElement>(null)
  const [positions, setPositions] = useState(() => ({ ...initialPositions(graph), ...(presentation?.nodePositions ?? {}) }))
  const [camera, setCamera] = useState<Camera>(presentation?.viewport ?? { x: 0, y: 0, zoom: 1 })
  const [expanded, setExpanded] = useState(() => new Set(presentation?.expandedNodeIds ?? [graph.rootId]))
  const [enabled, setEnabled] = useState(() => new Set<RelationshipType>(presentation?.enabledRelationshipTypes ?? relationshipTypes))
  function notify(next: Partial<WordGraphPresentation>) { onPresentationChange?.(next) }
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
  function toggle(id: string) {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      notify({ expandedNodeIds: [...next] })
      return next
    })
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || gesture.current) return
    event.preventDefault()
    event.stopPropagation()
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
      setPositions(current => { const next = { ...current, [id]: { x: position.x + dx / active.camera.zoom, y: position.y + dy / active.camera.zoom } }; notify({ nodePositions: next }); return next })
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
    <p className="word-graph-hint">Sample associations &middot; Click words to explore &middot; Drag space to pan &middot; Scroll to zoom</p>
    <svg ref={svg} className="word-graph-svg" viewBox="-360 -220 720 440" aria-label="Word associations" data-zoom={camera.zoom}
      onPointerDown={down} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}>
      <g data-testid="graph-viewport" transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
        {visible.edges.map(edge => <line key={edge.id} data-relationship={edge.relationship} data-edge-id={edge.id}
          x1={positions[edge.source].x} y1={positions[edge.source].y} x2={positions[edge.target].x} y2={positions[edge.target].y}
          strokeDasharray={dashes[relationshipTypes.indexOf(edge.relationship)]}><title>{edge.relationship}</title></line>)}
        {visible.nodes.map(node => {
          const hasChildren = graph.edges.some(edge => edge.source === node.id)
          return <g key={node.id} role="button" tabIndex={0} aria-label={node.label} aria-expanded={hasChildren ? expanded.has(node.id) : undefined}
            data-node-id={node.id} data-root={node.id === graph.rootId} transform={`translate(${positions[node.id].x} ${positions[node.id].y})`}>
            <title>{node.label}{hasChildren ? (expanded.has(node.id) ? ' - click to collapse' : ' - click to expand') : ''}</title>
            <rect x={-Math.min(105, Math.max(30, node.label.length * 4.5))} y={-17} width={Math.min(210, Math.max(60, node.label.length * 9))} height={34} rx={17} />
            <circle r={node.id === graph.rootId ? 4 : 2.5} cy={-22} />
            <text textAnchor="middle" dominantBaseline="central">{node.label.length > 23 ? `${node.label.slice(0, 22)}...` : node.label}</text>
            {hasChildren ? <text className="word-graph-expander" textAnchor="middle" y={29}>{expanded.has(node.id) ? '-' : '+'}</text> : null}
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
        {type}
      </label>)}
    </fieldset>
  </>
}
