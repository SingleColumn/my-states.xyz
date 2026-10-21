import type { RelationshipType, WordGraph } from './wordGraphTypes'
import { buildGraph } from './wordGraphFixture'
import { normalizeWord } from './wordGraphSelection'
import { assertValidWordGraph } from './wordGraphValidation'

export interface WordGraphGenerationRequest { word: string; context: string; depth: number; maxConnectionsPerNode: number; maxTotalNodes: number; maxRemoteness: number; relationshipTypes: readonly RelationshipType[] }
type Candidate = { source?: string; target?: string; word?: string; term?: string; association?: string; relationship?: RelationshipType; type?: RelationshipType }
type AssociationCall = (payload: { word: string; context: string; path: string[]; relationshipTypes: readonly RelationshipType[]; limit: number }) => Promise<{ candidates: Candidate[] }>
type EmbeddingCall = (payload: { input: string[] }) => Promise<{ embeddings: number[][] }>

export function cosineDistance(a: number[], b: number[]) { const dot = a.reduce((sum, value, i) => sum + value * b[i], 0); const na = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0)); const nb = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0)); return na && nb ? 1 - dot / (na * nb) : 1 }

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
}

function validateRequest(request: WordGraphGenerationRequest) {
  if (!Number.isInteger(request.maxTotalNodes) || request.maxTotalNodes < 1) throw new Error('Maximum total nodes must be at least 1.')
  if (!Number.isInteger(request.depth) || request.depth < 0) throw new Error('Maximum depth must be a non-negative integer.')
  if (!Number.isInteger(request.maxConnectionsPerNode) || request.maxConnectionsPerNode < 0) throw new Error('Maximum connections per node must be a non-negative integer.')
  if (!Number.isFinite(request.maxRemoteness) || request.maxRemoteness < 0 || request.maxRemoteness > 2) throw new Error('Maximum remoteness must be between 0 and 2.')
}

export async function generateWordGraph(request: WordGraphGenerationRequest, associations: AssociationCall, embeddings: EmbeddingCall, signal?: AbortSignal): Promise<WordGraph> {
  const root = normalizeWord(request.word)
  if (!root) throw new Error('Choose a word to explore.')
  validateRequest(request)

  type FrontierEntry = { word: string; path: string[]; depth: number }
  type NormalizedCandidate = { source: string; target: string; relationship: RelationshipType; edgeId: string }
  type AcceptedAssociation = readonly [string, string, RelationshipType]
  let frontier: FrontierEntry[] = [{ word: root, path: [root], depth: 0 }]
  const nodes = new Set<string>([root])
  const scheduled = new Set<string>([root])
  const accepted: AcceptedAssociation[] = []
  const acceptedEdgeIds = new Set<string>()
  const outgoingCounts = new Map<string, number>()
  const vectors = new Map<string, number[]>()

  while (frontier.length && frontier[0].depth < request.depth && nodes.size < request.maxTotalNodes && request.maxConnectionsPerNode > 0) {
    throwIfAborted(signal)
    // Requests in one breadth level may run together, but their responses are
    // admitted below in stable frontier order against one shared graph state.
    const results = await Promise.all(frontier.map(current => associations({
      word: current.word,
      context: current.depth ? `${request.context} Association path: ${current.path.join(' → ')}` : request.context,
      path: current.path,
      relationshipTypes: request.relationshipTypes,
      limit: Math.min(15, request.maxConnectionsPerNode * 3),
    })))
    throwIfAborted(signal)

    const candidateGroups = results.map((result, index) => {
      const current = frontier[index]
      const responseEdgeIds = new Set<string>()
      return result.candidates.flatMap(candidate => {
        const target = normalizeWord(candidate.target ?? candidate.word ?? candidate.term ?? candidate.association ?? '')
        const relationship = candidate.relationship ?? candidate.type
        if (!target || target === current.word || !relationship || !request.relationshipTypes.includes(relationship)) return []
        const edgeId = `${current.word}\u0000${relationship}\u0000${target}`
        if (responseEdgeIds.has(edgeId) || acceptedEdgeIds.has(edgeId)) return []
        responseEdgeIds.add(edgeId)
        return [{ source: current.word, target, relationship, edgeId } satisfies NormalizedCandidate]
      })
    })

    const missingTerms = [...new Set(candidateGroups.flatMap(candidates => candidates.flatMap(candidate => [candidate.source, candidate.target])))]
      .filter(term => !vectors.has(term))
    for (let offset = 0; offset < missingTerms.length; offset += 100) {
      const terms = missingTerms.slice(offset, offset + 100)
      const response = await embeddings({ input: terms })
      throwIfAborted(signal)
      if (response.embeddings.length !== terms.length) throw new Error('The embedding response did not match the requested inputs.')
      terms.forEach((term, index) => vectors.set(term, response.embeddings[index]))
    }

    const nextFrontier: FrontierEntry[] = []
    for (let groupIndex = 0; groupIndex < candidateGroups.length; groupIndex++) {
      const current = frontier[groupIndex]
      for (const candidate of candidateGroups[groupIndex]) {
        if ((outgoingCounts.get(current.word) ?? 0) >= request.maxConnectionsPerNode) break
        const sourceVector = vectors.get(candidate.source)
        const targetVector = vectors.get(candidate.target)
        const distance = sourceVector && targetVector ? cosineDistance(sourceVector, targetVector) : Number.NaN
        if (!Number.isFinite(distance) || distance > request.maxRemoteness) continue

        const targetExists = nodes.has(candidate.target)
        if (!targetExists && nodes.size >= request.maxTotalNodes) continue
        const targetDepth = current.depth + 1
        if (!targetExists && targetDepth > request.depth) continue

        // Commit a new target and its connecting edge together. Nothing can
        // observe or retain the node if any preceding check rejects the edge.
        if (!targetExists) nodes.add(candidate.target)
        accepted.push([candidate.source, candidate.target, candidate.relationship])
        acceptedEdgeIds.add(candidate.edgeId)
        outgoingCounts.set(current.word, (outgoingCounts.get(current.word) ?? 0) + 1)

        if (!targetExists && targetDepth < request.depth && !scheduled.has(candidate.target)) {
          scheduled.add(candidate.target)
          nextFrontier.push({ word: candidate.target, path: [...current.path, candidate.target], depth: targetDepth })
        }
      }
    }
    frontier = nextFrontier
  }

  throwIfAborted(signal)
  const graph = buildGraph(root, accepted)
  assertValidWordGraph(graph, request)
  return graph
}
