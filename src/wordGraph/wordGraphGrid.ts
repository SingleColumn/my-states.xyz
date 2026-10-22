import type { WordGraph } from './wordGraphTypes'
import { nodeWidth, NODE_HEIGHT, spanningTree, type Point } from './wordGraphLayout'

/** Clear space between the edges of words in neighbouring columns / rows. 70 is as tight as it can go:
 * a connection between neighbours loses 33 units to the gaps and a badge, so any less and it is drawn
 * shorter than the minimum length. Found by trying combinations on generated graphs of the default size;
 * tighter still would crowd connectors, but at 70 none run through a word and only about 2% pass within
 * 24 units of one they are not joined to. */
const COLUMN_GAP = 70
const ROW_GAP = 70
// How strongly the choice of cell prefers the right direction, the inner rings, and staying near the parent.
const OUTER_RING_PENALTY = 0.3
const PARENT_DISTANCE_PENALTY = 0.06
const SPILL_RINGS = 3

export type Cell = { column: number; row: number }

/** Lays the words out on a grid, so that words in the same row or column line up exactly.
 *
 * The origin sits in the middle cell. Its words take the eight cells around it, their words take the
 * square ring around that, and so on. Each word asks for the free cell, in its ring, that lies closest
 * to the direction of its share of the circle (shares are sized by how many words a branch holds), so
 * branches fan out the way they do in the ring layout, but snapped to shared rows and columns. If a
 * ring has no room left in a word's direction it takes a cell in the next ring out instead.
 */
export function gridLayout(graph: WordGraph, gaps = { column: COLUMN_GAP, row: ROW_GAP }) {
  const cells = gridCells(graph)
  const widthOf = new Map(graph.nodes.map(node => [node.id, nodeWidth(node.label)]))

  // Every occupied column is as wide as its widest word, and every occupied row is one word tall.
  const columns = [...new Set([...cells.values()].map(cell => cell.column))].sort((a, b) => a - b)
  const rows = [...new Set([...cells.values()].map(cell => cell.row))].sort((a, b) => a - b)
  const columnWidth = new Map(columns.map(column => [column, Math.max(...[...cells].filter(([, cell]) => cell.column === column).map(([id]) => widthOf.get(id)!))]))
  const columnX = new Map<number, number>()
  columns.forEach((column, index) => {
    columnX.set(column, index === 0 ? 0 : columnX.get(columns[index - 1])! + (columnWidth.get(columns[index - 1])! + columnWidth.get(column)!) / 2 + gaps.column)
  })
  const rowY = new Map(rows.map((row, index) => [row, index * (NODE_HEIGHT + gaps.row)]))
  // Keep the origin at (0, 0) like every other layout.
  const originX = columnX.get(0)!, originY = rowY.get(0)!

  const positions: Record<string, Point> = {}
  for (const [id, cell] of cells) positions[id] = { x: columnX.get(cell.column)! - originX, y: rowY.get(cell.row)! - originY }
  return positions
}

/** The cell each word is placed in. Exposed so tests can check the structure without the geometry. */
export function gridCells(graph: WordGraph): Map<string, Cell> {
  const { children, order } = spanningTree(graph)
  const weight = new Map<string, number>()
  for (const id of [...order].reverse()) {
    const kids = children.get(id)!
    weight.set(id, kids.length ? kids.reduce((sum, kid) => sum + weight.get(kid)!, 0) : 1)
  }

  const cells = new Map<string, Cell>([[graph.rootId, { column: 0, row: 0 }]])
  const taken = new Set(['0,0'])
  const slice = new Map([[graph.rootId, { start: -Math.PI / 2, end: Math.PI * 1.5, depth: 0 }]])
  for (const id of order) {
    const { start, end, depth } = slice.get(id)!
    const share = (kid: string) => Math.sqrt(weight.get(kid)!)
    const total = children.get(id)!.reduce((sum, kid) => sum + share(kid), 0)
    let cursor = start
    for (const kid of children.get(id)!) {
      const span = (end - start) * share(kid) / total
      slice.set(kid, { start: cursor, end: cursor + span, depth: depth + 1 })
      const cell = bestCell(cursor + span / 2, depth + 1, cells.get(id)!, taken)
      cells.set(kid, cell)
      taken.add(`${cell.column},${cell.row}`)
      cursor += span
    }
  }
  return cells
}

function bestCell(angle: number, ring: number, parent: Cell, taken: ReadonlySet<string>): Cell {
  let best = null as Cell | null, bestCost = Infinity
  for (let distance = ring; distance <= ring + SPILL_RINGS; distance++) {
    for (let column = -distance; column <= distance; column++) {
      for (let row = -distance; row <= distance; row++) {
        if (Math.max(Math.abs(column), Math.abs(row)) !== distance || taken.has(`${column},${row}`)) continue
        const off = Math.atan2(row, column) - angle
        const cost = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)))
          + OUTER_RING_PENALTY * (distance - ring)
          + PARENT_DISTANCE_PENALTY * Math.max(Math.abs(column - parent.column), Math.abs(row - parent.row))
        if (cost < bestCost) { bestCost = cost; best = { column, row } }
      }
    }
    // Nothing further out can beat a free cell already found one ring closer.
    if (best && distance > ring) break
  }
  // Every ring up to SPILL_RINGS was full: keep going outwards until something is free.
  for (let distance = ring + SPILL_RINGS + 1; !best; distance++) {
    for (let column = -distance; column <= distance && !best; column++) {
      for (let row = -distance; row <= distance; row++) {
        if (Math.max(Math.abs(column), Math.abs(row)) === distance && !taken.has(`${column},${row}`)) { best = { column, row }; break }
      }
    }
  }
  return best as Cell
}
