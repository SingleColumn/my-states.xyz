import type { WordGraphCandidateDecision, WordGraphExpansionDecision } from '../wordGraph/wordGraphGeneration'

export type AiAuditMode = 'standard' | 'detailed'
export type AiOperation = 'generate_associations' | 'generate_embeddings'
export interface AiTokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
}
export interface AiAuditEntry {
  callId: string
  operation: AiOperation
  endpoint: '/api/ai'
  model: string | null
  providerRequestId?: string
  parameters: unknown
  response?: unknown
  status?: number
  error?: string
  durationMs: number
  startedAt: string
  usage: AiTokenUsage | null
  estimatedCostUsd: number | null
  costStatus: 'estimated' | 'usage_unavailable' | 'pricing_unavailable'
}
export interface AiAuditMetrics {
  api_calls: number
  association_requests: number
  embedding_requests: number
  generation_time_seconds: number
  candidates_proposed: number
  candidates_evaluated_for_remoteness: number
  candidates_accepted: number
  candidates_rejected: number
  candidates_unresolved: number
  rejections_by_reason: Record<string, number>
  distinct_nodes_admitted: number
  edges_admitted: number
  node_count?: number
  edge_count?: number
  actual_input_tokens: number
  actual_output_tokens: number
  actual_total_tokens: number
  usage_complete: boolean
  estimated_association_cost_usd: number | null
  estimated_embedding_cost_usd: number | null
  estimated_cost_usd: number | null
  cost_complete: boolean
  cost_status: string
}
export interface AiAuditReport {
  audit_schema_version: '1.1'
  run: { run_id: string; started_at: string; finished_at: string | null; status: 'running' | 'completed' | 'failed' | 'cancelled'; duration_ms: number }
  input: { original_word: string; context: string; parameters: unknown }
  entries: AiAuditEntry[]
  candidate_decisions: WordGraphCandidateDecision[]
  expansion_decisions: WordGraphExpansionDecision[]
  final_graph?: unknown
  metrics?: AiAuditMetrics
  warnings: string[]
  errors: string[]
}

const MODE_KEY = 'my-states:ai-audit-mode'
const REPORT_KEY = 'my-states:ai-audit-last'
export function auditMode(): AiAuditMode { return window.localStorage.getItem(MODE_KEY) === 'detailed' ? 'detailed' : 'standard' }
export function setAuditMode(mode: AiAuditMode) { if (mode === 'detailed') window.localStorage.setItem(MODE_KEY, mode); else window.localStorage.removeItem(MODE_KEY) }
export function isAiAuditEnabled() { return auditMode() === 'detailed' }
export function setAiAuditEnabled(enabled: boolean) { setAuditMode(enabled ? 'detailed' : 'standard') }
export function readAiAuditReport(): AiAuditReport | null { try { const raw = window.sessionStorage.getItem(REPORT_KEY); if (!raw || raw.length > 500_000) { if (raw) window.sessionStorage.removeItem(REPORT_KEY); return null } return JSON.parse(raw) as AiAuditReport } catch { return null } }
export function clearAiAuditReport() { window.sessionStorage.removeItem(REPORT_KEY) }
export function saveAiAuditReport(report: AiAuditReport) { window.sessionStorage.setItem(REPORT_KEY, JSON.stringify(report)) }
export function auditId(prefix: string) { return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }

// Standard API rates, USD per million tokens. Reviewed 2026-10-21 against
// https://developers.openai.com/api/docs/models/gpt-4o-mini and
// https://developers.openai.com/api/docs/models/text-embedding-3-small.
export const AI_MODEL_PRICING = {
  'gpt-4o-mini': { inputPerMillion: 0.15, cachedInputPerMillion: 0.075, outputPerMillion: 0.60, source: 'https://developers.openai.com/api/docs/models/gpt-4o-mini', reviewedOn: '2026-10-21' },
  'gpt-4o-mini-2024-07-18': { inputPerMillion: 0.15, cachedInputPerMillion: 0.075, outputPerMillion: 0.60, source: 'https://developers.openai.com/api/docs/models/gpt-4o-mini', reviewedOn: '2026-10-21' },
  'text-embedding-3-small': { inputPerMillion: 0.02, cachedInputPerMillion: null, outputPerMillion: null, source: 'https://developers.openai.com/api/docs/models/text-embedding-3-small', reviewedOn: '2026-10-21' },
} as const

export function estimateRequestCost(model: string | null, usage: AiTokenUsage | null): number | null {
  if (!model || !usage) return null
  const price = AI_MODEL_PRICING[model as keyof typeof AI_MODEL_PRICING]
  if (!price) return null
  if (usage.inputTokens === undefined || usage.totalTokens === undefined) return null
  if (price.outputPerMillion === null && usage.outputTokens !== undefined && usage.outputTokens !== 0) return null
  if (price.outputPerMillion !== null && usage.outputTokens === undefined) return null
  const cached = usage.cachedInputTokens ?? 0
  if (cached > usage.inputTokens || (cached > 0 && price.cachedInputPerMillion === null)) return null
  return ((usage.inputTokens - cached) * price.inputPerMillion + cached * (price.cachedInputPerMillion ?? 0) + (usage.outputTokens ?? 0) * (price.outputPerMillion ?? 0)) / 1_000_000
}

