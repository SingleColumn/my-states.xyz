// Share IDs are bearer links. Keep route-level metrics without sending the ID
// through pageview, session-entry, custom-event, or error properties.
const shareIdInPath = /\/share\/([a-f0-9]{48})(?=\/|[?#]|$)/gi
const possibleShareId = /\b[a-f0-9]{48}\b/gi
function redact<T>(value: T, activeShareId?: string): T {
  if (typeof value === 'string') {
    let safe = value.replace(shareIdInPath, '/share/:id')
    if (activeShareId) safe = safe.replaceAll(activeShareId, ':id')
    safe = safe.replace(possibleShareId, ':id')
    return safe as T
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, activeShareId)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key, activeShareId), redact(item, activeShareId)])) as T
  }
  return value
}

export function redactShareAnalytics<T>(value: T): T {
  const activeShareId = /^\/share\/([a-f0-9]{48})\/?$/i.exec(globalThis.location?.pathname ?? '')?.[1]
  return redact(value, activeShareId)
}
