// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_MODEL_PRICING, clearAiAuditReport, estimateRequestCost, readAiAuditReport, setAiAuditEnabled, summarizeAiAudit, type AiAuditReport } from './audit'
import { requestWordGraph } from './service'
import { generateWordGraph, type WordGraphCandidateDecision, type WordGraphGenerationRequest } from '../wordGraph/wordGraphGeneration'
import { relationshipTypes, type RelationshipType } from '../wordGraph/wordGraphTypes'
import { validateWordGraphStructure } from '../wordGraph/wordGraphValidation'
import { loadSavedWordGraph, saveCompletedWordGraph } from '../wordGraph/wordGraphStorage'

const request: WordGraphGenerationRequest = {
  word: 'Love', context: 'Contradictions Love and hate can happen at the same time.',
  maxTotalNodes: 30, depth: 2, maxConnectionsPerNode: 4, maxRemoteness: 0.65, relationshipTypes,
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.localStorage.setItem('my-states:openai-key', 'sk-test-word-graph-audit-1234567890')
  vi.restoreAllMocks()
})
afterEach(() => { vi.unstubAllGlobals() })

function mockedProxy(responses: Record<string, Array<{ word: string; relationship: string }>>, options?: { usage?: boolean; embeddingUsage?: boolean; model?: string; remoteWords?: string[] }) {
  const attempts: string[] = []
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body)) as { operation: string; word?: string; input?: string[] }
    attempts.push(`${payload.operation}:${payload.word ?? payload.input?.join(',')}`)
    if (payload.operation === 'embeddings') {
      return new Response(JSON.stringify({
        embeddings: payload.input!.map(word => options?.remoteWords?.includes(word) ? [-1, 0] : [1, 0]),
        model: 'text-embedding-3-small',
        ...(options?.embeddingUsage === false ? {} : { usage: { prompt_tokens: 10, total_tokens: 10 } }),
      }), { status: 200 })
    }
    return new Response(JSON.stringify({
      candidates: responses[payload.word!] ?? [],
      model: options?.model ?? 'gpt-6-luna',
      providerRequestId: `resp-${payload.word}`,
      ...(options?.usage === false ? {} : { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }),
    }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, attempts }
}

