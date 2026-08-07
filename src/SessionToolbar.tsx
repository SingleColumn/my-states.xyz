import { Download, FilePlus2, FolderUp, Pencil, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useAppState } from './AppState'

export function SessionToolbar() {
  const { sessions } = useAppState()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="session-toolbar panel-interactive" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent}>
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
        disabled={busy}
        onClick={() => {
          const name = window.prompt('Name the new session', 'Untitled session')
          if (name !== null) void run(() => sessions.create(name))
        }}
      >
        <FilePlus2 size={17} />
      </button>
      <button
        className="card-icon-button"
        type="button"
        title="Rename session"
        disabled={busy || !sessions.activeSession}
        onClick={() => {
          const name = window.prompt('Rename session', sessions.activeSession?.name ?? '')
          if (name !== null) void run(() => sessions.rename(name))
        }}
      >
        <Pencil size={16} />
      </button>
      <button className="card-icon-button" type="button" title="Export session" disabled={busy || !sessions.activeSession} onClick={() => void run(sessions.exportActive)}>
        <Download size={17} />
      </button>
      <button className="card-icon-button" type="button" title="Import session" disabled={busy} onClick={() => inputRef.current?.click()}>
        <FolderUp size={17} />
      </button>
      <button
        className="card-icon-button"
        type="button"
        title="Delete session"
        disabled={busy || !sessions.activeSession}
        onClick={() => {
          const current = sessions.activeSession
          if (!current) return
          if (window.confirm(`Delete "${current.name}"? This permanently removes this app's local copies of its images and notes. Original files and exported archives are unaffected.`)) {
            void run(() => sessions.remove(current.id))
          }
        }}
      >
        <Trash2 size={17} />
      </button>
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
    </div>
  )
}
