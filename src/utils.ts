export interface DebouncedFunction<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void
  flush(): void
  cancel(): void
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number): DebouncedFunction<T> {
  let timeoutId: number | undefined
  let pendingArgs: Parameters<T> | undefined

  const invoke = () => {
    timeoutId = undefined
    const args = pendingArgs
    pendingArgs = undefined
    if (args) fn(...args)
  }

  const debounced = ((...args: Parameters<T>) => {
    pendingArgs = args
    window.clearTimeout(timeoutId)
    timeoutId = window.setTimeout(invoke, delayMs)
  }) as DebouncedFunction<T>

  debounced.flush = () => {
    if (timeoutId === undefined) return
    window.clearTimeout(timeoutId)
    invoke()
  }
  debounced.cancel = () => {
    window.clearTimeout(timeoutId)
    timeoutId = undefined
    pendingArgs = undefined
  }

  return debounced
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
