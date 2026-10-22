import { normalizeWord } from './wordGraphSelection'
import type { RelationshipType, WordGraph, WordGraphNode } from './wordGraphTypes'

type Association = readonly [string, string, RelationshipType]
export const sampleAssociations: readonly Association[] = [
  ['dark', 'night', 'related'], ['dark', 'fear', 'feeling'],
  ['dark', 'mystery', 'related'], ['dark', 'shadow', 'sensory'],
  ['dark', 'unknown', 'related'], ['dark', 'light', 'opposite'],
  ['night', 'silence', 'sensory'], ['night', 'dreams', 'related'], ['night', 'day', 'opposite'],
  ['fear', 'danger', 'related'], ['fear', 'anxiety', 'feeling'],
  ['mystery', 'secret', 'related'], ['shadow', 'silhouette', 'sensory'],
  ['light', 'hope', 'related'], ['day', 'sunrise', 'related'],
]

/** Directed associations: expanding a source reveals its outgoing connections. */
export function buildGraph(root: string, associations: readonly Association[]): WordGraph {
  const byWord = new Map<string, WordGraphNode>()
  function node(label: string) {
    const normalizedWord = normalizeWord(label)
    let found = byWord.get(normalizedWord)
    if (!found) {
      found = { id: `word:${normalizedWord}`, label, normalizedWord, depth: Infinity }
      byWord.set(normalizedWord, found)
    }
    return found
  }
  const rootNode = node(root)
  rootNode.depth = 0
  const edges = associations.map(([source, target, relationship]) => {
    const a = node(source), b = node(target)
    return { id: `${a.id}:${relationship}:${b.id}`, source: a.id, target: b.id, relationship }
  }).filter((edge, index, all) => all.findIndex(other => other.id === edge.id) === index)
  // Depth describes the shortest visual-topology path. Edges remain directed
  // for expansion and filtering, but either endpoint connects nodes on screen.
  const adjacent = new Map([...byWord.values()].map(node => [node.id, [] as string[]]))
  for (const edge of edges) {
    adjacent.get(edge.source)!.push(edge.target)
    adjacent.get(edge.target)!.push(edge.source)
  }
  const queue = [rootNode]
  for (let i = 0; i < queue.length; i++) {
    for (const targetId of adjacent.get(queue[i].id) ?? []) {
      const target = [...byWord.values()].find(node => node.id === targetId)!
      if (target.depth !== Infinity) continue
      target.depth = queue[i].depth + 1
      queue.push(target)
    }
  }
  return { rootId: rootNode.id, nodes: [...byWord.values()], edges }
}

/** The selected root replaces "dark"; all associations are explicitly sample data. */
export function createWordGraphFixture(root: string): WordGraph {
  return buildGraph(root, sampleAssociations.map(([a, b, type]) => [a === 'dark' ? root : a, b === 'dark' ? root : b, type]))
}
