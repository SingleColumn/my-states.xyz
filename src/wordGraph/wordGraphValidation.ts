import type { WordGraph } from './wordGraphTypes'

export interface WordGraphConstraints {
  maxTotalNodes: number
  depth: number
  maxConnectionsPerNode: number
}

export interface WordGraphValidationResult {
  valid: boolean
  errors: string[]
  shortestDepthByNodeId: Map<string, number>
}

/** Connectivity and depth follow the undirected topology drawn by the Word Graph. */
export function validateWordGraphStructure(graph: WordGraph, constraints: WordGraphConstraints): WordGraphValidationResult {
  const errors: string[] = []
  const nodeIds = new Set<string>()
  const normalizedWords = new Set<string>()

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) errors.push(`Duplicate node id: ${node.id}.`)
    nodeIds.add(node.id)
    if (normalizedWords.has(node.normalizedWord)) errors.push(`Duplicate normalized word: ${node.normalizedWord}.`)
    normalizedWords.add(node.normalizedWord)
  }

  if (!nodeIds.has(graph.rootId)) errors.push(`Root node does not exist: ${graph.rootId}.`)
  if (graph.nodes.length > constraints.maxTotalNodes) errors.push(`Node count ${graph.nodes.length} exceeds ${constraints.maxTotalNodes}.`)

  const adjacency = new Map(graph.nodes.map(node => [node.id, new Set<string>()]))
  const edgeIds = new Set<string>()
  const edgeIdentities = new Set<string>()
  const outgoing = new Map<string, number>()
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge id: ${edge.id}.`)
    edgeIds.add(edge.id)
    const identity = `${edge.source}\u0000${edge.relationship}\u0000${edge.target}`
    if (edgeIdentities.has(identity)) errors.push(`Duplicate edge: ${edge.source} -> ${edge.target} (${edge.relationship}).`)
    edgeIdentities.add(identity)
    const sourceExists = nodeIds.has(edge.source)
    const targetExists = nodeIds.has(edge.target)
    if (!sourceExists) errors.push(`Edge ${edge.id} has missing source ${edge.source}.`)
    if (!targetExists) errors.push(`Edge ${edge.id} has missing target ${edge.target}.`)
    if (!sourceExists || !targetExists) continue
    adjacency.get(edge.source)!.add(edge.target)
    adjacency.get(edge.target)!.add(edge.source)
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1)
  }

  for (const [source, count] of outgoing) {
    if (count > constraints.maxConnectionsPerNode) errors.push(`Node ${source} has ${count} outgoing connections; maximum is ${constraints.maxConnectionsPerNode}.`)
  }

  const shortestDepthByNodeId = new Map<string, number>()
  if (nodeIds.has(graph.rootId)) {
    shortestDepthByNodeId.set(graph.rootId, 0)
    const queue = [graph.rootId]
    for (let index = 0; index < queue.length; index++) {
      const source = queue[index]
      for (const target of adjacency.get(source) ?? []) {
        if (shortestDepthByNodeId.has(target)) continue
        shortestDepthByNodeId.set(target, shortestDepthByNodeId.get(source)! + 1)
        queue.push(target)
      }
    }
  }

  for (const node of graph.nodes) {
    const shortestDepth = shortestDepthByNodeId.get(node.id)
    if (shortestDepth === undefined) errors.push(`Node ${node.id} is disconnected from the root.`)
    else {
      if (shortestDepth > constraints.depth) errors.push(`Node ${node.id} has shortest-path depth ${shortestDepth}; maximum is ${constraints.depth}.`)
      if (node.depth !== shortestDepth) errors.push(`Node ${node.id} stores depth ${node.depth}, but its shortest-path depth is ${shortestDepth}.`)
    }
  }

  return { valid: errors.length === 0, errors, shortestDepthByNodeId }
}

export function assertValidWordGraph(graph: WordGraph, constraints: WordGraphConstraints): void {
  const result = validateWordGraphStructure(graph, constraints)
  if (!result.valid) throw new Error(`Generated Word Graph failed structural validation: ${result.errors.join(' ')}`)
}
