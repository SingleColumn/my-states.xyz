import type { RelationshipType, WordGraph } from './wordGraphTypes'

/** Traverse enabled outgoing paths, rather than hiding a locally collapsed subtree.
 * A visited set handles shared nodes and cycles; expanded state survives filtering.
 */
export function visibleGraph(graph: WordGraph, expanded: ReadonlySet<string>, enabled: ReadonlySet<RelationshipType>) {
  const ids = new Set([graph.rootId])
  const queue = [graph.rootId]
  const edgeIds = new Set<string>()
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    if (!expanded.has(id)) continue
    for (const edge of graph.edges) {
      if (edge.source !== id || !enabled.has(edge.relationship)) continue
      edgeIds.add(edge.id)
      if (ids.has(edge.target)) continue
      ids.add(edge.target)
      queue.push(edge.target)
    }
  }
  return { nodes: graph.nodes.filter(node => ids.has(node.id)), edges: graph.edges.filter(edge => edgeIds.has(edge.id)) }
}
