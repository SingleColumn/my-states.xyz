export function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number) {
  let timeoutId: number | undefined

  return (...args: Parameters<T>) => {
    window.clearTimeout(timeoutId)
    timeoutId = window.setTimeout(() => fn(...args), delayMs)
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
