export type AiAuditMode = 'standard' | 'detailed'
export interface AiAuditEntry { callId: string; operation: string; endpoint: string; model?: string; parameters: unknown; response?: unknown; status?: number; error?: string; durationMs: number; startedAt: string }
export interface AiAuditReport { audit_schema_version: '1.0'; run: { run_id: string; started_at: string; finished_at: string | null; status: 'running' | 'completed' | 'failed' | 'cancelled'; duration_ms: number }; input: { original_word: string; context: string; parameters: unknown }; entries: AiAuditEntry[]; final_graph?: unknown; metrics?: Record<string, unknown>; warnings: string[]; errors: string[] }
const MODE_KEY = 'my-states:ai-audit-mode'; const REPORT_KEY = 'my-states:ai-audit-last'
export function auditMode(): AiAuditMode { return window.localStorage.getItem(MODE_KEY) === 'detailed' ? 'detailed' : 'standard' }
export function setAuditMode(mode: AiAuditMode) { if (mode === 'detailed') window.localStorage.setItem(MODE_KEY, mode); else window.localStorage.removeItem(MODE_KEY) }
export function isAiAuditEnabled() { return auditMode() !== 'standard' }
export function setAiAuditEnabled(enabled: boolean) { setAuditMode(enabled ? 'detailed' : 'standard') }
export function readAiAuditReport(): AiAuditReport | null { try { const raw = window.sessionStorage.getItem(REPORT_KEY); if (!raw || raw.length > 500_000) { if (raw) window.sessionStorage.removeItem(REPORT_KEY); return null } return JSON.parse(raw) as AiAuditReport } catch { return null } }
export function clearAiAuditReport() { window.sessionStorage.removeItem(REPORT_KEY) }
export function saveAiAuditReport(report: AiAuditReport) { window.sessionStorage.setItem(REPORT_KEY, JSON.stringify(report)) }
export function auditId(prefix: string) { return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}` }
