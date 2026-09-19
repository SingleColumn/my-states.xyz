import { describe, expect, it } from 'vitest'
import { isMobileDevice } from './deviceSupport'

describe('isMobileDevice', () => {
  it('flags Android and iPhone by user agent', () => {
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' })).toBe(true)
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' })).toBe(true)
  })

  it('trusts the client-hints mobile flag when present', () => {
    expect(isMobileDevice({ userAgent: 'anything', userAgentData: { mobile: true } })).toBe(true)
  })

  it('catches an iPad that claims to be a Mac', () => {
    const ipadUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15'
    expect(isMobileDevice({ userAgent: ipadUa, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
  })

  it('lets a real Mac and a Windows desktop through', () => {
    const macUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15'
    expect(isMobileDevice({ userAgent: macUa, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
    const winUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    expect(isMobileDevice({ userAgent: winUa, platform: 'Win32', maxTouchPoints: 0, userAgentData: { mobile: false } })).toBe(false)
  })

  it('does not treat a touchscreen Windows laptop as mobile', () => {
    const winUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    expect(isMobileDevice({ userAgent: winUa, platform: 'Win32', maxTouchPoints: 10 })).toBe(false)
  })
})
