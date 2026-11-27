const origin = process.env.BOARD_SHARE_ALLOWED_ORIGIN
const key = process.env.BOARD_SHARE_SESSION_SIGNING_KEY
if (!origin || !/^https:\/\/[^/]+$/.test(origin) || !key || !/^[a-f0-9]{64}$/.test(key)) {
  throw new Error('Set BOARD_SHARE_ALLOWED_ORIGIN and BOARD_SHARE_SESSION_SIGNING_KEY in this process environment.')
}

let stagingCursor
let sharesCursor
let total = 0
for (let page = 0; page < 100; page++) {
  const response = await fetch(`${origin}/api/boardShares?action=cleanup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagingCursor, sharesCursor }),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Cleanup stopped with HTTP ${response.status}; retry the command later.`)
  const result = await response.json()
  total += result.removed
  stagingCursor = result.stagingCursor
  sharesCursor = result.sharesCursor
  if (!stagingCursor && !sharesCursor) { console.log(`Cleanup completed; ${total} objects removed.`); process.exit(0) }
}
throw new Error('Cleanup reached its 100-page bound; run the command again.')