describe('candidate decision instrumentation', () => {
  it('records below, equal and above threshold distances and pre-embedding rejections without changing the graph', async () => {
    const decisions: WordGraphCandidateDecision[] = []
    const associations = vi.fn(async ({ word }: { word: string }) => ({ candidates: word === 'love' ? [
      { word: '', relationship: 'related' as const },
      { word: 'near', relationship: 'related' as const },
      { word: 'NEAR', relationship: 'related' as const },
      { word: 'boundary', relationship: 'related' as const },
      { word: 'remote', relationship: 'opposite' as const },
    ] : [] }))
    const embeddings = vi.fn(async ({ input }: { input: string[] }) => ({ embeddings: input.map(word =>
      word === 'boundary' ? [0, 1] : word === 'remote' ? [-1, 0] : [1, 0],
    ) }))
    const configured = { ...request, depth: 1, maxRemoteness: 1 }
    const graph = await generateWordGraph(configured, associations, embeddings, undefined, {
      onCandidateProposed: decision => decisions.push(decision),
    })
    const withoutAudit = await generateWordGraph(configured, associations, embeddings)
    expect(graph).toEqual(withoutAudit)
    expect(decisions.map(decision => [decision.status, decision.reason])).toEqual([
      ['rejected', 'invalid_candidate'], ['accepted', undefined], ['rejected', 'duplicate_candidate'],
      ['accepted', undefined], ['rejected', 'remoteness_exceeded'],
    ])
    expect(decisions.map(decision => decision.cosineDistance)).toEqual([null, 0, null, 1, 2])
    expect(decisions.map(decision => decision.passedRemoteness)).toEqual([null, true, null, true, false])
    expect(decisions[3].maxRemoteness).toBe(1)
    expect(decisions[1].edgeId).toBe('word:love:related:word:near')
    expect(embeddings.mock.calls[0][0].input).not.toContain('')
  })

  it('explains node and outgoing budgets, existing nodes and skipped depth expansions', async () => {
    const decisions: WordGraphCandidateDecision[] = []
    const skipped: string[] = []
    const responses: Record<string, Array<{ word: string; relationship: RelationshipType }>> = {
      love: [{ word: 'a', relationship: 'related' }, { word: 'b', relationship: 'related' }],
      a: [{ word: 'b', relationship: 'feeling' }, { word: 'c', relationship: 'related' }, { word: 'd', relationship: 'related' }],
    }
    const associations = async ({ word }: { word: string }) => ({ candidates: responses[word] ?? [] })
    const embeddings = async ({ input }: { input: string[] }) => ({ embeddings: input.map(() => [1, 0]) })
    const configured = { ...request, maxTotalNodes: 3, maxConnectionsPerNode: 2 }
    const graph = await generateWordGraph(configured, associations, embeddings, undefined, {
      onCandidateProposed: decision => decisions.push(decision),
      onExpansionSkipped: decision => skipped.push(decision.reason),
    })
    expect(graph.nodes).toHaveLength(3)
    // A full node budget stops expansion before another association call.
    expect(decisions).toHaveLength(2)
    expect(skipped).toContain('max_total_nodes')
    expect(validateWordGraphStructure(graph, configured).valid).toBe(true)

    const second = { ...request, maxTotalNodes: 5, maxConnectionsPerNode: 2 }
    const secondDecisions: WordGraphCandidateDecision[] = []
    const result = await generateWordGraph(second, associations, embeddings, undefined, { onCandidateProposed: decision => secondDecisions.push(decision) })
    const fromA = secondDecisions.filter(decision => decision.sourceWord === 'a')
    expect(fromA.map(decision => decision.reason)).toEqual([undefined, undefined, 'max_outgoing_connections'])
    expect(fromA[0].introducedNewNode).toBe(false)
    expect(fromA[0].introducedNewEdge).toBe(true)
    expect(result.edges.some(edge => edge.id === fromA[0].edgeId)).toBe(true)
  })

  it('records node-budget rejection after a measured distance without orphaning the candidate', async () => {
    const decisions: WordGraphCandidateDecision[] = []
    const configured = { ...request, maxTotalNodes: 6 }
    const associations = async ({ word }: { word: string }) => ({ candidates: word === 'love'
      ? ['a', 'b', 'c', 'd'].map(target => ({ word: target, relationship: 'related' as const }))
      : word === 'a' ? ['leaf-1', 'leaf-2', 'leaf-3'].map(target => ({ word: target, relationship: 'related' as const }))
      : [] })
    const embeddings = async ({ input }: { input: string[] }) => ({ embeddings: input.map(() => [1, 0]) })
    const graph = await generateWordGraph(configured, associations, embeddings, undefined, { onCandidateProposed: decision => decisions.push(decision) })
    expect(graph.nodes).toHaveLength(6)
    const rejected = decisions.filter(decision => decision.reason === 'max_total_nodes')
    expect(rejected).toHaveLength(2)
    expect(rejected.every(decision => decision.cosineDistance === 0 && decision.passedRemoteness === true)).toBe(true)
    expect(graph.nodes.some(node => node.normalizedWord === 'leaf-2')).toBe(false)
    expect(validateWordGraphStructure(graph, configured).valid).toBe(true)
  })

  it('marks a proposed but unresolved candidate when cancellation arrives during embeddings', async () => {
    const controller = new AbortController()
    const decisions: WordGraphCandidateDecision[] = []
    let release!: (value: { embeddings: number[][] }) => void
    const embeddings = () => new Promise<{ embeddings: number[][] }>(resolve => { release = resolve })
    const generation = generateWordGraph(request, async () => ({ candidates: [{ word: 'late', relationship: 'related' }] }), embeddings, controller.signal, {
      onCandidateProposed: decision => decisions.push(decision),
    })
    await vi.waitFor(() => expect(decisions).toHaveLength(1))
    controller.abort()
    release({ embeddings: [[1, 0], [1, 0]] })
    await expect(generation).rejects.toMatchObject({ name: 'AbortError' })
    expect(decisions[0].status).toBe('unresolved')
  })
})

