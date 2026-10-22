import type { WordGraphGenerationRequest } from './wordGraphGeneration'

export type WordGraphSettings = Pick<WordGraphGenerationRequest, 'maxTotalNodes' | 'depth' | 'maxConnectionsPerNode' | 'maxRemoteness'>

const STORAGE_KEY = 'my-states:word-graph-settings'

export const defaultWordGraphSettings: WordGraphSettings = {
  maxTotalNodes: 30,
  depth: 2,
  maxConnectionsPerNode: 4,
  maxRemoteness: 0.65,
}

export function wordGraphSettingsError(value: WordGraphSettings): string | null {
  if (!Number.isInteger(value.maxTotalNodes) || value.maxTotalNodes < 1 || value.maxTotalNodes > 200) return 'Maximum nodes must be a whole number from 1 to 200.'
  if (!Number.isInteger(value.depth) || value.depth < 0 || value.depth > 5) return 'Maximum steps must be a whole number from 0 to 5.'
  if (!Number.isInteger(value.maxConnectionsPerNode) || value.maxConnectionsPerNode < 0 || value.maxConnectionsPerNode > 15) return 'Connections per word must be a whole number from 0 to 15.'
  if (!Number.isFinite(value.maxRemoteness) || value.maxRemoteness < 0 || value.maxRemoteness > 2) return 'Maximum remoteness must be from 0 to 2.'
  return null
}

export function readWordGraphSettings(): WordGraphSettings {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return { ...defaultWordGraphSettings }
    const value = JSON.parse(saved) as WordGraphSettings
    if (wordGraphSettingsError(value)) return { ...defaultWordGraphSettings }
    return {
      maxTotalNodes: value.maxTotalNodes,
      depth: value.depth,
      maxConnectionsPerNode: value.maxConnectionsPerNode,
      maxRemoteness: value.maxRemoteness,
    }
  } catch {
    return { ...defaultWordGraphSettings }
  }
}

export function saveWordGraphSettings(value: WordGraphSettings): void {
  const error = wordGraphSettingsError(value)
  if (error) throw new Error(error)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}
