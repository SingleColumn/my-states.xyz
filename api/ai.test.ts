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
  it('distinguishes connection, response read, provider JSON, and model-output failures', async () => {
    const payload = { word: 'Love', context: '', relationshipTypes: ['related'], limit: 4 }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('socket closed') }))
    expect(await (await handler.fetch(request('associations', payload))).json()).toMatchObject({ errorCode: 'connection_failed' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull(controller) { controller.error(new Error('stream lost')) } }), { status: 200 })))
    expect(await (await handler.fetch(request('associations', payload))).json()).toMatchObject({ errorCode: 'response_read_failed' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken', { status: 200, headers: { 'x-request-id': 'req-json' } })))
    expect(await (await handler.fetch(request('associations', payload))).json()).toMatchObject({ errorCode: 'invalid_provider_json', providerRequestId: 'req-json' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output_text: '{broken', model: 'gpt-6-luna', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), { status: 200 })))
    expect(await (await handler.fetch(request('associations', payload))).json()).toMatchObject({ errorCode: 'invalid_model_output', usage: { total_tokens: 2 } })
  })

  it('preserves the upstream status and request id without exposing response content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"private upstream detail"}}', { status: 503, headers: { 'x-request-id': 'req-503' } })))
    const response = await handler.fetch(request('associations', { word: 'Love', context: '', relationshipTypes: ['related'] }))
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body).toMatchObject({ errorCode: 'upstream_http_error', upstreamStatus: 503, providerRequestId: 'req-503' })
    expect(JSON.stringify(body)).not.toContain('private upstream detail')
  })

  it('forwards association model, request id and actual Responses usage without exposing the prompt', async () => {
    const upstream = vi.fn(async (_endpoint: string, _init: RequestInit) => new Response(JSON.stringify({
      id: 'resp-123', model: 'gpt-6-luna',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ associations: [{ word: 'hate', relationship: 'opposite' }] }) }] }],
      usage: { input_tokens: 101, output_tokens: 25, total_tokens: 126, input_tokens_details: { cached_tokens: 10 } },
    }), { status: 200 }))
    vi.stubGlobal('fetch', upstream)
    const response = await handler.fetch(request('associations', { word: 'Love', context: 'private writing', relationshipTypes: ['opposite'], limit: 4 }))
    const body = await response.json()
    expect(body).toEqual({
      candidates: [{ word: 'hate', relationship: 'opposite' }],
      model: 'gpt-6-luna', providerRequestId: 'resp-123',
      usage: { input_tokens: 101, output_tokens: 25, total_tokens: 126, input_tokens_details: { cached_tokens: 10 } },
    })
    expect(JSON.stringify(body)).not.toContain('private writing')
    const sent = JSON.parse(String(upstream.mock.calls[0][1]?.body))
    expect(sent.model).toBe('gpt-6-luna')
    expect(sent.reasoning).toEqual({ effort: 'none' })
    expect(sent.text.format.schema.properties.associations.items.properties.relationship.enum).toEqual(['related', 'feeling', 'sensory', 'opposite'])
    expect(sent.max_output_tokens).toBe(450)
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