export function summarizeAiAudit(report: AiAuditReport): AiAuditMetrics {
  const entries = report.entries
  const decisions = report.candidate_decisions
  const count = (operation: AiOperation) => entries.filter(entry => entry.operation === operation).length
  const rejected = decisions.filter(decision => decision.status === 'rejected')
  const rejectionsByReason: Record<string, number> = {}
  rejected.forEach(decision => { rejectionsByReason[decision.reason!] = (rejectionsByReason[decision.reason!] ?? 0) + 1 })
  const costOf = (operation: AiOperation): number | null => {
    const subset = entries.filter(entry => entry.operation === operation)
    return subset.every(entry => entry.estimatedCostUsd !== null)
      ? subset.reduce((sum, entry) => sum + entry.estimatedCostUsd!, 0)
      : null
  }
  const associationCost = costOf('generate_associations')
  const embeddingCost = costOf('generate_embeddings')
  const costComplete = entries.every(entry => entry.estimatedCostUsd !== null)
  const usageComplete = entries.every(entry => entry.usage?.inputTokens !== undefined && entry.usage.totalTokens !== undefined && (entry.operation === 'generate_embeddings' || entry.usage.outputTokens !== undefined))
  const graph = report.final_graph as { nodes?: unknown[]; edges?: unknown[] } | undefined
  return {
    api_calls: entries.length,
    association_requests: count('generate_associations'),
    embedding_requests: count('generate_embeddings'),
    generation_time_seconds: report.run.duration_ms / 1000,
    candidates_proposed: decisions.length,
    candidates_evaluated_for_remoteness: decisions.filter(decision => decision.cosineDistance !== null).length,
    candidates_accepted: decisions.filter(decision => decision.status === 'accepted').length,
    candidates_rejected: rejected.length,
    candidates_unresolved: decisions.filter(decision => decision.status === 'unresolved').length,
    rejections_by_reason: rejectionsByReason,
    distinct_nodes_admitted: decisions.filter(decision => decision.status === 'accepted' && decision.introducedNewNode).length,
    edges_admitted: decisions.filter(decision => decision.status === 'accepted' && decision.introducedNewEdge).length,
    ...(graph ? { node_count: graph.nodes?.length, edge_count: graph.edges?.length } : {}),
    actual_input_tokens: entries.reduce((sum, entry) => sum + (entry.usage?.inputTokens ?? 0), 0),
    actual_output_tokens: entries.reduce((sum, entry) => sum + (entry.usage?.outputTokens ?? 0), 0),
    actual_total_tokens: entries.reduce((sum, entry) => sum + (entry.usage?.totalTokens ?? 0), 0),
    usage_complete: usageComplete,
    estimated_association_cost_usd: associationCost,
    estimated_embedding_cost_usd: embeddingCost,
    estimated_cost_usd: costComplete ? associationCost! + embeddingCost! : null,
    cost_complete: costComplete,
    cost_status: costComplete ? 'Estimated from reported usage and reviewed model rates.' : 'Incomplete: request usage or model pricing is unavailable.',
  }
}

export function assertAuditReconciled(report: AiAuditReport): void {
  const metrics = summarizeAiAudit(report)
  if (metrics.candidates_proposed !== metrics.candidates_accepted + metrics.candidates_rejected + metrics.candidates_unresolved) throw new Error('Audit candidate counts do not reconcile.')
  if (Object.values(metrics.rejections_by_reason).reduce((sum, count) => sum + count, 0) !== metrics.candidates_rejected) throw new Error('Audit rejection counts do not reconcile.')
  const associationIds = new Set(report.entries.filter(entry => entry.operation === 'generate_associations').map(entry => entry.callId))
  if (report.candidate_decisions.some(decision => !associationIds.has(decision.requestId))) throw new Error('Audit candidate references an unrecorded association request.')
  if (report.candidate_decisions.some(decision => decision.status === 'rejected' && !decision.reason)) throw new Error('Audit rejection lacks a reason.')
  if (report.candidate_decisions.some(decision => decision.status === 'accepted' && (decision.cosineDistance === null || decision.cosineDistance > decision.maxRemoteness || !decision.passedRemoteness))) throw new Error('Audit accepted candidate lacks a passing remoteness measurement.')
  if (report.final_graph) {
    const graph = report.final_graph as { rootId: string; nodes: { id: string }[]; edges: { id: string }[] }
    const edgeIds = new Set(graph.edges.map(edge => edge.id))
    if (metrics.edges_admitted !== graph.edges.length || metrics.distinct_nodes_admitted + 1 !== graph.nodes.length) throw new Error('Audit admissions do not match the graph.')
    if (report.candidate_decisions.some(decision => decision.status === 'accepted' && !edgeIds.has(decision.edgeId!))) throw new Error('Audit accepted edge is missing from the graph.')
  }
}
