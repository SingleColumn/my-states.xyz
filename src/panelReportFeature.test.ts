import { describe, expect, it } from 'vitest'
import { isPanelReportEnabled } from './panelReportFeature'

describe('panel report feature flag', () => {
  it('enables the report during development', () => {
    expect(isPanelReportEnabled(true, undefined)).toBe(true)
  })

  it('enables the report for an explicit production flag', () => {
    expect(isPanelReportEnabled(false, 'true')).toBe(true)
  })

  it('keeps the report disabled unless the flag is exactly true', () => {
    expect(isPanelReportEnabled(false, undefined)).toBe(false)
    expect(isPanelReportEnabled(false, 'false')).toBe(false)
    expect(isPanelReportEnabled(false, 'TRUE')).toBe(false)
  })
})
