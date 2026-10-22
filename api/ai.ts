const MODELS = { associations: 'gpt-6-luna', embeddings: 'text-embedding-3-small' } as const
const relationshipTypes = ['related', 'feeling', 'sensory', 'opposite'] as const
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function failure(error: string, errorCode: string, status = 502, details: Record<string, unknown> = {}) {
  return json({ error, errorCode, ...details }, status)
}

async function forward(endpoint: string, authorization: string, body: unknown, signal: AbortSignal): Promise<Response> {
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal,
    })
  } catch {
    return failure(signal.aborted ? 'The AI request timed out.' : 'Could not reach the OpenAI API from the local server.', signal.aborted ? 'timeout' : 'connection_failed')
  }

  const providerRequestId = response.headers.get('x-request-id') ?? undefined
  const details = { upstreamStatus: response.status, ...(providerRequestId ? { providerRequestId } : {}) }
  let raw: string
  try { raw = await response.text() }
  catch {
    return failure(signal.aborted ? 'The AI request timed out.' : 'Could not read the OpenAI response.', signal.aborted ? 'timeout' : 'response_read_failed', 502, details)
  }

  if (!response.ok) {
    const status = response.status === 401 ? 401 : response.status === 429 ? 429 : 502
    const error = response.status === 401 ? 'The OpenAI API key was rejected.' : response.status === 429 ? 'OpenAI rate limit or credits reached.' : 'OpenAI could not complete the request.'
    return failure(error, 'upstream_http_error', status, details)
  }

  let data: any
  try { data = JSON.parse(raw) }
  catch { return failure('OpenAI returned an unreadable JSON response.', 'invalid_provider_json', 502, details) }
  const operation = endpoint.endsWith('/embeddings') ? 'embeddings' : 'associations'
  const metadata = { model: data?.model ?? MODELS[operation], providerRequestId: data?.id ?? providerRequestId, usage: data?.usage ?? null }

  if (operation === 'embeddings') {
    if (!Array.isArray(data?.data) || data.data.some((item: any) => !Number.isInteger(item?.index) || !Array.isArray(item?.embedding))) {
      return failure('OpenAI returned an invalid embedding response.', 'invalid_response_shape', 502, { ...details, usage: metadata.usage, model: metadata.model })
    }
    return json({ embeddings: data.data.sort((a: any, b: any) => a.index - b.index).map((item: any) => item.embedding), ...metadata })
  }

  const content = Array.isArray(data?.output) ? data.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : []) : []
  const output = data?.output_text || content.find((item: any) => item.type === 'output_text')?.text
  let parsed: any
  try { parsed = JSON.parse(output) }
  catch { return failure('OpenAI returned associations that were not valid JSON.', 'invalid_model_output', 502, { ...details, usage: metadata.usage, model: metadata.model }) }
  const candidates = Array.isArray(parsed) ? parsed : parsed?.candidates ?? parsed?.associations ?? parsed?.edges
  if (!Array.isArray(candidates)) return failure('OpenAI returned an invalid association response.', 'invalid_response_shape', 502, { ...details, usage: metadata.usage, model: metadata.model })
  return json({ candidates, ...metadata })
}

export default { async fetch(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const authorization = request.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S{20,256}$/.test(authorization)) return json({ error: 'An OpenAI API key is required.' }, 401)
  let input: any
  try { input = await request.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  const operation = input?.operation
  if (!['connection-test', 'associations', 'embeddings'].includes(operation)) return json({ error: 'Unsupported AI operation.' }, 400)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    if (operation === 'connection-test') {
      let response: Response
      try { response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: authorization }, signal: controller.signal }) }
      catch { return failure(controller.signal.aborted ? 'The AI request timed out.' : 'Could not reach the OpenAI API from the local server.', controller.signal.aborted ? 'timeout' : 'connection_failed') }
      return response.ok ? json({ ok: true }) : failure(response.status === 401 ? 'The OpenAI API key was rejected.' : 'OpenAI could not complete the request.', 'upstream_http_error', response.status === 401 ? 401 : 502, { upstreamStatus: response.status })
    }
    if (operation === 'embeddings') {
      if (!Array.isArray(input.input) || input.input.length > 100 || input.input.some((value: unknown) => typeof value !== 'string' || value.length > 200)) return json({ error: 'Invalid embedding request.' }, 400)
      return await forward('https://api.openai.com/v1/embeddings', authorization, { model: MODELS.embeddings, input: input.input, encoding_format: 'float' }, controller.signal)
    }
    if (typeof input.word !== 'string' || input.word.length > 80 || !Array.isArray(input.relationshipTypes) || input.relationshipTypes.some((value: unknown) => !relationshipTypes.includes(value as any))) return json({ error: 'Invalid association request.' }, 400)
    const path = Array.isArray(input.path) ? input.path.filter((part: unknown) => typeof part === 'string').join(' → ') : ''
    const limit = Math.min(10, Math.max(1, Number(input.limit) || 10))
    const body = {
      model: MODELS.associations,
      reasoning: { effort: 'none' },
      input: `Generate up to ${limit} short, distinct word associations for "${input.word}". Context: ${String(input.context || '').slice(0, 600)}. Path: ${path}. Label each connection using exactly one category: related (general meaning, concept, or symbol), feeling (an emotion it evokes), sensory (sight, sound, touch, taste, or smell), opposite (a clear contrast in meaning). Prefer the specific category when it clearly fits; otherwise use related. Return only the requested associations.`,
      text: { format: { type: 'json_schema', name: 'word_associations', strict: true, schema: {
        type: 'object', properties: { associations: { type: 'array', items: {
          type: 'object', properties: { word: { type: 'string' }, relationship: { type: 'string', enum: relationshipTypes } },
          required: ['word', 'relationship'], additionalProperties: false,
        } } }, required: ['associations'], additionalProperties: false,
      } } }, max_output_tokens: 450,
    }
    return await forward('https://api.openai.com/v1/responses', authorization, body, controller.signal)
  } finally { clearTimeout(timer) }
} }
