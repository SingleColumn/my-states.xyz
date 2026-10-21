import { getOpenAiCredential } from './credentials'
import type { WordGraph } from '../wordGraph/wordGraphTypes'
import { generateWordGraph, type WordGraphGenerationRequest, type WordGraphGenerationObserver } from '../wordGraph/wordGraphGeneration'
import { assertAuditReconciled, auditId, estimateRequestCost, isAiAuditEnabled, saveAiAuditReport, summarizeAiAudit, type AiAuditEntry, type AiAuditReport, type AiOperation, type AiTokenUsage } from './audit'

function tokenCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined
}

function reportedUsage(value: unknown): AiTokenUsage | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const inputTokens = tokenCount(raw.input_tokens ?? raw.prompt_tokens)
  const totalTokens = tokenCount(raw.total_tokens)
  const outputTokens = tokenCount(raw.output_tokens)
  if (inputTokens === undefined && totalTokens === undefined && outputTokens === undefined) return null
  const cached = tokenCount((raw.input_tokens_details as { cached_tokens?: unknown } | undefined)?.cached_tokens)
  return { ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(totalTokens === undefined ? {} : { totalTokens }), ...(cached === undefined ? {} : { cachedInputTokens: cached }) }
}

function responseSummary(operation: AiOperation, body: any): unknown {
  if (operation === 'generate_associations') return { candidates: { count: Array.isArray(body?.candidates) ? body.candidates.length : 0 } }
  const vectors = Array.isArray(body?.embeddings) ? body.embeddings : []
  return { embeddings: { count: vectors.length, dimensions: vectors[0]?.length ?? 0, inputs_mapped: vectors.length } }
}

async function post(operation: AiOperation, payload: Record<string, unknown>, signal?: AbortSignal, entries?: AiAuditEntry[], callId?: string) {
  const key = getOpenAiCredential()
  if (!key) throw new Error('Configure an OpenAI API key in Settings → AI Providers first.')
  const started = performance.now()
  const startedAt = new Date().toISOString()
  const wireOperation = operation === 'generate_associations' ? 'associations' : 'embeddings'
  const expectedModel = operation === 'generate_embeddings' ? 'text-embedding-3-small' : 'gpt-4o-mini'
  let status: number | undefined
  let body: any = null
  let failure: unknown
  try {
    const response = await fetch('/api/ai', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ operation: wireOperation, ...payload }),
    })
    status = response.status
    body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || 'The AI request could not be completed.')
    return body
  } catch (error) {
    failure = error
    throw error
  } finally {
    if (entries) {
      const model = typeof body?.model === 'string' ? body.model : expectedModel
      const usage = reportedUsage(body?.usage)
      const estimatedCostUsd = estimateRequestCost(model, usage)
      entries.push({
        callId: callId ?? auditId('call'), operation, endpoint: '/api/ai', model,
        ...(typeof body?.providerRequestId === 'string' ? { providerRequestId: body.providerRequestId } : {}),
        parameters: payload,
        ...(body ? { response: responseSummary(operation, body) } : {}),
        status,
        ...(failure ? { error: failure instanceof Error ? failure.message : 'Unknown error' } : {}),
        durationMs: Math.round(performance.now() - started), startedAt, usage, estimatedCostUsd,
        costStatus: !usage || usage.inputTokens === undefined || usage.totalTokens === undefined || (operation === 'generate_associations' && usage.outputTokens === undefined)
          ? 'usage_unavailable' : estimatedCostUsd === null ? 'pricing_unavailable' : 'estimated',
      })
    }
  }
}

export async function testOpenAiCredential(key: string) {
  const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ operation: 'connection-test' }) })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || 'OpenAI connection failed.')
  return true
}

export async function requestWordGraph(request: WordGraphGenerationRequest, signal?: AbortSignal): Promise<WordGraph> {
  // The recording choice is fixed for this attempt, including retries and
  // changes to Settings while requests are in flight.
  const recording = isAiAuditEnabled()
  const started = performance.now()
  const report: AiAuditReport | undefined = recording ? {
    audit_schema_version: '1.1',
    run: { run_id: auditId('run'), started_at: new Date().toISOString(), finished_at: null, status: 'running', duration_ms: 0 },
    input: { original_word: request.word, context: request.context, parameters: request },
    entries: [], candidate_decisions: [], expansion_decisions: [], warnings: [], errors: [],
  } : undefined
  const observer: WordGraphGenerationObserver | undefined = report ? {
    onCandidateProposed: decision => report.candidate_decisions.push(decision),
    onExpansionSkipped: decision => report.expansion_decisions.push(decision),
  } : undefined

  try {
    const graph = await generateWordGraph(
      request,
      (payload, callId) => post('generate_associations', payload, signal, report?.entries, callId),
      payload => post('generate_embeddings', payload, signal, report?.entries),
      signal, observer,
    )
    if (report) {
      report.run.status = 'completed'
      report.final_graph = graph
      finishReport(report, started)
    }
    return graph
  } catch (error) {
    if (report) {
      report.run.status = signal?.aborted ? 'cancelled' : 'failed'
      report.errors.push(error instanceof Error ? error.message : 'Unknown error')
      for (const decision of report.candidate_decisions) {
        if (decision.status === 'unresolved') decision.reason = signal?.aborted ? 'cancelled' : 'generation_failed'
      }
      finishReport(report, started)
    }
    throw error
  }
}

function finishReport(report: AiAuditReport, started: number) {
  report.run.duration_ms = Math.round(performance.now() - started)
  report.run.finished_at = new Date().toISOString()
  report.metrics = summarizeAiAudit(report)
  try { assertAuditReconciled(report) } catch (error) {
    report.warnings.push(error instanceof Error ? error.message : 'Audit reconciliation failed.')
  }
  try { saveAiAuditReport(report) } catch (error) {
    console.warn('Word Graph audit storage is unavailable.', error)
  }
}
