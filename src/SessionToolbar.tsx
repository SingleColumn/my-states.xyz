import { Download, FilePlus2, FolderUp, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAppState } from './AppState'

export function SessionToolbar() {
  const { sessions } = useAppState()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    if (!isMenuOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsMenuOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setIsMenuOpen(false)
      menuTriggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMenuOpen])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Session action failed.')
    } finally {
      setBusy(false)
    }
  }

  function stopCanvasEvent(event: React.SyntheticEvent) {
    ;(event as unknown as { isKilled?: boolean }).isKilled = true
    ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
    event.stopPropagation()
  }

  function createSession() {
    const name = window.prompt('Name the new session', 'Untitled session')
    if (name !== null) void run(() => sessions.create(name))
  }

  function renameSession() {
    const name = window.prompt('Rename session', sessions.activeSession?.name ?? '')
    if (name !== null) void run(() => sessions.rename(name))
  }

  function deleteSession() {
    const current = sessions.activeSession
    if (!current) return
    if (window.confirm(`Delete "${current.name}"? This permanently removes this app's local copies of its images and notes. Original files and exported archives are unaffected.`)) {
      void run(() => sessions.remove(current.id))
    }
  }

  function runMenuAction(action: () => void) {
    setIsMenuOpen(false)
    action()
  }

  return (
    <section ref={rootRef} className="session-toolbar panel-interactive" aria-label="Session controls" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent}>
      <select
        aria-label="Open session"
        value={sessions.activeSession?.id ?? ''}
        disabled={busy}
        onChange={(event) => void run(() => sessions.open(event.target.value))}
      >
        {sessions.sessions.map((session) => (
          <option key={session.id} value={session.id}>{session.name}</option>
        ))}
      </select>
      <button
        className="card-icon-button"
        type="button"
        title="New session"
        aria-label="New session"
        disabled={busy}
        onClick={createSession}
      >
        <FilePlus2 size={17} />
      </button>
      <button
        className="card-icon-button session-action-secondary"
        type="button"
        title="Rename session"
        aria-label="Rename session"
        disabled={busy || !sessions.activeSession}
        onClick={renameSession}
      >
        <Pencil size={16} />
      </button>
      <button className="card-icon-button session-action-secondary session-action-transfer" type="button" title="Export session" aria-label="Export session" disabled={busy || !sessions.activeSession} onClick={() => void run(sessions.exportActive)}>
        <Download size={17} />
      </button>
      <button className="card-icon-button session-action-secondary" type="button" title="Import session" aria-label="Import session" disabled={busy} onClick={() => inputRef.current?.click()}>
        <FolderUp size={17} />
      </button>
      <button
        className="card-icon-button session-action-secondary session-action-delete"
        type="button"
        title="Delete session"
        aria-label="Delete session"
        disabled={busy || !sessions.activeSession}
        onClick={deleteSession}
      >
        <Trash2 size={17} />
      </button>
      <button
        ref={menuTriggerRef}
        className="card-icon-button session-actions-menu-trigger"
        type="button"
        title="More session actions"
        aria-label="More session actions"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        disabled={busy}
        onClick={() => setIsMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={17} aria-hidden="true" />
      </button>
      {isMenuOpen ? (
        <div ref={menuRef} className="session-actions-menu" role="menu" aria-label="Session actions">
          <button type="button" role="menuitem" disabled={!sessions.activeSession} onClick={() => runMenuAction(renameSession)}>
            <Pencil size={16} aria-hidden="true" /><span>Rename session</span>
          </button>
          <button type="button" role="menuitem" disabled={!sessions.activeSession} onClick={() => runMenuAction(() => void run(sessions.exportActive))}>
            <Download size={17} aria-hidden="true" /><span>Export session</span>
          </button>
          <button type="button" role="menuitem" onClick={() => runMenuAction(() => inputRef.current?.click())}>
            <FolderUp size={17} aria-hidden="true" /><span>Import session</span>
          </button>
          <button className="is-destructive" type="button" role="menuitem" disabled={!sessions.activeSession} onClick={() => runMenuAction(deleteSession)}>
            <Trash2 size={17} aria-hidden="true" /><span>Delete session</span>
          </button>
        </div>
      ) : null}
      <input
        ref={inputRef}
        className="visually-hidden-file-input"
        type="file"
        accept=".zip,.mix-session.zip,application/zip"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void run(() => sessions.importFile(file))
          event.currentTarget.value = ''
        }}
      />
      {error ? <span className="session-toolbar-error">{error}</span> : null}
    </section>
  )
}
