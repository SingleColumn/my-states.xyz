import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from './ai'

afterEach(() => vi.unstubAllGlobals())

function request(operation: string, payload: Record<string, unknown>) {
  return new Request('http://localhost/api/ai', {
    method: 'POST',
    headers: { Authorization: 'Bearer sk-test-audit-proxy-1234567890', 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, ...payload }),
  })
}

describe('Word Graph OpenAI proxy metadata', () => {
  it('forwards association model, request id and actual Responses usage without exposing the prompt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-123', model: 'gpt-4o-mini',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ associations: [{ word: 'hate', relationship: 'opposite' }] }) }] }],
      usage: { input_tokens: 101, output_tokens: 25, total_tokens: 126, input_tokens_details: { cached_tokens: 10 } },
    }), { status: 200 })))
    const response = await handler.fetch(request('associations', { word: 'Love', context: 'private writing', relationshipTypes: ['opposite'], limit: 4 }))
    const body = await response.json()
    expect(body).toEqual({
      candidates: [{ word: 'hate', relationship: 'opposite' }],
      model: 'gpt-4o-mini', providerRequestId: 'resp-123',
      usage: { input_tokens: 101, output_tokens: 25, total_tokens: 126, input_tokens_details: { cached_tokens: 10 } },
    })
    expect(JSON.stringify(body)).not.toContain('private writing')
  })

  it('forwards embedding usage and retains vector order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      model: 'text-embedding-3-small',
      data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }],
      usage: { prompt_tokens: 8, total_tokens: 8 },
    }), { status: 200, headers: { 'x-request-id': 'req-embedding-1' } })))
    const response = await handler.fetch(request('embeddings', { input: ['love', 'hate'] }))
    expect(await response.json()).toEqual({
      embeddings: [[1, 0], [0, 1]], model: 'text-embedding-3-small',
      providerRequestId: 'req-embedding-1', usage: { prompt_tokens: 8, total_tokens: 8 },
    })
  })
})
