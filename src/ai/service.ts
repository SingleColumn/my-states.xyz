import { getOpenAiCredential } from './credentials'
import type { WordGraph } from '../wordGraph/wordGraphTypes'
import { generateWordGraph, type WordGraphGenerationRequest } from '../wordGraph/wordGraphGeneration'
import { auditId, auditMode, saveAiAuditReport, type AiAuditEntry, type AiAuditReport } from './audit'

function auditResponse(operation: string, body: any) {
  if (operation !== 'generate_embeddings') return body
  const vectors = Array.isArray(body?.embeddings) ? body.embeddings : []
  return { embeddings: { count: vectors.length, dimensions: vectors[0]?.length ?? 0, inputs_mapped: vectors.length } }
}

async function post(operation: string, payload: Record<string, unknown>, signal?: AbortSignal, audit?: AiAuditEntry[]) {
  const key = getOpenAiCredential(); if (!key) throw new Error('Configure an OpenAI API key in Settings → AI Providers first.')
  const started = performance.now(); const startedAt = new Date().toISOString()
  const wireOperation = operation === 'generate_associations' ? 'associations' : operation === 'generate_embeddings' ? 'embeddings' : operation
  const response = await fetch('/api/ai', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ operation: wireOperation, ...payload }) })
  const body = await response.json().catch(() => null)
  if (audit) audit.push({ callId: auditId('call'), operation, endpoint: '/api/ai', model: operation === 'generate_embeddings' ? 'text-embedding-3-small' : 'gpt-4o-mini', parameters: payload, ...(auditMode() === 'detailed' ? { response: auditResponse(operation, body) } : {}), status: response.status, ...(response.ok ? {} : { error: body?.error || `HTTP ${response.status}` }), durationMs: Math.round(performance.now() - started), startedAt })
  if (!response.ok) throw new Error(body?.error || 'The AI request could not be completed.')
  return body
}

export async function testOpenAiCredential(key: string) { const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ operation: 'connection-test' }) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error || 'OpenAI connection failed.'); return true }

export async function requestWordGraph(request: WordGraphGenerationRequest, signal?: AbortSignal): Promise<WordGraph> {
  const started = performance.now(); const entries: AiAuditEntry[] = []; const report: AiAuditReport = { audit_schema_version: '1.0', run: { run_id: auditId('run'), started_at: new Date().toISOString(), finished_at: null, status: 'running', duration_ms: 0 }, input: { original_word: request.word, context: request.context, parameters: request }, entries, warnings: [], errors: [] }
  try { const graph = await generateWordGraph(request, payload => post('generate_associations', payload, signal, entries), payload => post('generate_embeddings', payload, signal, entries), signal); report.run.duration_ms = Math.round(performance.now() - started); report.run.finished_at = new Date().toISOString(); report.run.status = 'completed'; report.final_graph = graph; report.metrics = { api_calls: entries.length, generation_time_seconds: Number((report.run.duration_ms / 1000).toFixed(2)), node_count: graph.nodes.length, edge_count: graph.edges.length, estimated_cost_usd: null, cost_status: 'Provider token usage is not currently returned by the proxy.' }; saveAiAuditReport(report); return graph } catch (error) { report.run.duration_ms = Math.round(performance.now() - started); report.run.finished_at = new Date().toISOString(); report.run.status = signal?.aborted ? 'cancelled' : 'failed'; report.errors.push(error instanceof Error ? error.message : 'Unknown error'); report.metrics = { api_calls: entries.length, generation_time_seconds: Number((report.run.duration_ms / 1000).toFixed(2)), estimated_cost_usd: null, cost_status: 'Generation failed before cost could be calculated.' }; saveAiAuditReport(report); throw error }
}
