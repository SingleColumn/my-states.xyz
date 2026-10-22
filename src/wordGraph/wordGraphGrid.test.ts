import { describe, expect, it } from 'vitest'
import { buildGraph } from './wordGraphFixture'
import { crowdedConnectors, graphGeometry, MIN_LINE_LENGTH, nodeWidth, NODE_HEIGHT } from './wordGraphLayout'
import { gridCells, gridLayout, layoutToRestore } from './wordGraphGrid'
import { ARC_CLEARANCE, arcAround, branchingEdgeIds } from './wordGraphLinks'
import type { RelationshipType } from './wordGraphTypes'

/** A repeatable pseudo-random graph in which no word has more than `maxKids` words hanging off it. */
function randomGraph(seed: number, size: number, maxKids: number) {
  let state = seed
  const random = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296
  const types: RelationshipType[] = ['related', 'feeling', 'sensory', 'opposite']
  const words = Array.from({ length: size }, (_, i) => `w${i}${'abcdefghij'.slice(0, 2 + (i * 7 + seed) % 9)}`)
  const kids = new Map<number, number>()
  const pairs: [string, string, RelationshipType][] = []
  for (let i = 1; i < size; i++) {
    let parent = Math.floor(random() * random() * i), guard = 0
    while ((kids.get(parent) ?? 0) >= maxKids && guard++ < 50) parent = Math.floor(random() * i)
    kids.set(parent, (kids.get(parent) ?? 0) + 1)
    pairs.push([words[parent], words[i], types[i % 6]])
  }
  return buildGraph(words[0], pairs)
}
const star = (count: number) => buildGraph('hub', Array.from({ length: count }, (_, i) => ['hub', `spoke${i}`, 'related'] as const))
const key = (cell: { column: number; row: number }) => `${cell.column},${cell.row}`

describe('grid layout', () => {
  it('puts the origin at the middle and every word in a cell of its own', () => {
    for (const graph of [star(3), star(10), randomGraph(1, 30, 99)]) {
      const cells = gridCells(graph)
      expect(cells.get(graph.rootId)).toEqual({ column: 0, row: 0 })
      expect(new Set([...cells.values()].map(key)).size).toBe(graph.nodes.length)
      expect(gridLayout(graph)[graph.rootId]).toEqual({ x: 0, y: 0 })
    }
  })
  it('lines words up exactly: the same row shares a height and the same column a position', () => {
    const graph = randomGraph(7, 21, 4), cells = gridCells(graph), positions = gridLayout(graph)
    for (const [a, cellA] of cells) for (const [b, cellB] of cells) {
      if (cellA.row === cellB.row) expect(positions[a].y).toBe(positions[b].y)
      if (cellA.column === cellB.column) expect(positions[a].x).toBe(positions[b].x)
    }
  })
  it('puts four words around the origin in the four corners, as two aligned rows and two aligned columns', () => {
    const graph = star(4), cells = gridCells(graph)
    expect(new Set(graph.nodes.slice(1).map(node => key(cells.get(node.id)!)))).toEqual(new Set(['1,1', '1,-1', '-1,1', '-1,-1']))
  })
  it('puts three words around the origin so that two of them share a row', () => {
    const graph = star(3), cells = gridCells(graph)
    const rows = graph.nodes.slice(1).map(node => cells.get(node.id)!.row)
    expect(new Set(rows).size).toBeLessThan(3)
  })
  it('moves a word out to the next ring when its own ring is full, rather than stacking it on another', () => {
    const graph = star(10), cells = gridCells(graph)
    const rings = graph.nodes.slice(1).map(node => Math.max(Math.abs(cells.get(node.id)!.column), Math.abs(cells.get(node.id)!.row)))
    expect(rings.filter(ring => ring === 1)).toHaveLength(8)
    expect(rings.filter(ring => ring > 1)).toHaveLength(2)
  })
  it('keeps words from overlapping and every branching connection drawn at least the minimum length', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const graph = randomGraph(seed, 21, 4), positions = gridLayout(graph)
      for (let i = 0; i < graph.nodes.length; i++) for (let j = i + 1; j < graph.nodes.length; j++) {
        const a = positions[graph.nodes[i].id], b = positions[graph.nodes[j].id]
        const apart = Math.abs(a.x - b.x) >= (nodeWidth(graph.nodes[i].label) + nodeWidth(graph.nodes[j].label)) / 2 || Math.abs(a.y - b.y) >= NODE_HEIGHT
        expect(apart, `seed ${seed}`).toBe(true)
      }
      const geometry = graphGeometry(graph, { rule: 'angle' }), branching = branchingEdgeIds(graph)
      for (const edge of graph.edges.filter(edge => branching.has(edge.id))) {
        const line = geometry.connector(positions, edge)
        expect(Math.hypot(line.x2 - line.x1, line.y2 - line.y1), `seed ${seed}: ${edge.source} -> ${edge.target}`).toBeGreaterThanOrEqual(MIN_LINE_LENGTH - 0.5)
      }
    }
  })
  it('never runs a branching connector through a word, and rarely close to one, in default-sized graphs', () => {
    let through = 0, close = 0, total = 0
    for (let seed = 1; seed <= 30; seed++) {
      const graph = randomGraph(seed, 21, 4), branching = branchingEdgeIds(graph), positions = gridLayout(graph)
      const spots = (clearance: number) => crowdedConnectors(graph, positions, { rule: 'angle', clearance })
        .filter(spot => branching.has(graph.edges.find(edge => edge.source === spot.source && edge.target === spot.target)!.id)).length
      total += graph.edges.length
      through += spots(0)
      // 24 units: a connector's end is then at least twice as far from any other word as from its own.
      close += spots(24)
    }
    expect(through).toBe(0)
    expect(close / total).toBeLessThan(0.04)
  })
  it('attaches a flat connection to the sides of the words, not to the top of one and the bottom of the other', () => {
    // Up and to the left, but more across than up: a 45 degree split sends it out of the side.
    const graph = buildGraph('departure', [['departure', 'destination', 'opposite']])
    const positions = { 'word:departure': { x: 0, y: 0 }, 'word:destination': { x: -148, y: -66 } }
    const line = graphGeometry(graph, { rule: 'angle' }).connector(positions, graph.edges[0])
    // It leaves from beside the first word (starting at its badge, which faces the second) ...
    expect(line.x1).toBeLessThan(-nodeWidth('departure') / 2)
    expect(line.y1).toBeGreaterThan(-NODE_HEIGHT / 2)
    // ... and arrives at the middle of the second word's right-hand side.
    expect(line.y2).toBeCloseTo(-66)
    expect(line.x2).toBeGreaterThan(-148 + nodeWidth('destination') / 2)
  })
})

