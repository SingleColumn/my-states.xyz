import { describe, expect, it } from 'vitest'
import { localOriginToUse } from './localOrigin'

describe('localOriginToUse', () => {
  const returnAddress = 'http://127.0.0.1:5173/callback'

  it('moves a local copy opened at localhost to the address Spotify returns to', () => {
    expect(localOriginToUse('http://localhost:5173/', returnAddress)).toBe('http://127.0.0.1:5173')
  })

  it('stays put when already there, or when no return address is set', () => {
    expect(localOriginToUse('http://127.0.0.1:5173/callback?code=x', returnAddress)).toBeNull()
    expect(localOriginToUse('http://localhost:5173/', undefined)).toBeNull()
    expect(localOriginToUse('http://localhost:5173/', '')).toBeNull()
  })

  it('never moves between ports, or to or from an address that is not local', () => {
    expect(localOriginToUse('http://localhost:5174/', returnAddress)).toBeNull()
    expect(localOriginToUse('https://www.my-states.xyz/', 'https://my-states.xyz/callback')).toBeNull()
    expect(localOriginToUse('http://localhost:5173/', 'https://my-states.xyz/callback')).toBeNull()
  })

  it('ignores a return address that is not a valid address', () => {
    expect(localOriginToUse('http://localhost:5173/', 'not an address')).toBeNull()
  })
})
