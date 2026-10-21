import type { RelationshipType, WordGraph } from './wordGraphTypes'
import { buildGraph } from './wordGraphFixture'
import { normalizeWord } from './wordGraphSelection'
import { assertValidWordGraph } from './wordGraphValidation'

export interface WordGraphGenerationRequest { word: string; context: string; depth: number; maxConnectionsPerNode: number; maxTotalNodes: number; maxRemoteness: number; relationshipTypes: readonly RelationshipType[] }
type Candidate = { source?: string; target?: string; word?: string; term?: string; association?: string; relationship?: RelationshipType; type?: RelationshipType }
type AssociationCall = (payload: { word: string; context: string; path: string[]; relationshipTypes: readonly RelationshipType[]; limit: number }, requestId?: string) => Promise<{ candidates: Candidate[] }>
type EmbeddingCall = (payload: { input: string[] }) => Promise<{ embeddings: number[][] }>

export type WordGraphRejectionReason = 'invalid_candidate' | 'duplicate_candidate' | 'duplicate_relationship' | 'invalid_embedding' | 'remoteness_exceeded' | 'max_total_nodes' | 'max_outgoing_connections' | 'max_depth' | 'source_unavailable'
export interface WordGraphCandidateDecision {
  requestId: string
  candidateIndex: number
  sourceWord: string
  sourceNodeId: string
  sourceDepth: number
  proposedTarget: string | null
  targetWord: string | null
  proposedRelationship: string | null
  status: 'accepted' | 'rejected' | 'unresolved'
  reason?: WordGraphRejectionReason | 'generation_failed' | 'cancelled'
  cosineSimilarity: number | null
  cosineDistance: number | null
  maxRemoteness: number
  passedRemoteness: boolean | null
  introducedNewNode: boolean
  introducedNewEdge: boolean
  edgeId?: string
}
export interface WordGraphExpansionDecision { sourceWord: string; sourceDepth: number; reason: 'max_depth' | 'max_total_nodes' | 'max_outgoing_connections' }
export interface WordGraphGenerationObserver {
  onCandidateProposed?(decision: WordGraphCandidateDecision): void
  onExpansionSkipped?(decision: WordGraphExpansionDecision): void
}

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

