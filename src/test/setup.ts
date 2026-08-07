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

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: new MemoryStorage(),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  },
})