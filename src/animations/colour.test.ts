import { describe, expect, it } from 'vitest'
import { hexToHsv, hsvToHex } from './colour'

describe('continuous illumination colours', () => {
  it('maps the ends of the hue slider and grayscale correctly', () => {
    expect(hsvToHex({ hue: 0, saturation: 1, value: 1 })).toBe('#ff0000')
    expect(hsvToHex({ hue: 120, saturation: 1, value: 1 })).toBe('#00ff00')
    expect(hsvToHex({ hue: 240, saturation: 1, value: 1 })).toBe('#0000ff')
    expect(hsvToHex({ hue: 90, saturation: 0, value: 0.5 })).toBe('#808080')
  })

  it('preserves arbitrary six-digit colours through picker conversion', () => {
    for (const hex of ['#ffd166', '#12ab34', '#000000', '#ffffff', '#74c0fc']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex)
    }
  })
})