export async function generateWordGraph(request: WordGraphGenerationRequest, associations: AssociationCall, embeddings: EmbeddingCall, signal?: AbortSignal, observer?: WordGraphGenerationObserver): Promise<WordGraph> {
  const root = normalizeWord(request.word)
  if (!root) throw new Error('Choose a word to explore.')
  validateRequest(request)

  type FrontierEntry = { word: string; path: string[]; depth: number }
  type NormalizedCandidate = { source: string; target: string; relationship: RelationshipType; edgeId: string; audit?: WordGraphCandidateDecision }
  type AcceptedAssociation = readonly [string, string, RelationshipType]
  let frontier: FrontierEntry[] = [{ word: root, path: [root], depth: 0 }]
  const nodes = new Set<string>([root])
  const scheduled = new Set<string>([root])
  const accepted: AcceptedAssociation[] = []
  const acceptedEdgeIds = new Set<string>()
  const outgoingCounts = new Map<string, number>()
  const vectors = new Map<string, number[]>()
  let associationRequestIndex = 0

  while (frontier.length && frontier[0].depth < request.depth && nodes.size < request.maxTotalNodes && request.maxConnectionsPerNode > 0) {
    throwIfAborted(signal)
    // Requests in one breadth level may run together, but their responses are
    // admitted below in stable frontier order against one shared graph state.
    const requestIds = frontier.map(() => `association-${++associationRequestIndex}`)
    const settled = await Promise.allSettled(frontier.map((current, index) => associations({
      word: current.word,
      context: current.depth ? `${request.context} Association path: ${current.path.join(' → ')}` : request.context,
      path: current.path,
      relationshipTypes: request.relationshipTypes,
      limit: Math.min(15, request.maxConnectionsPerNode * 3),
    }, requestIds[index])))
    const failed = settled.find(result => result.status === 'rejected')
    if (observer && (signal?.aborted || failed)) {
      // Other requests in this level may have succeeded. Their proposals were
      // received but never entered candidate filtering after the level failed.
      settled.forEach((result, index) => {
        if (result.status !== 'fulfilled') return
        const current = frontier[index]
        result.value.candidates.forEach((candidate, candidateIndex) => {
          const proposedTarget = candidate.target ?? candidate.word ?? candidate.term ?? candidate.association ?? null
          observer.onCandidateProposed?.({
            requestId: requestIds[index], candidateIndex, sourceWord: current.word, sourceNodeId: `word:${current.word}`,
            sourceDepth: current.depth, proposedTarget, targetWord: proposedTarget ? normalizeWord(proposedTarget) || null : null,
            proposedRelationship: candidate.relationship ?? candidate.type ?? null, status: 'unresolved',
            reason: signal?.aborted ? 'cancelled' : 'generation_failed', cosineSimilarity: null, cosineDistance: null,
            maxRemoteness: request.maxRemoteness, passedRemoteness: null, introducedNewNode: false, introducedNewEdge: false,
          })
        })
      })
    }
    throwIfAborted(signal)
    if (failed?.status === 'rejected') throw failed.reason
    const results = settled.map(result => (result as PromiseFulfilledResult<{ candidates: Candidate[] }>).value)

    const candidateGroups = results.map((result, index) => {
      const current = frontier[index]
      const responseEdgeIds = new Set<string>()
      return result.candidates.flatMap((candidate, candidateIndex) => {
        const target = normalizeWord(candidate.target ?? candidate.word ?? candidate.term ?? candidate.association ?? '')
        const relationship = candidate.relationship ?? candidate.type
        const audit: WordGraphCandidateDecision | undefined = observer ? {
          requestId: requestIds[index], candidateIndex, sourceWord: current.word, sourceNodeId: `word:${current.word}`,
          sourceDepth: current.depth, proposedTarget: candidate.target ?? candidate.word ?? candidate.term ?? candidate.association ?? null,
          targetWord: target || null, proposedRelationship: relationship ?? null, status: 'unresolved',
          cosineSimilarity: null, cosineDistance: null, maxRemoteness: request.maxRemoteness,
          passedRemoteness: null, introducedNewNode: false, introducedNewEdge: false,
        } : undefined
        if (audit) observer?.onCandidateProposed?.(audit)
        if (!target || target === current.word || !relationship || !request.relationshipTypes.includes(relationship)) {
          if (audit) { audit.status = 'rejected'; audit.reason = 'invalid_candidate' }
          return []
        }
        const edgeId = `${current.word}\u0000${relationship}\u0000${target}`
        if (responseEdgeIds.has(edgeId) || acceptedEdgeIds.has(edgeId)) {
          if (audit) { audit.status = 'rejected'; audit.reason = responseEdgeIds.has(edgeId) ? 'duplicate_candidate' : 'duplicate_relationship' }
          return []
        }
        responseEdgeIds.add(edgeId)
        return [{ source: current.word, target, relationship, edgeId, audit } satisfies NormalizedCandidate]
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
        if ((outgoingCounts.get(current.word) ?? 0) >= request.maxConnectionsPerNode) {
          if (candidate.audit) { candidate.audit.status = 'rejected'; candidate.audit.reason = 'max_outgoing_connections' }
          continue
        }
        const sourceVector = vectors.get(candidate.source)
        const targetVector = vectors.get(candidate.target)
        const distance = sourceVector && targetVector ? cosineDistance(sourceVector, targetVector) : Number.NaN
        if (candidate.audit && Number.isFinite(distance)) {
          candidate.audit.cosineDistance = distance
          candidate.audit.cosineSimilarity = 1 - distance
          candidate.audit.passedRemoteness = distance <= request.maxRemoteness
        }
        if (!Number.isFinite(distance) || distance > request.maxRemoteness) {
          if (candidate.audit) { candidate.audit.status = 'rejected'; candidate.audit.reason = Number.isFinite(distance) ? 'remoteness_exceeded' : 'invalid_embedding' }
          continue
        }

        const targetExists = nodes.has(candidate.target)
        if (!targetExists && nodes.size >= request.maxTotalNodes) {
          if (candidate.audit) { candidate.audit.status = 'rejected'; candidate.audit.reason = 'max_total_nodes' }
          continue
        }
        const targetDepth = current.depth + 1
        if (!targetExists && targetDepth > request.depth) {
          if (candidate.audit) { candidate.audit.status = 'rejected'; candidate.audit.reason = 'max_depth' }
          continue
        }

        // Commit a new target and its connecting edge together. Nothing can
        // observe or retain the node if any preceding check rejects the edge.
        if (!targetExists) nodes.add(candidate.target)
        accepted.push([candidate.source, candidate.target, candidate.relationship])
        acceptedEdgeIds.add(candidate.edgeId)
        outgoingCounts.set(current.word, (outgoingCounts.get(current.word) ?? 0) + 1)
        if (candidate.audit) {
          candidate.audit.status = 'accepted'
          candidate.audit.introducedNewNode = !targetExists
          candidate.audit.introducedNewEdge = true
          candidate.audit.edgeId = `word:${candidate.source}:${candidate.relationship}:word:${candidate.target}`
        }

        if (!targetExists && targetDepth < request.depth && !scheduled.has(candidate.target)) {
          scheduled.add(candidate.target)
          nextFrontier.push({ word: candidate.target, path: [...current.path, candidate.target], depth: targetDepth })
        }
      }
    }
    frontier = nextFrontier
  }

  if (observer) for (const current of frontier) {
    observer.onExpansionSkipped?.({ sourceWord: current.word, sourceDepth: current.depth,
      reason: current.depth >= request.depth ? 'max_depth' : nodes.size >= request.maxTotalNodes ? 'max_total_nodes' : 'max_outgoing_connections' })
  }

  throwIfAborted(signal)
  const graph = buildGraph(root, accepted)
  assertValidWordGraph(graph, request)
  return graph
}