describe('links between words that are not branching from one another', () => {
  it('tells branching connections from the rest', () => {
    const graph = buildGraph('a', [['a', 'b', 'related'], ['a', 'c', 'related'], ['b', 'd', 'related'], ['c', 'd', 'related']])
    const branching = branchingEdgeIds(graph)
    expect(graph.edges.filter(edge => !branching.has(edge.id)).map(edge => `${edge.source} -> ${edge.target}`)).toEqual(['word:c -> word:d'])
  })
  it('stays a straight line when nothing is in the way', () => {
    expect(arcAround({ x1: 0, y1: 0, x2: 300, y2: 0 }, [{ x: 150, y: 120, width: 80 }])).toEqual({ d: 'M0 0L300 0', bow: 0 })
  })
  it('bows round a word that is in the way, by enough to clear it', () => {
    const word = { x: 150, y: 0, width: 80 }
    const { d, bow } = arcAround({ x1: 0, y1: 0, x2: 300, y2: 0 }, [word])
    expect(bow).not.toBe(0)
    expect(d.startsWith('M0 0Q')).toBe(true)
    // At the middle the curve is half the control offset from the chord, and the word sits on the chord.
    expect(Math.abs(bow) / 2 - NODE_HEIGHT / 2).toBeGreaterThanOrEqual(ARC_CLEARANCE - 0.01)
  })
  it('takes the side that is free: words stacked below the line push the arc above it', () => {
    const chord = { x1: 0, y1: 0, x2: 300, y2: 0 }
    // With nothing else about, the first side tried (below, as the screen runs downwards) is used.
    expect(arcAround(chord, [{ x: 150, y: 0, width: 80 }]).bow).toBeGreaterThan(0)
    const blocked = arcAround(chord, [{ x: 150, y: 0, width: 80 }, { x: 150, y: 45, width: 80 }, { x: 150, y: 90, width: 80 }])
    expect(blocked.bow).toBeLessThan(0)
  })
})

describe('which layout a restored graph opens in', () => {
  const positions = { 'word:a': { x: 0, y: 0 } }
  it('uses the layout the saved positions were made in, whatever the person last chose elsewhere', () => {
    // Board A was left in Rings; board B later picked Grid, which is now the stored preference.
    expect(layoutToRestore({ layout: 'rings', nodePositions: positions }, 'grid')).toBe('rings')
    expect(layoutToRestore({ layout: 'grid', nodePositions: positions }, 'rings')).toBe('grid')
  })
  it('treats positions saved before the layout was recorded as Rings positions', () => {
    expect(layoutToRestore({ nodePositions: positions }, 'grid')).toBe('rings')
  })
  it('follows the stored preference when nothing was saved to match', () => {
    expect(layoutToRestore(undefined, 'grid')).toBe('grid')
    expect(layoutToRestore({}, 'rings')).toBe('rings')
  })
})
