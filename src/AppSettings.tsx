import { useEffect, useRef, useState, type RefObject } from 'react'
import { FolderUp, Trash2, X } from 'lucide-react'
import { useAppState } from './AppState'
import { isPanelReportEnabled } from './panelReportFeature'
import type { ThemeModePreference } from './themes/types'
import { modesOf } from './themes/validate'
import { openAiCredentialMode, removeOpenAiCredential, saveOpenAiCredential, hasOpenAiCredential, type CredentialStorageMode } from './ai/credentials'
import { testOpenAiCredential } from './ai/service'
import { clearAiAuditReport, isAiAuditEnabled, readAiAuditReport, setAiAuditEnabled, type AiAuditReport } from './ai/audit'

interface AppSettingsProps {
  isOpen: boolean
  onClose(): void
  returnFocusRef: RefObject<HTMLElement | null>
  /** Opens the panel architecture report (development builds only); the dialog closes first so the report is not under it. */
  onOpenArchitectureReport(): void
}

type SettingsSection = 'appearance' | 'ai' | 'developer'
const panelReportEnabled = isPanelReportEnabled(import.meta.env.DEV, import.meta.env.VITE_ENABLE_PANEL_REPORT)

const modeLabels: Array<{ value: ThemeModePreference; label: string; hint: string }> = [
  { value: 'system', label: 'System', hint: 'Follow the light or dark setting of your device' },
  { value: 'light', label: 'Light', hint: 'Always light, when the theme has a light mode' },
  { value: 'dark', label: 'Dark', hint: 'Always dark, when the theme has a dark mode' },
]

/**
 * Settings: Appearance (the theme every board follows unless it pins its
 * own, the light/dark preference, and the theme library) and, in
 * development builds, Developer (the panel architecture report). The dialog
 * is built the same way as Help & About (backdrop, Escape, focus returned
 * to the opener) and is styled by the theme it edits, so the choice can be
 * seen while it is made.
 */
