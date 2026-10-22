export const relationshipTypes = ['related', 'feeling', 'sensory', 'opposite'] as const
export type RelationshipType = typeof relationshipTypes[number]
export interface WordGraphNode { id: string; label: string; normalizedWord: string; depth: number }
export interface WordGraphEdge { id: string; source: string; target: string; relationship: RelationshipType }
export interface WordGraph { rootId: string; nodes: WordGraphNode[]; edges: WordGraphEdge[]; generation?: { status: 'partial'; failedRequests: number } }
