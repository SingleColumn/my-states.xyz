// The canvas relies on a pointer, a keyboard and a wide viewport, so phones
// and tablets get a short notice instead of a broken app. The check runs
// once at boot, before any of the heavy canvas code is even imported.

// The minimal slice of `navigator` the check reads, so tests can pass a
// plain object instead of stubbing the real one.
export type DeviceHints = {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
  // Chromium's User-Agent Client Hints. Absent on Safari and Firefox.
  userAgentData?: { mobile?: boolean }
}

export function isMobileDevice(hints: DeviceHints): boolean {
  if (hints.userAgentData?.mobile === true) return true

  if (/Android|iPhone|iPad|iPod/i.test(hints.userAgent)) return true

  // iPadOS 13+ deliberately reports itself as a desktop Mac. A Mac with a
  // multi-touch screen is the one reliable tell that it is really an iPad.
  const claimsMac = hints.platform === 'MacIntel' || /Macintosh/.test(hints.userAgent)
  if (claimsMac && (hints.maxTouchPoints ?? 0) > 1) return true

  return false
}

export function currentDeviceHints(): DeviceHints {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    userAgentData: nav.userAgentData,
  }
}
