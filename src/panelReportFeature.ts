export function isPanelReportEnabled(isDevelopment: boolean, configuredValue: string | undefined): boolean {
  return isDevelopment || configuredValue === 'true'
}
