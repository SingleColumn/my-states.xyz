import { describe, expect, it } from 'vitest'
import { buildGraph, createWordGraphFixture } from './wordGraphFixture'
import { badgeCenter, badgeOffset, BADGE_RADIUS, connector, crowdedConnectors, EDGE_GAP, fitCamera, HUB_GAP, isOutOfView, layoutGraph, MIN_LINE_LENGTH, MIN_ZOOM, NODE_HEIGHT, nodeWidth } from './wordGraphLayout'
import type { RelationshipType } from './wordGraphTypes'

function overlaps(graph: ReturnType<typeof buildGraph>) {
  const positions = layoutGraph(graph)
  const found: string[] = []
  graph.nodes.forEach((a, i) => graph.nodes.slice(i + 1).forEach(b => {
    const dx = Math.abs(positions[a.id].x - positions[b.id].x), dy = Math.abs(positions[a.id].y - positions[b.id].y)
    if (dx < (nodeWidth(a.label) + nodeWidth(b.label)) / 2 && dy < NODE_HEIGHT) found.push(`${a.label}/${b.label}`)
  }))
  return found
}

/** A deterministic 30-word graph: a deep branch, a wide branch and shared words. */
function busyGraph() {
  const types: RelationshipType[] = ['related', 'feeling', 'sensory', 'opposite']
  const pairs: [string, string][] = [
    ['love', 'passion'], ['love', 'jealousy'], ['love', 'hate'], ['love', 'embrace'], ['love', 'devotion'], ['love', 'tenderness'],
    ['passion', 'desire'], ['passion', 'obsession'], ['passion', 'intensity'], ['passion', 'heart'],
    ['jealousy', 'possessiveness'], ['jealousy', 'resentment'], ['jealousy', 'envy'], ['jealousy', 'fear'],
    ['desire', 'longing'], ['desire', 'craving'], ['desire', 'appetite'], ['obsession', 'compulsion'],
    ['compulsion', 'ritual'], ['ritual', 'habit'], ['habit', 'routine'], ['routine', 'comfort'],
    ['devotion', 'loyalty'], ['devotion', 'faithfulness'], ['tenderness', 'gentleness'], ['tenderness', 'affection'],
    ['affection', 'warmth'], ['hate', 'anger'], ['anger', 'fear'], ['fear', 'anxiety'], ['envy', 'resentment'],
  ]
  return buildGraph('love', pairs.map(([a, b], i) => [a, b, types[i % types.length]] as const))
}

describe('word graph layout', () => {
  it('keeps the root at the origin and places every word', () => {
    const graph = busyGraph()
    const positions = layoutGraph(graph)
    expect(graph.nodes.length).toBeGreaterThanOrEqual(30)
    expect(positions[graph.rootId]).toEqual({ x: 0, y: 0 })
    for (const node of graph.nodes) expect(Number.isFinite(positions[node.id].x + positions[node.id].y)).toBe(true)
  })
  it('never lets two words overlap, whatever is expanded later', () => {
    expect(overlaps(createWordGraphFixture('dark'))).toEqual([])
    expect(overlaps(busyGraph())).toEqual([])
  })
  it('is deterministic', () => {
    expect(layoutGraph(busyGraph())).toEqual(layoutGraph(busyGraph()))
  })
  it('places words with no path to the root instead of dropping them', () => {
    const graph = buildGraph('root', [['root', 'a', 'related'], ['x', 'y', 'related']])
    const positions = layoutGraph(graph)
    expect(Object.keys(positions).sort()).toEqual(graph.nodes.map(node => node.id).sort())
  })
  it('gives a branch with more words more of the circle', () => {
    const graph = buildGraph('root', [['root', 'big', 'related'], ['root', 'small', 'related'], ['big', 'b1', 'related'], ['big', 'b2', 'related'], ['big', 'b3', 'related'], ['big', 'b4', 'related']])
    const positions = layoutGraph(graph)
    const angle = (word: string) => Math.atan2(positions[`word:${word}`].y, positions[`word:${word}`].x)
    const spread = (words: string[]) => Math.max(...words.map(angle)) - Math.min(...words.map(angle))
    expect(spread(['b1', 'b2', 'b3', 'b4'])).toBeGreaterThan(0.5)
  })
})

