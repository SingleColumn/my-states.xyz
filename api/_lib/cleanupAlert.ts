// Only an aggregate failure signal leaves the application. The destination is
// an operator-managed webhook secret; no share ID, object key or error text is sent.
export async function alertOnCleanupFailure(status: number, webhook: string | undefined, fetcher: typeof fetch = fetch) {
  if (status < 500 || !webhook) return false
  let url: URL
  try { url = new URL(webhook) } catch { return false }
  if (url.protocol !== 'https:') return false
  try {
    const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'board-share-cleanup-failed', at: new Date().toISOString() }),
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch { return false }
}