export function AppSettings({ isOpen, onClose, returnFocusRef, onOpenArchitectureReport }: AppSettingsProps) {
  const { appearance, boards } = useAppState()
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const wasOpenRef = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [section, setSection] = useState<SettingsSection>('appearance')
  const [aiKey, setAiKey] = useState('')
  const [aiMode, setAiMode] = useState<CredentialStorageMode>(openAiCredentialMode() ?? 'session')
  const [auditEnabled, setAuditEnabled] = useState(isAiAuditEnabled())
  const [auditReport, setAuditReport] = useState<AiAuditReport | null>(readAiAuditReport())
  useEffect(() => {
    function copyAudit(event: ClipboardEvent) {
      const selection = window.getSelection()
      const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement
      if (!anchor?.closest('.app-settings-audit-report') || !auditReport) return
      event.preventDefault()
      event.stopImmediatePropagation()
      event.clipboardData?.setData('text/plain', JSON.stringify(auditReport, null, 2))
    }
    document.addEventListener('copy', copyAudit, true)
    return () => document.removeEventListener('copy', copyAudit, true)
  }, [auditReport])

  useEffect(() => {
    if (!isOpen) return
    closeButtonRef.current?.focus()
    setNotice(null)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true
      return
    }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    const returnTarget = returnFocusRef.current
    if (returnTarget?.isConnected) returnTarget.focus()
  }, [isOpen, returnFocusRef])

  if (!isOpen) return null

  async function run(action: () => Promise<string | null>) {
    setBusy(true)
    try {
      setNotice(await action())
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'The action could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  function importTheme(file: File) {
    void run(async () => {
      const { theme, outcome } = await appearance.importThemeFile(file)
      if (outcome === 'existing') return `"${theme.name}" is already installed.`
      if (outcome === 'renamed') return `"${theme.name}" was imported under the id "${theme.id}" because "${theme.id.replace(/-\d+$/, '')}" was already installed.`
      return `"${theme.name}" was imported. Choose it above to use it.`
    })
  }

  function deleteTheme(themeId: string, name: string) {
    const users = boards.boards.filter((board) => board.themeId === themeId).length
    const usage = users ? ` ${users === 1 ? 'One board uses' : `${users} boards use`} this theme and will fall back to the theme chosen here.` : ''
    if (!window.confirm(`Delete the theme "${name}"?${usage}`)) return
    void run(async () => {
      await appearance.deleteTheme(themeId)
      return `"${name}" was deleted.`
    })
  }

  const { settings, effective, themes } = appearance
  // The theme actually on screen (a board may pin its own), not just the global choice
  const shownModes = modesOf(effective.definition)
  const boardOverrides = effective.source === 'board'

  return (
    <div className="help-about-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="help-about-dialog app-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="app-settings-title" tabIndex={-1}>
        <header className="help-about-header">
          <h2 id="app-settings-title">Settings</h2>
          <button ref={closeButtonRef} className="help-about-close" type="button" aria-label="Close Settings" title="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="app-settings-body">
          <nav className="app-settings-nav" aria-label="Settings sections">
            <button type="button" className="app-settings-nav-item" aria-current={section === 'appearance' ? 'page' : undefined} onClick={() => setSection('appearance')}>Appearance</button>
            <button type="button" className="app-settings-nav-item" aria-current={section === 'ai' ? 'page' : undefined} onClick={() => setSection('ai')}>AI Providers</button>
            {panelReportEnabled ? (
              <button type="button" className="app-settings-nav-item" aria-current={section === 'developer' ? 'page' : undefined} onClick={() => setSection('developer')}>Developer</button>
            ) : null}
          </nav>

          <div className="help-about-content app-settings-content">
            {section === 'ai' ? (
              <section aria-labelledby="app-settings-ai"><h3 id="app-settings-ai">AI Providers</h3><div className="app-settings-field"><h4>OpenAI</h4><p className="app-settings-hint">Your selected word and a short excerpt are sent to OpenAI to generate the graph. Usage is billed to your OpenAI account; a ChatGPT subscription does not include API credits.</p><label htmlFor="openai-key">API key</label><input id="openai-key" type="password" autoComplete="off" value={aiKey} placeholder={hasOpenAiCredential() ? 'Key configured' : 'Paste your OpenAI API key'} onChange={event => setAiKey(event.target.value)} /><label><input type="radio" checked={aiMode === 'session'} onChange={() => setAiMode('session')} /> Use for this browser session only</label><label><input type="radio" checked={aiMode === 'persistent'} onChange={() => setAiMode('persistent')} /> Keep across browser sessions</label><p className="app-settings-hint">Browser storage is not a secure secrets vault. The key is not placed in boards, exports, analytics, or the application backend.</p><div className="app-settings-actions"><button type="button" className="app-chrome-control" disabled={!aiKey.trim() || busy} onClick={() => void run(async () => { await testOpenAiCredential(aiKey); return 'OpenAI connection succeeded.' })}>Test connection</button><button type="button" className="app-chrome-control" disabled={!aiKey.trim() || busy} onClick={() => void run(async () => { saveOpenAiCredential(aiKey, aiMode); setAiKey(''); return 'OpenAI key saved.' })}>Save key</button><button type="button" className="app-chrome-control" disabled={!hasOpenAiCredential() || busy} onClick={() => void run(async () => { removeOpenAiCredential(); return 'OpenAI key removed.' })}>Remove key</button></div></div>{notice ? <p className="app-settings-notice" role="status">{notice}</p> : null}</section>
            ) : section === 'developer' ? (
              <section aria-labelledby="app-settings-developer">
                <h3 id="app-settings-developer">Developer</h3>
                {auditReport ? <div className="app-settings-actions"><button type="button" className="app-chrome-control" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(auditReport, null, 2))}>Copy report</button></div> : null}
                <div className="app-settings-field">
                  <h4>Panel report</h4>
                  <p className="app-settings-hint">Checks the open board's panels against their stored shapes: one shape per panel, no orphaned references, the current schema version. Available in development builds.</p>
                  <div className="app-settings-actions">
                    <button type="button" className="app-chrome-control" onClick={() => { onClose(); onOpenArchitectureReport() }}>
                      Open panel report
                    </button>
                  </div>
                </div>
                <div className="app-settings-field"><h4>Word Graph generation audit</h4><label><input type="checkbox" checked={auditEnabled} onChange={event => { setAuditEnabled(event.target.checked); setAiAuditEnabled(event.target.checked); setAuditReport(readAiAuditReport()) }} /> Record the last generation report</label><p className="app-settings-hint">Stores the selected word, AI operations, sanitized parameters, responses, errors, and timings in this browser session. API keys are never recorded.</p><div className="app-settings-actions"><button type="button" className="app-chrome-control" onClick={() => setAuditReport(readAiAuditReport())}>Refresh report</button><button type="button" className="app-chrome-control" disabled={!auditReport} onClick={() => { clearAiAuditReport(); setAuditReport(null) }}>Clear report</button></div>{auditReport ? <pre className="app-settings-audit-report" aria-label="Word Graph audit report">{JSON.stringify(auditReport, null, 2)}</pre> : <p className="app-settings-hint">No generation report is available.</p>}</div>
              </section>
            ) : (
            <section aria-labelledby="app-settings-appearance">
              <h3 id="app-settings-appearance">Appearance</h3>

              <div className="app-settings-field">
                <label htmlFor="app-settings-theme">Theme</label>
                <select
                  id="app-settings-theme"
                  className="app-dropdown"
                  value={settings.globalThemeId}
                  disabled={busy}
                  onChange={(event) => void run(async () => { await appearance.setGlobalTheme(event.target.value); return null })}
                >
                  {themes.map((theme) => (
                    <option key={theme.id} value={theme.id}>{theme.name}{theme.builtIn ? '' : ' (imported)'}</option>
                  ))}
                </select>
                <p className="app-settings-hint">
                  {boardOverrides
                    ? <>The open board uses its own theme, <strong>{effective.definition.name}</strong>. Changing the theme here affects boards that follow the global theme; the open board keeps its own until it is set back to Global in the board toolbar.</>
                    : <>Every board follows this theme unless it chooses its own in the board toolbar. The open board is showing <strong>{effective.definition.name}</strong>{effective.source === 'fallback' ? ' because the chosen theme is not installed' : ''}.</>}
                </p>
              </div>

              <fieldset className="app-settings-field app-settings-modes" disabled={busy}>
                <legend>Mode</legend>
                {modeLabels.map((mode) => {
                  const supported = mode.value === 'system' || shownModes.includes(mode.value)
                  return (
                    <label key={mode.value} className="app-settings-mode" title={supported ? mode.hint : `${effective.definition.name} has no ${mode.value} mode`}>
                      <input
                        type="radio"
                        name="app-settings-mode"
                        value={mode.value}
                        checked={settings.modePreference === mode.value}
                        onChange={() => void run(async () => { await appearance.setModePreference(mode.value); return null })}
                      />
                      <span>{mode.label}</span>
                      {!supported ? <small>not in this theme</small> : null}
                    </label>
                  )
                })}
                <p className="app-settings-hint">Showing the <strong>{effective.mode}</strong> mode of {effective.definition.name}.</p>
              </fieldset>

              <div className="app-settings-field">
                <h4>Theme library</h4>
                <ul className="app-settings-theme-list">
                  {themes.map((theme) => (
                    <li key={theme.id} className="app-settings-theme">
                      <span className="app-settings-theme-name">
                        {theme.name}
                        {theme.id === effective.themeId ? <em className="app-settings-active-badge">active</em> : null}
                      </span>
                      <small className="app-settings-theme-meta">{theme.builtIn ? 'built-in' : `imported · v${theme.version}`} · {theme.modes.join(' and ')}</small>
                      {theme.builtIn ? null : (
                        <button type="button" className="card-icon-button" aria-label={`Delete theme ${theme.name}`} title="Delete this theme" disabled={busy} onClick={() => deleteTheme(theme.id, theme.name)}>
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="app-settings-actions">
                  <button type="button" className="app-chrome-control" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                    <FolderUp size={16} aria-hidden="true" /> Import theme…
                  </button>
                  <button type="button" className="app-chrome-control" disabled={busy} onClick={() => void run(async () => { await appearance.resetAppearance(); return 'Appearance was reset to the built-in default.' })}>
                    Reset appearance
                  </button>
                </div>
                <p className="app-settings-hint">A theme is a <code>.theme.json</code> file. Built-in themes cannot be deleted or replaced; a file whose id is already taken is imported under a new id.</p>
                <input
                  ref={fileInputRef}
                  className="visually-hidden-file-input"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) importTheme(file)
                    event.currentTarget.value = ''
                  }}
                />
              </div>

              {notice ? <p className="app-settings-notice" role="status">{notice}</p> : null}
            </section>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