describe('fit to view', () => {
  const region = { left: -360, top: -220, right: 360, bottom: 220 }
  const word = (x: number, y: number) => ({ x, y, width: 100 })
  it('leaves a small graph at normal size, centred', () => {
    const camera = fitCamera([word(-50, 0), word(50, 0)], region)
    expect(camera.zoom).toBe(1)
    expect(camera.x).toBeCloseTo(0)
  })
  it('zooms out until a spread-out graph fits, and puts all of it on screen', () => {
    const nodes = [word(-900, -300), word(900, 300), word(0, 0)]
    const camera = fitCamera(nodes, region)
    expect(camera.zoom).toBeLessThan(1)
    expect(camera.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
    expect(isOutOfView(nodes, camera, region)).toBe(false)
  })
  it('does not zoom out further than the minimum', () => {
    expect(fitCamera([word(-5000, 0), word(5000, 0)], region).zoom).toBe(MIN_ZOOM)
  })
  it('notices words that sit outside the current view', () => {
    const camera = { x: 0, y: 0, zoom: 1 }
    expect(isOutOfView([word(0, 0)], camera, region)).toBe(false)
    expect(isOutOfView([word(400, 0)], camera, region)).toBe(true)
    expect(isOutOfView([word(0, 0)], { x: 400, y: 0, zoom: 1 }, region)).toBe(true)
  })
})

/** Two words, `a` linked to `b`, at the given places. */
function pair(a: { x: number; y: number }, b: { x: number; y: number }, labels: [string, string] = ['alpha', 'omega']) {
  const graph = buildGraph(labels[0], [[labels[0], labels[1], 'related']])
  const positions = { [graph.nodes[0].id]: a, [graph.nodes[1].id]: b }
  return { graph, positions, edge: graph.edges[0], widths: [nodeWidth(labels[0]), nodeWidth(labels[1])] }
}
const idOf = (word: string) => `word:${word}`

describe('connectors', () => {
  it('leave and arrive at the middle of the facing side, the same gap clear of the pill', () => {
    const horizontal = pair({ x: 0, y: 0 }, { x: 400, y: 0 })
    const line = connector(horizontal.graph, horizontal.positions, horizontal.edge)
    expect(line.y1).toBeCloseTo(0)
    expect(line.y2).toBeCloseTo(0)
    expect(line.x2).toBeCloseTo(400 - horizontal.widths[1] / 2 - EDGE_GAP)
    const vertical = pair({ x: 0, y: 0 }, { x: 0, y: 300 })
    const down = connector(vertical.graph, vertical.positions, vertical.edge)
    expect(down.x2).toBeCloseTo(0)
    expect(down.y2).toBeCloseTo(300 - NODE_HEIGHT / 2 - EDGE_GAP)
  })
  it('use the top or bottom for diagonals, since pills are wider than tall', () => {
    const { graph, positions, edge } = pair({ x: 0, y: 0 }, { x: 300, y: 300 })
    const line = connector(graph, positions, edge)
    expect(line.x2).toBeCloseTo(300)
    expect(line.y2).toBeCloseTo(300 - NODE_HEIGHT / 2 - EDGE_GAP)
  })
  it('take a different side for each direction a word connects in', () => {
    const graph = buildGraph('hub', [['hub', 'east', 'related'], ['hub', 'north', 'related'], ['hub', 'west', 'related']])
    const positions = { [idOf('hub')]: { x: 0, y: 0 }, [idOf('east')]: { x: 400, y: 0 }, [idOf('north')]: { x: 0, y: -300 }, [idOf('west')]: { x: -400, y: 0 } }
    const lines = graph.edges.map(edge => connector(graph, positions, edge))
    // Right side, top side, left side: three different, fixed attachment points.
    expect(lines[0].x1).toBeGreaterThan(0); expect(lines[0].y1).toBeCloseTo(0)
    expect(lines[1].y1).toBeLessThan(0); expect(lines[1].x1).toBeCloseTo(0)
    expect(lines[2].x1).toBeLessThan(0); expect(lines[2].y1).toBeCloseTo(0)
  })
  it('collapse to a point rather than cross over when words nearly touch', () => {
    const { graph, positions, edge } = pair({ x: 0, y: 0 }, { x: 70, y: 0 })
    const line = connector(graph, positions, edge)
    expect(line.x1).toBeCloseTo(line.x2)
  })
})

describe('expand badge', () => {
  const offset = 2 + BADGE_RADIUS
  it('is centred just outside the side that faces the words it reveals', () => {
    expect(badgeCenter({ x: 300, y: 0 }, 100, [{ x: 520, y: -20 }, { x: 520, y: 30 }])).toEqual({ x: 50 + offset, y: 0 })
    expect(badgeCenter({ x: 300, y: 0 }, 100, [{ x: 320, y: -150 }, { x: 380, y: -160 }])).toEqual({ x: 0, y: -(NODE_HEIGHT / 2 + offset) })
    expect(badgeCenter({ x: -300, y: 20 }, 100, [{ x: -520, y: 20 }])).toEqual({ x: -(50 + offset), y: 0 })
  })
  it('ignores links that double back towards the middle', () => {
    expect(badgeCenter({ x: 300, y: 0 }, 100, [{ x: 520, y: 0 }, { x: 20, y: 0 }]).x).toBeGreaterThan(0)
  })
  it('faces outwards when there is nothing to face, or the words surround it, and below for the root', () => {
    expect(badgeCenter({ x: 300, y: 0 }, 100)).toEqual({ x: 50 + offset, y: 0 })
    expect(badgeCenter({ x: 0, y: -200 }, 100)).toEqual({ x: 0, y: -(NODE_HEIGHT / 2 + offset) })
    const ring = [{ x: 200, y: 0 }, { x: -200, y: 0 }, { x: 0, y: 200 }, { x: 0, y: -200 }]
    expect(badgeCenter({ x: 0, y: 0 }, 60, ring)).toEqual({ x: 0, y: NODE_HEIGHT / 2 + offset })
  })
  it('never overlaps its own pill', () => {
    for (const angle of [0, 0.4, 0.8, 1.2, 1.57, 2.4, 3.14, 4]) {
      const here = { x: Math.cos(angle) * 300, y: Math.sin(angle) * 300 }
      const badge = badgeCenter(here, 90, [{ x: here.x * 1.5, y: here.y * 1.5 }])
      const half = 90 / 2 - NODE_HEIGHT / 2
      expect(Math.hypot(Math.max(Math.abs(badge.x) - half, 0), badge.y) - NODE_HEIGHT / 2).toBeGreaterThanOrEqual(BADGE_RADIUS)
    }
  })
})

describe('badge as the start of connectors', () => {
  it('starts every line that leaves through the badge side at the badge edge, however it fans', () => {
    const graph = buildGraph('hub', [['hub', 'a', 'related'], ['hub', 'b', 'related'], ['hub', 'c', 'related']])
    // Three words below and to either side, all reached through the bottom of a word out on the right.
    const positions = { [idOf('hub')]: { x: 300, y: 0 }, [idOf('a')]: { x: 300, y: 300 }, [idOf('b')]: { x: 450, y: 250 }, [idOf('c')]: { x: 150, y: 250 } }
    const offset = badgeOffset(graph, positions, idOf('hub'))!
    const badge = { x: 300 + offset.x, y: offset.y }
    for (const edge of graph.edges) {
      const line = connector(graph, positions, edge)
      expect(Math.hypot(line.x1 - badge.x, line.y1 - badge.y), edge.target).toBeCloseTo(BADGE_RADIUS + HUB_GAP, 5)
    }
  })
  it('starts lines that use another side at that side, not at the badge', () => {
    const graph = buildGraph('hub', [['hub', 'a', 'related'], ['hub', 'b', 'related'], ['hub', 'c', 'related']])
    // Most words are to the right, so the badge faces right; one sits above and gets its own, top, attachment point.
    const positions = { [idOf('hub')]: { x: 0, y: 0 }, [idOf('a')]: { x: 400, y: 0 }, [idOf('b')]: { x: 400, y: 40 }, [idOf('c')]: { x: 0, y: -300 } }
    const top = connector(graph, positions, graph.edges[2])
    expect(top.x1).toBeCloseTo(0)
    expect(top.y1).toBeCloseTo(-(NODE_HEIGHT / 2 + EDGE_GAP))
  })
  it('ends a line at the badge edge too when it arrives on the badge side', () => {
    const graph = buildGraph('a', [['a', 'b', 'related'], ['b', 'a', 'related']])
    const positions = { [idOf('a')]: { x: 0, y: 0 }, [idOf('b')]: { x: 300, y: 0 } }
    // b's only word, a, is to its left, so b's badge is on its left, exactly where a's line arrives.
    const offset = badgeOffset(graph, positions, idOf('b'))!
    const line = connector(graph, positions, graph.edges[0])
    expect(Math.hypot(line.x2 - (300 + offset.x), line.y2 - offset.y)).toBeCloseTo(BADGE_RADIUS + HUB_GAP, 5)
  })
})

describe('connection length', () => {
  it('never draws a connection shorter than the minimum, so linked words keep apart', () => {
    for (const graph of [createWordGraphFixture('dark'), busyGraph()]) {
      const positions = layoutGraph(graph)
      for (const edge of graph.edges) {
        const line = connector(graph, positions, edge)
        expect(Math.hypot(line.x2 - line.x1, line.y2 - line.y1), `${edge.source} -> ${edge.target}`).toBeGreaterThanOrEqual(MIN_LINE_LENGTH - 0.5)
      }
    }
  })
})

/** A repeatable pseudo-random graph of `size` words: each word hangs off an earlier one (favouring the
 * first few, so some branches are fat), plus `links` extra links that jump across the graph. */
function randomGraph(seed: number, size = 30, links = 0) {
  let state = seed
  const random = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296
  const types: RelationshipType[] = ['related', 'feeling', 'sensory', 'opposite']
  const words = Array.from({ length: size }, (_, i) => `w${i}${'abcdefghij'.slice(0, 2 + (i * 7 + seed) % 9)}`)
  const pairs: [string, string, RelationshipType][] = []
  for (let i = 1; i < size; i++) pairs.push([words[Math.floor(random() * random() * i)], words[i], types[i % 6]])
  for (let k = 0; k < links; k++) pairs.push([words[1 + Math.floor(random() * (size - 1))], words[1 + Math.floor(random() * (size - 1))], 'related'])
  return buildGraph(words[0], pairs.filter(([a, b]) => a !== b))
}

describe('clearance around connectors', () => {
  it('keeps every other word clear of every connector in tree-shaped graphs', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const graph = randomGraph(seed)
      expect(crowdedConnectors(graph, layoutGraph(graph)), `seed ${seed}`).toEqual([])
    }
  })
  it('keeps a connector clearly nearer its own word than any neighbour, as in a graph with hidden branches', () => {
    // Four words around the root, four under each, and more waiting behind a collapsed branch.
    const graph = buildGraph('love', [
      ['love', 'passion', 'feeling'], ['love', 'jealousy', 'feeling'], ['love', 'hate', 'opposite'], ['love', 'embrace', 'sensory'],
      ['passion', 'desire', 'related'], ['passion', 'obsession', 'related'], ['passion', 'intensity', 'feeling'], ['passion', 'heart', 'related'],
      ['jealousy', 'possessiveness', 'related'], ['jealousy', 'resentment', 'feeling'], ['jealousy', 'envy', 'related'], ['jealousy', 'fear', 'feeling'],
      ['embrace', 'affection', 'feeling'], ['embrace', 'warmth', 'sensory'], ['embrace', 'acceptance', 'related'], ['embrace', 'hug', 'related'],
      ['hate', 'anger', 'feeling'], ['hate', 'contempt', 'feeling'], ['hate', 'bitterness', 'feeling'], ['anger', 'rage', 'related'],
      ['desire', 'longing', 'feeling'], ['desire', 'craving', 'sensory'], ['obsession', 'compulsion', 'related'], ['hug', 'comfort', 'sensory'],
    ])
    expect(crowdedConnectors(graph, layoutGraph(graph))).toEqual([])
  })
  it('rarely lets a cross-link run close to a word, since those cannot always avoid every one', () => {
    let close = 0
    for (let seed = 1; seed <= 40; seed++) {
      const graph = randomGraph(seed, 30, 3)
      close += crowdedConnectors(graph, layoutGraph(graph)).filter(spot => spot.clearance < 10).length
    }
    expect(close).toBeLessThanOrEqual(20)
  })
})
