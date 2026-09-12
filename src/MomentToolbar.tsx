import { Download, FilePlus2, FolderUp, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAppState } from './AppState'

export function MomentToolbar() {
  const { moments } = useAppState()
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
      setError(caught instanceof Error ? caught.message : 'The action could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  function stopCanvasEvent(event: React.SyntheticEvent) {
    ;(event as unknown as { isKilled?: boolean }).isKilled = true
    ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
    event.stopPropagation()
  }

  function createMoment() {
    const name = window.prompt('Name the new moment', 'Untitled moment')
    if (name !== null) void run(() => moments.create(name))
  }

  function renameMoment() {
    const name = window.prompt('Rename moment', moments.activeMoment?.name ?? '')
    if (name !== null) void run(() => moments.rename(name))
  }

  function deleteMoment() {
    const current = moments.activeMoment
    if (!current) return
    if (window.confirm(`Delete "${current.name}"? This permanently removes this app's local copies of its images and notes. Original files and exported archives are unaffected.`)) {
      void run(() => moments.remove(current.id))
    }
  }

  function runMenuAction(action: () => void) {
    setIsMenuOpen(false)
    action()
  }

  return (
    <section ref={rootRef} className="moment-toolbar panel-interactive" aria-label="Moment controls" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent}>
      <select
        className="app-dropdown"
        aria-label="Open moment"
        value={moments.activeMoment?.id ?? ''}
        disabled={busy}
        onChange={(event) => void run(() => moments.open(event.target.value))}
      >
        {moments.moments.map((moment) => (
          <option key={moment.id} value={moment.id}>{moment.name}</option>
        ))}
      </select>
      <button
        className="card-icon-button"
        type="button"
        title="New moment"
        aria-label="New moment"
        disabled={busy}
        onClick={createMoment}
      >
        <FilePlus2 size={17} />
      </button>
      <button
        className="card-icon-button moment-action-secondary"
        type="button"
        title="Rename moment"
        aria-label="Rename moment"
        disabled={busy || !moments.activeMoment}
        onClick={renameMoment}
      >
        <Pencil size={16} />
      </button>
      <button className="card-icon-button moment-action-secondary moment-action-transfer" type="button" title="Export moment" aria-label="Export moment" disabled={busy || !moments.activeMoment} onClick={() => void run(moments.exportActive)}>
        <Download size={17} />
      </button>
      <button className="card-icon-button moment-action-secondary" type="button" title="Import moment" aria-label="Import moment" disabled={busy} onClick={() => inputRef.current?.click()}>
        <FolderUp size={17} />
      </button>
      <button
        className="card-icon-button moment-action-secondary moment-action-delete"
        type="button"
        title="Delete moment"
        aria-label="Delete moment"
        disabled={busy || !moments.activeMoment}
        onClick={deleteMoment}
      >
        <Trash2 size={17} />
      </button>
      <button
        ref={menuTriggerRef}
        className="card-icon-button moment-actions-menu-trigger"
        type="button"
        title="More moment actions"
        aria-label="More moment actions"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        disabled={busy}
        onClick={() => setIsMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={17} aria-hidden="true" />
      </button>
      {isMenuOpen ? (
        <div ref={menuRef} className="moment-actions-menu" role="menu" aria-label="Moment actions">
          <button type="button" role="menuitem" disabled={!moments.activeMoment} onClick={() => runMenuAction(renameMoment)}>
            <Pencil size={16} aria-hidden="true" /><span>Rename moment</span>
          </button>
          <button type="button" role="menuitem" disabled={!moments.activeMoment} onClick={() => runMenuAction(() => void run(moments.exportActive))}>
            <Download size={17} aria-hidden="true" /><span>Export moment</span>
          </button>
          <button type="button" role="menuitem" onClick={() => runMenuAction(() => inputRef.current?.click())}>
            <FolderUp size={17} aria-hidden="true" /><span>Import moment</span>
          </button>
          <button className="is-destructive" type="button" role="menuitem" disabled={!moments.activeMoment} onClick={() => runMenuAction(deleteMoment)}>
            <Trash2 size={17} aria-hidden="true" /><span>Delete moment</span>
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
          if (file) void run(() => moments.importFile(file))
          event.currentTarget.value = ''
        }}
      />
      {error ? <span className="moment-toolbar-error">{error}</span> : null}
    </section>
  )
}
