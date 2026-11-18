import type { AnimationDefinition } from './definitions'
import { parameterNumber } from './definitions'

export function wordIndices(text: string): Array<{ text: string; index: number | null }> {
  let index = 0
  return (text.match(/\S+|\s+/gu) ?? []).map(part => ({ text: part, index: /^\s+$/u.test(part) ? null : index++ }))
}

export function revealedCount(elapsedMs: number, speed: number, total: number) {
  return Math.min(total, Math.max(0, Math.floor(elapsedMs * speed / 1000)))
}

function nextRandom(state: number) {
  const next = (Math.imul(state, 1664525) + 1013904223) >>> 0
  return [next, next / 0x100000000] as const
}

export function illuminatedIndices(definition: AnimationDefinition, tick: number, wordCount: number): number[] {
  if (!wordCount) return []
  let state = ((parameterNumber(definition, 'seed', 1) >>> 0) ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0
  const count = Math.min(wordCount, Math.max(1, Math.floor(parameterNumber(definition, 'intensity', 3))))
  const result: number[] = []
  while (result.length < count) {
    const [next, fraction] = nextRandom(state)
    state = next
    const index = Math.floor(fraction * wordCount)
    if (!result.includes(index)) result.push(index)
  }
  return result
}
