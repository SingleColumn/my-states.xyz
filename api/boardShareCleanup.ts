import boardShares from './boardShares.js'
import { alertOnCleanupFailure } from './_lib/cleanupAlert.js'

// Vercel Schedules targets a plain path. The shared handler still verifies
// the operations bearer key before advancing the durable cleanup cursor.
export default {
  async fetch(request: Request) {
    try {
      const url = new URL('/api/boardShares?action=cleanup', request.url)
      const response = await boardShares.fetch(new Request(url, request))
      if (response.status >= 500) await signalFailure()
      return response
    } catch {
      await signalFailure()
      return new Response('{"error":"Board-share cleanup failed."}', { status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    }
  },
}

async function signalFailure() {
  const delivered = await alertOnCleanupFailure(503, process.env.BOARD_SHARE_CLEANUP_ALERT_URL)
  if (!delivered) console.error('Board-share cleanup failed; alert delivery is unavailable.')
}
