import { beforeEach, describe, expect, it } from 'vitest'
import { defaultWordGraphSettings, readWordGraphSettings, saveWordGraphSettings, wordGraphSettingsError } from './wordGraphSettings'

const key = 'my-states:word-graph-settings'

describe('Word Graph settings', () => {
  beforeEach(() => window.localStorage.removeItem(key))

  it('keeps the existing generation defaults until changed', () => {
    expect(readWordGraphSettings()).toEqual({ maxTotalNodes: 30, depth: 2, maxConnectionsPerNode: 4, maxRemoteness: 0.65 })
  })

  it('saves settings for subsequent generations', () => {
    const settings = { maxTotalNodes: 1, depth: 0, maxConnectionsPerNode: 0, maxRemoteness: 0 }
    saveWordGraphSettings(settings)
    expect(readWordGraphSettings()).toEqual(settings)
    saveWordGraphSettings(defaultWordGraphSettings)
    expect(readWordGraphSettings()).toEqual(defaultWordGraphSettings)
  })

  it('rejects invalid edits and ignores malformed stored values', () => {
    expect(wordGraphSettingsError({ ...defaultWordGraphSettings, maxTotalNodes: 0 })).toBeTruthy()
    expect(wordGraphSettingsError({ ...defaultWordGraphSettings, depth: 1.5 })).toBeTruthy()
    expect(wordGraphSettingsError({ ...defaultWordGraphSettings, maxConnectionsPerNode: 16 })).toBeTruthy()
    expect(wordGraphSettingsError({ ...defaultWordGraphSettings, maxRemoteness: 2.1 })).toBeTruthy()
    expect(() => saveWordGraphSettings({ ...defaultWordGraphSettings, maxTotalNodes: 0 })).toThrow()
    expect(window.localStorage.getItem(key)).toBeNull()
    window.localStorage.setItem(key, '{broken')
    expect(readWordGraphSettings()).toEqual(defaultWordGraphSettings)
    window.localStorage.setItem(key, JSON.stringify({ ...defaultWordGraphSettings, depth: -1 }))
    expect(readWordGraphSettings()).toEqual(defaultWordGraphSettings)
  })
})