describe('request usage and audit persistence', () => {
  it('preserves per-request usage and estimates small association plus embedding costs', async () => {
    setAiAuditEnabled(true)
    mockedProxy({ love: [{ word: 'hate', relationship: 'opposite' }], hate: [] })
    const graph = await requestWordGraph(request)
    const report = readAiAuditReport()!
    expect(report.audit_schema_version).toBe('1.1')
    expect(report.run.status).toBe('completed')
    expect(report.entries.map(entry => entry.operation)).toEqual(['generate_associations', 'generate_embeddings', 'generate_associations'])
    expect(report.entries[0]).toMatchObject({ model: 'gpt-6-luna', providerRequestId: 'resp-love', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, estimatedCostUsd: 0.00002 })
    expect(report.entries[1]).toMatchObject({ model: 'text-embedding-3-small', usage: { inputTokens: 10, totalTokens: 10 } })
    expect(report.entries[1].estimatedCostUsd).toBeCloseTo(0.0000002, 12)
    expect(report.metrics).toMatchObject({
      api_calls: 3, association_requests: 2, embedding_requests: 1,
      candidates_proposed: 1, candidates_evaluated_for_remoteness: 1, candidates_accepted: 1, candidates_rejected: 0,
      distinct_nodes_admitted: 1, edges_admitted: 1, actual_input_tokens: 210, actual_output_tokens: 40, actual_total_tokens: 250,
      usage_complete: true, cost_complete: true, estimated_association_cost_usd: 0.00004,
    })
    expect(report.metrics?.estimated_embedding_cost_usd).toBeCloseTo(0.0000002, 12)
    expect(report.metrics?.estimated_cost_usd).toBeCloseTo(0.0000402, 12)
    expect(report.candidate_decisions[0].edgeId).toBe(graph.edges[0].id)
    expect(report.warnings).toEqual([])
  })

  it('leaves cost incomplete when usage or pricing is missing', async () => {
    setAiAuditEnabled(true)
    mockedProxy({ love: [{ word: 'hate', relationship: 'opposite' }], hate: [] }, { embeddingUsage: false, model: 'unknown-model' })
    await requestWordGraph(request)
    const report = readAiAuditReport()!
    expect(report.metrics?.actual_input_tokens).toBe(200)
    expect(report.metrics?.actual_output_tokens).toBe(40)
    expect(report.metrics?.usage_complete).toBe(false)
    expect(report.metrics?.cost_complete).toBe(false)
    expect(report.metrics?.estimated_cost_usd).toBeNull()
    expect(report.entries.map(entry => entry.costStatus)).toEqual(['pricing_unavailable', 'usage_unavailable', 'pricing_unavailable'])
  })

  it('retains partial reported token counts without treating them as complete pricing evidence', async () => {
    setAiAuditEnabled(true)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { operation: string; word?: string }
      if (payload.operation === 'embeddings') return new Response(JSON.stringify({ embeddings: [[1, 0], [1, 0]], model: 'text-embedding-3-small', usage: { prompt_tokens: 10, total_tokens: 10 } }), { status: 200 })
      return new Response(JSON.stringify({ candidates: payload.word === 'love' ? [{ word: 'hate', relationship: 'opposite' }] : [], model: 'gpt-6-luna', usage: { input_tokens: 100, total_tokens: 120 } }), { status: 200 })
    }))
    await requestWordGraph(request)
    const report = readAiAuditReport()!
    expect(report.entries[0].usage).toEqual({ inputTokens: 100, totalTokens: 120 })
    expect(report.entries[0].costStatus).toBe('usage_unavailable')
    expect(report.metrics?.actual_input_tokens).toBe(210)
    expect(report.metrics?.usage_complete).toBe(false)
    expect(report.metrics?.estimated_cost_usd).toBeNull()
  })

  it('honors the toggle per attempt, preserves old reports, and leaves graph recovery available', async () => {
    setAiAuditEnabled(true)
    mockedProxy({ love: [{ word: 'hate', relationship: 'opposite' }], hate: [] })
    await requestWordGraph(request)
    const oldReport = readAiAuditReport()!
    setAiAuditEnabled(false)
    const disabledGraph = await requestWordGraph(request)
    expect(readAiAuditReport()).toEqual(oldReport)
    const boardId = `audit-test-${crypto.randomUUID()}`
    await saveCompletedWordGraph(boardId, disabledGraph)
    expect((await loadSavedWordGraph(boardId))?.graph.nodes).toEqual(disabledGraph.nodes)
    clearAiAuditReport()
    await requestWordGraph(request)
    expect(readAiAuditReport()).toBeNull()
    setAiAuditEnabled(true)
    await requestWordGraph(request)
    expect(readAiAuditReport()?.run.status).toBe('completed')
  })

  it('captures the setting at generation start even when it changes mid-request', async () => {
    setAiAuditEnabled(true)
    const proxy = mockedProxy({ love: [{ word: 'hate', relationship: 'opposite' }], hate: [] })
    const original = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      setAiAuditEnabled(false)
      return original(url, init)
    }))
    await requestWordGraph(request)
    expect(proxy.fetch).toHaveBeenCalled()
    expect(readAiAuditReport()?.run.status).toBe('completed')
  })

  it('explains the deterministic Love scenario and produces the same graph with recording disabled', async () => {
    const first = ['hate', 'compassion', 'duality', 'darkness', 'trust', 'devotion', 'desire', 'conflict', 'creation']
    const responses: Record<string, Array<{ word: string; relationship: string }>> = {
      love: first.map((word, index) => ({ word, relationship: index === 0 ? 'opposite' : 'related' })),
    }
    for (const word of first.slice(0, 4)) responses[word] = [
      { word: 'love', relationship: 'feeling' },
      { word: `${word}-remote`, relationship: 'related' },
      ...Array.from({ length: 8 }, (_, index) => ({ word: `${word}-${index}`, relationship: 'related' })),
    ]
    const remoteWords = first.slice(0, 4).map(word => `${word}-remote`)
    setAiAuditEnabled(true)
    const proxy = mockedProxy(responses, { remoteWords })
    const audited = await requestWordGraph(request)
    const report = readAiAuditReport()!
    expect(report.input.original_word).toBe('Love')
    expect(report.candidate_decisions.filter(decision => decision.status === 'accepted').length).toBe(audited.edges.length)
    expect(report.candidate_decisions.some(decision => decision.reason === 'remoteness_exceeded' && decision.cosineDistance === 2)).toBe(true)
    expect(report.candidate_decisions.some(decision => decision.reason === 'max_outgoing_connections')).toBe(true)
    expect(report.candidate_decisions.every(decision => report.entries.some(entry => entry.callId === decision.requestId))).toBe(true)
    expect(report.metrics?.candidates_proposed).toBe(report.metrics!.candidates_accepted + report.metrics!.candidates_rejected)
    expect(report.metrics?.cost_complete).toBe(true)
    expect(report.metrics?.estimated_cost_usd).toBeGreaterThan(0)
    expect(validateWordGraphStructure(audited, request).valid).toBe(true)
    setAiAuditEnabled(false)
    const withoutAudit = await requestWordGraph(request)
    expect(withoutAudit).toEqual(audited)
    expect(proxy.fetch).toHaveBeenCalled()
    expect(readAiAuditReport()).toEqual(report)
  })

  it('retains received usage and marks a failed request as unknown cost', async () => {
    setAiAuditEnabled(true)
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { operation: string; word?: string }
      if (payload.word === 'hate') return new Response(JSON.stringify({ error: 'failed' }), { status: 502 })
      if (payload.operation === 'embeddings') return new Response(JSON.stringify({ embeddings: [[1, 0], [1, 0]], model: 'text-embedding-3-small', usage: { prompt_tokens: 10, total_tokens: 10 } }), { status: 200 })
      return new Response(JSON.stringify({ candidates: [{ word: 'hate', relationship: 'opposite' }], model: 'gpt-6-luna', usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    const graph = await requestWordGraph(request)
    expect(graph.generation).toEqual({ status: 'partial', failedRequests: 1 })
    const report = readAiAuditReport()!
    expect(report.run.status).toBe('partial')
    expect(report.metrics?.api_calls).toBe(3)
    expect(report.metrics?.actual_input_tokens).toBe(110)
    expect(report.metrics?.estimated_cost_usd).toBeNull()
    expect(report.metrics?.cost_complete).toBe(false)
  })

  it('persists a cancelled partial report with usage received before cancellation', async () => {
    setAiAuditEnabled(true)
    const controller = new AbortController()
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { operation: string }
      if (payload.operation === 'embeddings') return pending
      return new Response(JSON.stringify({
        candidates: [{ word: 'hate', relationship: 'opposite' }],
        model: 'gpt-6-luna', usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    const generation = requestWordGraph(request, controller.signal)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    controller.abort()
    release(new Response(JSON.stringify({
      embeddings: [[1, 0], [1, 0]], model: 'text-embedding-3-small',
      usage: { prompt_tokens: 10, total_tokens: 10 },
    }), { status: 200 }))
    await expect(generation).rejects.toMatchObject({ name: 'AbortError' })
    const report = readAiAuditReport()!
    expect(report.run.status).toBe('cancelled')
    expect(report.metrics?.api_calls).toBe(2)
    expect(report.metrics?.actual_input_tokens).toBe(110)
    expect(report.candidate_decisions).toMatchObject([{ status: 'unresolved', reason: 'cancelled', cosineDistance: null }])
  })

  it('retains successful concurrent proposals when another branch fails', async () => {
    setAiAuditEnabled(true)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { operation: string; word?: string; input?: string[] }
      if (payload.operation === 'embeddings') return new Response(JSON.stringify({ embeddings: payload.input!.map(() => [1, 0]), model: 'text-embedding-3-small', usage: { prompt_tokens: 10, total_tokens: 10 } }), { status: 200 })
      if (payload.word === 'b') return new Response(JSON.stringify({ error: 'association failure' }), { status: 502 })
      const candidates = payload.word === 'love'
        ? [{ word: 'a', relationship: 'related' }, { word: 'b', relationship: 'related' }]
        : [{ word: 'unprocessed', relationship: 'related' }]
      return new Response(JSON.stringify({ candidates, model: 'gpt-6-luna', usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }), { status: 200 })
    }))
    const graph = await requestWordGraph(request)
    expect(graph.generation).toEqual({ status: 'partial', failedRequests: 1 })
    expect(graph.nodes.some(node => node.normalizedWord === 'unprocessed')).toBe(true)
    const report = readAiAuditReport()!
    expect(report.run.status).toBe('partial')
    expect(report.metrics?.association_requests).toBe(3)
    expect(report.metrics?.embedding_requests).toBe(2)
    expect(report.candidate_decisions.find(decision => decision.proposedTarget === 'unprocessed')).toMatchObject({ status: 'accepted' })
    expect(report.metrics?.candidates_unresolved).toBe(0)
    expect(report.metrics?.cost_complete).toBe(false)
    expect(report.warnings).toContain('1 AI request(s) failed; the graph is incomplete.')
    expect(report.expansion_decisions).toContainEqual(expect.objectContaining({ sourceWord: 'b', reason: 'request_failed' }))
  })
})

describe('pricing and summary arithmetic', () => {
  it('uses reviewed model rates, cached input and full precision', () => {
    expect(AI_MODEL_PRICING['gpt-6-luna'].source).toContain('developers.openai.com')
    expect(estimateRequestCost('gpt-6-luna', { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, totalTokens: 120 })).toBe(0.0000164)
    expect(estimateRequestCost('text-embedding-3-small', { inputTokens: 1, totalTokens: 1 })).toBe(0.00000002)
    expect(estimateRequestCost('unknown-model', { inputTokens: 100, outputTokens: 20, totalTokens: 120 })).toBeNull()
    expect(estimateRequestCost('gpt-6-luna', null)).toBeNull()
  })

  it('reconciles candidate totals and known usage without turning partial cost into a complete total', () => {
    const report: AiAuditReport = {
      audit_schema_version: '1.1',
      run: { run_id: 'test', started_at: '', finished_at: '', status: 'failed', duration_ms: 1000 },
      input: { original_word: 'Love', context: '', parameters: request }, entries: [], candidate_decisions: [], expansion_decisions: [], warnings: [], errors: [],
    }
    expect(summarizeAiAudit(report)).toMatchObject({ candidates_proposed: 0, candidates_accepted: 0, candidates_rejected: 0, estimated_cost_usd: 0 })
  })
})
