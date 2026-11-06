import { describe, expect, it } from 'vitest'
import { momentVerticalShift } from './momentView'

describe('momentVerticalShift', () => {
  it('moves a moment sitting low in the window up to the middle', () => {
    expect(momentVerticalShift(116, 940, 967)).toBeCloseTo(71.5 - 116)
  })

  it('moves a moment sitting high in the window down to the middle', () => {
    expect(momentVerticalShift(0, 200, 1000)).toBe(400)
  })

  it('leaves a centred moment where it is', () => {
    expect(momentVerticalShift(100, 900, 1000)).toBe(0)
  })

  it('keeps the top of a moment too tall for the window on screen', () => {
    expect(momentVerticalShift(-300, 1300, 1000)).toBe(16 + 300)
  })
})
