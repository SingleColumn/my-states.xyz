import 'fake-indexeddb/auto'

class MemoryStorage implements Storage {
  #values = new Map<string, string>()

  get length() { return this.#values.size }
  clear() { this.#values.clear() }
  getItem(key: string) { return this.#values.get(key) ?? null }
  key(index: number) { return [...this.#values.keys()][index] ?? null }
  removeItem(key: string) { this.#values.delete(key) }
  setItem(key: string, value: string) { this.#values.set(key, String(value)) }
}

// Tests that drive the panels run under jsdom, which brings a real window and
// a real document with it. The stub below stands in for that window under the
// node environment the rest of the suite uses, where modules still reach for
// localStorage and for timers — so it is installed only when nothing else has
// provided one.
const hasRealDom = typeof globalThis.window !== 'undefined' && 'document' in globalThis.window

if (!hasRealDom) Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    navigator: { languages: ['en'], userAgent: 'vitest', platform: 'test' },
    localStorage: new MemoryStorage(),
    addEventListener() {},
    removeEventListener() {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  },
})

// Panels watch their own size to lay themselves out, and jsdom has no
// ResizeObserver. A stub is enough: jsdom has no layout engine either, so
// measurement cannot be tested here — these tests drive what someone types
// and what the panel then shows, not how many rows fit in it.
if (hasRealDom && !('ResizeObserver' in globalThis)) {
  class NoopResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = NoopResizeObserver
}
