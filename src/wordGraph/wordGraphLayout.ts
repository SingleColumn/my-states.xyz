import type { WordGraph } from './wordGraphTypes'

export type Point = { x: number; y: number }

export const NODE_HEIGHT = 34
/** Space between a node's pill and the end of any line that touches it. */
export const EDGE_GAP = 12
/** The expand/collapse badge sits on the node's outer side, inside that gap. */
export const BADGE_RADIUS = 7
const BADGE_AIR = 2
/** Gap between a badge and the start of the connectors that fan out of it. */
export const HUB_GAP = 5
/** A connection is never drawn shorter than this, so linked words never sit on top of each other. */
export const MIN_LINE_LENGTH = 36
/** Words that a connector isn't joined to stay at least this far from it, so a line's end is clearly nearer its own word than any other. */
export const CONNECTOR_CLEARANCE = 30
// A word is never pushed further out than this multiple of its ring, however narrow its slice of the circle.
const MAX_STRETCH = 2.2
const MIN_RING_STEP = 110
// Room around each pill for the badge, so neighbours never crowd it.
const NODE_PADDING = 26

const MAX_LABEL = 23
/** What the graph prints for a word: very long ones are cut short. */
export function shownLabel(label: string) { return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}...` : label }

type TextMeasurer = (text: string) => number
let measurer: TextMeasurer | null = null
const measured = new Map<string, number>()
/** Lets the browser view supply real text widths; tests and other callers fall back to an estimate. */
export function setTextMeasurer(next: TextMeasurer | null) { measurer = next; measured.clear() }

/** Width of the pill around a word: its printed width plus breathing room. */
export function nodeWidth(label: string) {
  const text = shownLabel(label)
  let width = measured.get(text)
  if (width === undefined) {
    width = measurer ? measurer(text) : text.length * 8.5
    measured.set(text, width)
  }
  return Math.min(210, Math.max(40, Math.ceil(width) + 20))
}

type Side = 'top' | 'bottom' | 'left' | 'right'
/** How a direction is turned into a side of a word; see sideFacing. */
export type SideRule = 'pill' | 'angle'

/** Which side of a pill faces a direction: the side that direction would cross. Pills are wider than
 * tall, so only near-horizontal directions land on the left or right. A zero direction faces down. */
function sideFacing(width: number, dx: number, dy: number, rule: SideRule = 'pill'): Side {
  if (!dx && !dy) return 'bottom'
  // 'angle' splits directions at 45 degrees; 'pill' follows the word's own shape, so only near-horizontal
  // directions reach the left and right.
  const horizontal = rule === 'angle' ? Math.abs(dx) >= Math.abs(dy) : Math.abs(dx) * NODE_HEIGHT > Math.abs(dy) * width
  return horizontal ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top')
}

/** The middle of a pill's side, pushed `distance` out from it. */
function sideMiddle(side: Side, width: number, distance: number): Point {
  return side === 'left' ? { x: -(width / 2 + distance), y: 0 }
    : side === 'right' ? { x: width / 2 + distance, y: 0 }
    : { x: 0, y: (side === 'top' ? -1 : 1) * (NODE_HEIGHT / 2 + distance) }
}

/** Which side a node's badge goes on: the one facing the words it reveals, so every connector can fan
 * out of it. With no words to face, or when they surround it (as the root's do), it faces away from
 * the middle of the graph, and the root's goes below. */
function badgeSide(position: Point, width: number, targets: readonly Point[], rule: SideRule = 'pill'): Side {
  const origin = Math.hypot(position.x, position.y)
  // Words further out than this one are the ones expanding it reveals; links back inwards don't count.
  const further = targets.filter(target => Math.hypot(target.x, target.y) > origin)
  const facing = further.length ? further : targets
  let ux = 0, uy = 0
  for (const target of facing) {
    const length = Math.hypot(target.x - position.x, target.y - position.y)
    if (length > 1e-6) { ux += (target.x - position.x) / length; uy += (target.y - position.y) / length }
  }
  if (!facing.length || Math.hypot(ux, uy) < 0.25 * facing.length) { ux = position.x; uy = position.y }
  return sideFacing(width, ux, uy, rule)
}

/** Where a node's expand/collapse badge goes, centred just outside the side it faces. */
export function badgeCenter(position: Point, width: number, targets: readonly Point[] = []): Point {
  return sideMiddle(badgeSide(position, width, targets), width, BADGE_AIR + BADGE_RADIUS)
}

/** Lays out the whole graph, hidden nodes included. Each branch owns an angular
 * wedge sized by how many words it can eventually reveal, so expanding a node
 * only fills space that was already set aside and never moves or covers
 * anything that is on screen.
 */
export function layoutGraph(graph: WordGraph): Record<string, Point> {
  const { children, order } = spanningTree(graph)
  const weight = new Map<string, number>()
  for (const id of [...order].reverse()) {
    const kids = children.get(id)!
    weight.set(id, kids.length ? kids.reduce((sum, kid) => sum + weight.get(kid)!, 0) : 1)
  }

  const positions: Record<string, Point> = { [graph.rootId]: { x: 0, y: 0 } }
  const wedge = new Map([[graph.rootId, { start: -Math.PI / 2, end: Math.PI * 1.5, level: 0 }]])
  const widthOf = new Map(graph.nodes.map(node => [node.id, nodeWidth(node.label)]))
  // How far each word is pushed beyond its ring so that it and its clearance fit in its slice of the circle.
  const stretch = new Map([[graph.rootId, 1]])
  const ringX = (level: number) => 170 + 190 * level, ringY = (level: number) => 105 + 95 * level
  for (const id of order) {
    const { start, end, level } = wedge.get(id)!
    let cursor = start
    // Square-rooted so a big branch gets more room without squeezing its small siblings together.
    const share = (kid: string) => Math.sqrt(weight.get(kid)!)
    const total = children.get(id)!.reduce((sum, kid) => sum + share(kid), 0)
    for (const kid of children.get(id)!) {
      const span = (end - start) * share(kid) / total
      wedge.set(kid, { start: cursor, end: cursor + span, level: level + 1 })
      const angle = cursor + span / 2
      // Wider than tall: labels are wide, so rings need more horizontal room.
      const rx = ringX(level), ry = ringY(level)
      // The room a word takes up along the ring depends on which way the ring runs where it sits.
      const tangentX = -Math.sin(angle) * rx, tangentY = Math.cos(angle) * ry, tangent = Math.hypot(tangentX, tangentY) || 1
      const occupied = (Math.abs(tangentX) * widthOf.get(kid)! + Math.abs(tangentY) * NODE_HEIGHT) / tangent
      const reach = Math.hypot(Math.cos(angle) * rx, Math.sin(angle) * ry)
      let push = Math.min(MAX_STRETCH, Math.max(1, (occupied + CONNECTOR_CLEARANCE) / (span * reach)))
      // Never closer in than the word it hangs off, whatever that word's own stretch.
      if (id !== graph.rootId) push = Math.max(push, (stretch.get(id)! * ringX(level - 1) + MIN_RING_STEP) / rx)
      stretch.set(kid, push)
      positions[kid] = { x: Math.cos(angle) * rx * push, y: Math.sin(angle) * ry * push }
      cursor += span
    }
  }
  separate(graph, positions)
  return positions
}

/** Each word hangs off the first word that reaches it, walking outward from the
 * root. Further links to the same word stay as ordinary lines across the graph. */
export function spanningTree(graph: WordGraph) {
  const neighbours = new Map(graph.nodes.map(node => [node.id, [] as string[]]))
  for (const edge of graph.edges) {
    neighbours.get(edge.source)?.push(edge.target)
    neighbours.get(edge.target)?.push(edge.source)
  }
  const children = new Map(graph.nodes.map(node => [node.id, [] as string[]]))
  const seen = new Set([graph.rootId])
  const order = [graph.rootId]
  // Breadth-first keeps `order` parent-before-child.
  function growFrom(start: number) {
    for (let i = start; i < order.length; i++) {
      for (const next of neighbours.get(order[i]) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        children.get(order[i])!.push(next)
        order.push(next)
      }
    }
  }
  growFrom(0)
  // Words with no path to the root still need a place, so hang them off it.
  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    children.get(graph.rootId)!.push(node.id)
    order.push(node.id)
    growFrom(order.length - 1)
  }
  return { children, order }
}

/** Nudges words apart until none overlap and every connection is drawn at least MIN_LINE_LENGTH long. The root stays at the origin; everything else
 * is pushed, so the result is deterministic. */
function separate(graph: WordGraph, positions: Record<string, Point>) {
  const nodes = graph.nodes.map(node => ({ id: node.id, width: nodeWidth(node.label) }))
  const { connector: draw } = graphGeometry(graph)
  // Constraints count as met within a quarter unit, so the passes settle instead of chasing tiny leftovers.
  const TOLERANCE = 0.25
  const shares = (a: string, b: string) => a === graph.rootId ? [0, 1] : b === graph.rootId ? [1, 0] : [0.5, 0.5]
  for (let pass = 0; pass < 400; pass++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions[nodes[i].id], b = positions[nodes[j].id]
        const dx = b.x - a.x, dy = b.y - a.y
        const overlapX = (nodes[i].width + nodes[j].width) / 2 + NODE_PADDING - Math.abs(dx)
        const overlapY = NODE_HEIGHT + NODE_PADDING - Math.abs(dy)
        if (overlapX <= TOLERANCE || overlapY <= TOLERANCE) continue
        moved = true
        const horizontal = overlapX < overlapY
        const amount = horizontal ? overlapX : overlapY
        const delta = horizontal ? dx : dy
        const direction = delta === 0 ? (i % 2 ? 1 : -1) : Math.sign(delta)
        // The root never moves, so its neighbour takes the whole shift.
        const [shareA, shareB] = shares(nodes[i].id, nodes[j].id)
        const axis = horizontal ? 'x' : 'y'
        a[axis] -= direction * amount * shareA
        b[axis] += direction * amount * shareB
      }
    }
    for (const edge of graph.edges) {
      const a = positions[edge.source], b = positions[edge.target]
      const line = draw(positions, edge)
      const drawn = Math.hypot(line.x2 - line.x1, line.y2 - line.y1)
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
      const ux = length > 1e-6 ? dx / length : 1, uy = length > 1e-6 ? dy / length : 0
      const [shareA, shareB] = shares(edge.source, edge.target)
      if (drawn < MIN_LINE_LENGTH - TOLERANCE) {
        moved = true
        const push = MIN_LINE_LENGTH - drawn
        a.x -= ux * push * shareA; a.y -= uy * push * shareA
        b.x += ux * push * shareB; b.y += uy * push * shareB
        continue
      }
      // Keep every other word clear of the line, so its end is clearly nearer its own word than any neighbour.
      for (const other of nodes) {
        if (other.id === edge.source || other.id === edge.target) continue
        const spot = positions[other.id]
        const { clearance, awayX, awayY } = clearanceFromLine(line, spot, other.width)
        if (clearance >= CONNECTOR_CLEARANCE - TOLERANCE) continue
        moved = true
        const push = CONNECTOR_CLEARANCE - clearance
        // Away from the line, or sideways off it when the word sits right on it.
        let vx = awayX, vy = awayY
        const away = Math.hypot(vx, vy)
        if (away < 1e-6) { vx = -(line.y2 - line.y1); vy = line.x2 - line.x1 }
        const unit = Math.hypot(vx, vy) || 1
        vx /= unit; vy /= unit
        if (other.id === graph.rootId) {
          // The root stays put, so the connector's own words give way instead.
          a.x -= vx * push * shareB; a.y -= vy * push * shareB
          b.x -= vx * push * shareA; b.y -= vy * push * shareA
        } else {
          spot.x += vx * push; spot.y += vy * push
        }
      }
    }
    if (!moved) break
  }
}

/** Draws connectors and places badges for one graph. The lookups are built once, so the layout can redraw
 * every connector on each of its many passes without rescanning the graph. */
export function graphGeometry(graph: WordGraph, options: { rule?: SideRule } = {}) {
  const rule = options.rule ?? 'pill'
  const labels = new Map(graph.nodes.map(node => [node.id, node.label]))
  const revealed = new Map<string, string[]>()
  for (const edge of graph.edges) revealed.set(edge.source, [...(revealed.get(edge.source) ?? []), edge.target])
  const widthOf = (id: string) => nodeWidth(labels.get(id)!)
  const place = (position: Point, offset: Point) => ({ x: position.x + offset.x, y: position.y + offset.y })

  /** The side of a word its badge is on, or null when it has nothing to reveal. */
  function badgeSideOf(positions: Record<string, Point>, id: string) {
    const targets = revealed.get(id)
    return targets ? badgeSide(positions[id], widthOf(id), targets.map(target => positions[target]), rule) : null
  }
  function badgeOffset(positions: Record<string, Point>, id: string): Point | null {
    const side = badgeSideOf(positions, id)
    return side ? sideMiddle(side, widthOf(id), BADGE_AIR + BADGE_RADIUS) : null
  }

  /** The line to draw for a connection. It leaves and arrives at the middle of whichever side of each
   * word faces the other, EDGE_GAP clear of the pill, so every word has at most four fixed attachment
   * points. Where that side holds the word's badge, the line starts or ends just clear of the badge
   * instead, so the badge reads as the point the word's connections fan out from. */
  function connector(positions: Record<string, Point>, edge: { source: string; target: string }) {
    const source = positions[edge.source], target = positions[edge.target]
    const sourceWidth = widthOf(edge.source), targetWidth = widthOf(edge.target)
    const sourceSide = sideFacing(sourceWidth, target.x - source.x, target.y - source.y, rule)
    const targetSide = sideFacing(targetWidth, source.x - target.x, source.y - target.y, rule)
    const sourceAnchor = place(source, sideMiddle(sourceSide, sourceWidth, EDGE_GAP))
    const targetAnchor = place(target, sideMiddle(targetSide, targetWidth, EDGE_GAP))

    function anchor(id: string, side: Side, width: number, fallback: Point, towards: Point) {
      if (badgeSideOf(positions, id) !== side) return fallback
      const badge = place(positions[id], sideMiddle(side, width, BADGE_AIR + BADGE_RADIUS))
      const length = Math.hypot(towards.x - badge.x, towards.y - badge.y) || 1
      const reach = BADGE_RADIUS + HUB_GAP
      return { x: badge.x + (towards.x - badge.x) / length * reach, y: badge.y + (towards.y - badge.y) / length * reach }
    }
    const start = anchor(edge.source, sourceSide, sourceWidth, sourceAnchor, targetAnchor)
    const end = anchor(edge.target, targetSide, targetWidth, targetAnchor, sourceAnchor)
    // Words too close together to fit the attachment points between them get no line at all.
    if ((end.x - start.x) * (target.x - source.x) + (end.y - start.y) * (target.y - source.y) <= 0) {
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      return { x1: mid.x, y1: mid.y, x2: mid.x, y2: mid.y }
    }
    return { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
  }
  return { badgeOffset, connector }
}

/** Where a word's badge sits relative to the word, or null when it has nothing to reveal. */
export function badgeOffset(graph: WordGraph, positions: Record<string, Point>, id: string) {
  return graphGeometry(graph).badgeOffset(positions, id)
}

/** The line to draw for a connection; see graphGeometry. */
export function connector(graph: WordGraph, positions: Record<string, Point>, edge: { source: string; target: string }) {
  return graphGeometry(graph).connector(positions, edge)
}

/** Closest approach between two line segments: where on each they are, and how far apart. */
function segmentGap(a1: Point, a2: Point, b1: Point, b2: Point) {
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const d1 = cross(b1, b2, a1), d2 = cross(b1, b2, a2), d3 = cross(a1, a2, b1), d4 = cross(a1, a2, b2)
  if (d1 * d2 < 0 && d3 * d4 < 0) {
    const t = d1 / (d1 - d2), crossing = { x: a1.x + (a2.x - a1.x) * t, y: a1.y + (a2.y - a1.y) * t }
    return { distance: 0, onA: crossing, onB: crossing }
  }
  const nearest = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y, span = dx * dx + dy * dy
    const t = span ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / span)) : 0
    return { x: a.x + dx * t, y: a.y + dy * t }
  }
  let best = { distance: Infinity, onA: a1, onB: b1 }
  const consider = (onA: Point, onB: Point) => {
    const distance = Math.hypot(onA.x - onB.x, onA.y - onB.y)
    if (distance < best.distance) best = { distance, onA, onB }
  }
  for (const p of [a1, a2]) consider(p, nearest(p, b1, b2))
  for (const p of [b1, b2]) consider(nearest(p, a1, a2), p)
  return best
}

/** How far a drawn line is from a word's pill (negative when it crosses it), and which way the word would
 * have to move to get further away. */
function clearanceFromLine(line: { x1: number; y1: number; x2: number; y2: number }, centre: Point, width: number) {
  const half = Math.max(0, width / 2 - NODE_HEIGHT / 2)
  const gap = segmentGap({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }, { x: centre.x - half, y: centre.y }, { x: centre.x + half, y: centre.y })
  return { clearance: gap.distance - NODE_HEIGHT / 2, awayX: gap.onB.x - gap.onA.x, awayY: gap.onB.y - gap.onA.y }
}

/** Every place a connector passes closer to a word it is not joined to than `clearance`
 * (CONNECTOR_CLEARANCE unless told otherwise), drawing lines with the given side rule. */
export function crowdedConnectors(graph: WordGraph, positions: Record<string, Point>, options: { rule?: SideRule; clearance?: number } = {}) {
  const limit = options.clearance ?? CONNECTOR_CLEARANCE
  const found: { source: string; target: string; word: string; clearance: number }[] = []
  const { connector: draw } = graphGeometry(graph, { rule: options.rule })
  for (const edge of graph.edges) {
    const line = draw(positions, edge)
    if (line.x1 === line.x2 && line.y1 === line.y2) continue
    for (const node of graph.nodes) {
      if (node.id === edge.source || node.id === edge.target) continue
      const { clearance } = clearanceFromLine(line, positions[node.id], nodeWidth(node.label))
      if (clearance < limit - 0.5) found.push({ source: edge.source, target: edge.target, word: node.id, clearance })
    }
  }
  return found
}

export type Camera = Point & { zoom: number }
/** The part of the drawing surface that is on screen, in the same units as node positions. */
export type Region = { left: number; top: number; right: number; bottom: number }
type Placed = Point & { width: number }

export const MIN_ZOOM = 0.35
const FIT_MARGIN = 28
// The badge can sit on any side of a pill, so every side gets room for it.
const PILL_MARGIN = 2 * BADGE_RADIUS + BADGE_AIR + 6

function boundsOf(nodes: readonly Placed[]) {
  return {
    left: Math.min(...nodes.map(node => node.x - node.width / 2 - PILL_MARGIN)), right: Math.max(...nodes.map(node => node.x + node.width / 2 + PILL_MARGIN)),
    top: Math.min(...nodes.map(node => node.y - NODE_HEIGHT / 2 - PILL_MARGIN)), bottom: Math.max(...nodes.map(node => node.y + NODE_HEIGHT / 2 + PILL_MARGIN)),
  }
}

/** True when any part of any node falls outside the visible region. */
export function isOutOfView(nodes: readonly Placed[], camera: Camera, region: Region) {
  if (!nodes.length) return false
  const box = boundsOf(nodes)
  return camera.x + box.left * camera.zoom < region.left || camera.x + box.right * camera.zoom > region.right
    || camera.y + box.top * camera.zoom < region.top || camera.y + box.bottom * camera.zoom > region.bottom
}

/** Centres the nodes in the region, zooming out only as far as needed (never past 1x, never past MIN_ZOOM). */
export function fitCamera(nodes: readonly Placed[], region: Region): Camera {
  const box = boundsOf(nodes)
  const fit = Math.min((region.right - region.left - 2 * FIT_MARGIN) / (box.right - box.left), (region.bottom - region.top - 2 * FIT_MARGIN) / (box.bottom - box.top))
  const zoom = Math.max(MIN_ZOOM, Math.min(1, fit))
  return {
    zoom,
    x: (region.left + region.right) / 2 - zoom * (box.left + box.right) / 2,
    y: (region.top + region.bottom) / 2 - zoom * (box.top + box.bottom) / 2,
  }
}
