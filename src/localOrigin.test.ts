import { describe, expect, it } from 'vitest'
import { localOriginToUse } from './localOrigin'

describe('localOriginToUse', () => {
  const chosenAddress = 'http://127.0.0.1:5173'

  it('moves a local copy opened at localhost to the chosen address, so it shows the same boards', () => {
    expect(localOriginToUse('http://localhost:5173/', chosenAddress)).toBe('http://127.0.0.1:5173')
  })

  it('accepts a chosen address written with a path', () => {
    expect(localOriginToUse('http://localhost:5173/', 'http://127.0.0.1:5173/callback')).toBe('http://127.0.0.1:5173')
  })

  it('stays put when already there, or when no address is chosen', () => {
    expect(localOriginToUse('http://127.0.0.1:5173/?board=x', chosenAddress)).toBeNull()
    expect(localOriginToUse('http://localhost:5173/', undefined)).toBeNull()
    expect(localOriginToUse('http://localhost:5173/', '')).toBeNull()
  })

  it('never moves between ports, or to or from an address that is not local', () => {
    expect(localOriginToUse('http://localhost:5174/', chosenAddress)).toBeNull()
    expect(localOriginToUse('https://www.my-states.xyz/', 'https://my-states.xyz')).toBeNull()
    expect(localOriginToUse('http://localhost:5173/', 'https://my-states.xyz')).toBeNull()
  })

  it('ignores a chosen address that is not a valid address', () => {
    expect(localOriginToUse('http://localhost:5173/', 'not an address')).toBeNull()
  })
})
