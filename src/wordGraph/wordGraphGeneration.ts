import type { RelationshipType, WordGraph } from './wordGraphTypes'
import { buildGraph } from './wordGraphFixture'
import { normalizeWord } from './wordGraphSelection'

export interface WordGraphGenerationRequest { word: string; context: string; depth: number; maxConnectionsPerNode: number; maxTotalNodes: number; maxRemoteness: number; relationshipTypes: readonly RelationshipType[] }
type Candidate = { source?: string; target?: string; word?: string; term?: string; association?: string; relationship?: RelationshipType; type?: RelationshipType }
type AssociationCall = (payload: { word: string; context: string; path: string[]; relationshipTypes: readonly RelationshipType[]; limit: number }) => Promise<{ candidates: Candidate[] }>
type EmbeddingCall = (payload: { input: string[] }) => Promise<{ embeddings: number[][] }>

export function cosineDistance(a: number[], b: number[]) { const dot = a.reduce((sum, value, i) => sum + value * b[i], 0); const na = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0)); const nb = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0)); return na && nb ? 1 - dot / (na * nb) : 1 }

export async function generateWordGraph(request: WordGraphGenerationRequest, associations: AssociationCall, embeddings: EmbeddingCall): Promise<WordGraph> {
  const root = normalizeWord(request.word); if (!root) throw new Error('Choose a word to explore.')
  const candidates: Array<{ source: string; target: string; relationship: RelationshipType }> = []
  const queue = [{ word: root, path: [root], depth: 0 }]; const seen = new Set<string>([root])
  while (queue.length) {
    const current = queue.shift()!; if (current.depth >= request.depth) continue
    const result = await associations({ word: current.word, context: current.depth ? `${request.context} Association path: ${current.path.join(' → ')}` : request.context, path: current.path, relationshipTypes: request.relationshipTypes, limit: Math.min(15, request.maxConnectionsPerNode * 3) })
    for (const candidate of result.candidates) {
      const target = normalizeWord(candidate.target ?? candidate.word ?? candidate.term ?? candidate.association ?? ''); const relationship = candidate.relationship ?? candidate.type
      if (!target || target === current.word || !relationship || !request.relationshipTypes.includes(relationship)) continue
      candidates.push({ source: current.word, target, relationship })
      if (!seen.has(target) && seen.size < request.maxTotalNodes) { seen.add(target); queue.push({ word: target, path: [...current.path, target], depth: current.depth + 1 }) }
    }
  }
  // Keep embedding requests bounded while retaining the configured graph budget.
const boundedCandidates = candidates.slice(0, Math.min(candidates.length, request.maxTotalNodes * request.maxConnectionsPerNode * 2, 90))
  const terms = [...new Set(boundedCandidates.flatMap(edge => [edge.source, edge.target]))]
  if (!terms.length) return buildGraph(root, [])
  const vectors = (await embeddings({ input: terms })).embeddings; if (vectors.length !== terms.length) throw new Error('The embedding response did not match the requested inputs.')
  const byTerm = new Map(terms.map((term, i) => [term, vectors[i]]))
  const accepted = boundedCandidates.filter(edge => { const source = byTerm.get(edge.source); const target = byTerm.get(edge.target); return source && target && cosineDistance(source, target) <= request.maxRemoteness }).filter((edge, i, all) => all.findIndex(other => other.source === edge.source && other.target === edge.target && other.relationship === edge.relationship) === i).slice(0, request.maxTotalNodes * request.maxConnectionsPerNode)
  return buildGraph(root, accepted.map(edge => [edge.source, edge.target, edge.relationship] as const))
}
