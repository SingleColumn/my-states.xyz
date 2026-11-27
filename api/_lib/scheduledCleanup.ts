// A Vercel path schedule POSTs an empty request, but how that emptiness
// arrives is not fixed: no body, Content-Length 0, an empty stream with no
// length, or a stray Content-Type. On 2026-11-27 the first Production run
// fell through to the JSON-body check and got 415, while Preview runs of the
// same code passed. A schedule never sends cleanup cursors, so keep only what
// the cleanup action reads -- the method and the operations bearer key -- and
// it always reaches the scheduled, cursor-persisting cleanup.
export function scheduledCleanupRequest(request: Request): Request {
  const authorization = request.headers.get('authorization')
  return new Request(new URL('/api/boardShares?action=cleanup', request.url), {
    method: request.method,
    headers: authorization ? { authorization } : {},
  })
}
