import type { WordGraph } from './wordGraphTypes'
import { NODE_HEIGHT, spanningTree, type Point } from './wordGraphLayout'

/** The ids of the connections that make up the branching structure: a word and the word it hangs off.
 * Every other connection joins two words that are not directly branching from one another. */
export function branchingEdgeIds(graph: WordGraph) {
  const { children } = spanningTree(graph)
  return new Set(graph.edges
    .filter(edge => children.get(edge.source)?.includes(edge.target) || children.get(edge.target)?.includes(edge.source))
    .map(edge => edge.id))
}

type Line = { x1: number; y1: number; x2: number; y2: number }
type Word = Point & { width: number }

/** How far a point is from a word's pill (negative inside it). */
function distanceToWord(point: Point, word: Word) {
  const half = Math.max(0, word.width / 2 - NODE_HEIGHT / 2)
  return Math.hypot(Math.max(Math.abs(point.x - word.x) - half, 0), point.y - word.y) - NODE_HEIGHT / 2
}

/** Kept this far from every word the arc is not joined to, when it can be. */
export const ARC_CLEARANCE = 16
// How far the arc's control point may sit from the middle of the chord, tried smallest first.
const BOWS = [0, 40, 80, 130, 190, 260, 340]
const SAMPLES = 28

/** A curve from one end of a line to the other that stays clear of the other words. It is a straight
 * line when that already clears them; otherwise the gentlest bow, to either side, that does. When no
 * bow clears everything, the one that comes closest to doing so. */
export function arcAround(line: Line, others: readonly Word[]) {
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1, length = Math.hypot(dx, dy)
  const straight = `M${line.x1} ${line.y1}L${line.x2} ${line.y2}`
  if (length < 1e-6) return { d: straight, bow: 0 }
  // Unit normal to the chord: positive bows go one way round it, negative the other.
  const nx = -dy / length, ny = dx / length
  const mx = (line.x1 + line.x2) / 2, my = (line.y1 + line.y2) / 2

  function clearanceOf(bow: number) {
    // A quadratic curve bulges half as far as its control point is pushed.
    const cx = mx + nx * bow, cy = my + ny * bow
    let worst = Infinity
    for (let i = 1; i < SAMPLES; i++) {
      const t = i / SAMPLES, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t
      const point = { x: a * line.x1 + b * cx + c * line.x2, y: a * line.y1 + b * cy + c * line.y2 }
      for (const word of others) worst = Math.min(worst, distanceToWord(point, word))
    }
    return worst
  }

  let best = { bow: 0, clearance: -Infinity }
  for (const size of BOWS) {
    for (const bow of size === 0 ? [0] : [size, -size]) {
      const clearance = clearanceOf(bow)
      if (clearance >= ARC_CLEARANCE) return { d: curve(bow), bow }
      if (clearance > best.clearance) best = { bow, clearance }
    }
  }
  return { d: curve(best.bow), bow: best.bow }

  function curve(bow: number) {
    return bow === 0 ? straight : `M${line.x1} ${line.y1}Q${mx + nx * bow} ${my + ny * bow} ${line.x2} ${line.y2}`
  }
}
