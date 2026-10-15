import { Check, Copy, Download, FilePlus2, FolderUp, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAppState } from './AppState'
import { useBoardThemeOptions } from './BoardThemeSelect'
import { peekBoardArchiveName } from './boardArchive'
import { nextDuplicateName } from './utils'

export function BoardToolbar() {
  const { boards } = useAppState()
  // The theme select itself sits beside the Settings button (BoardThemeSelect);
  // the compact toolbar repeats the choice in the … menu.
  const theme = useBoardThemeOptions()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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

  async function run(action: () => Promise<void | string | null>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await action()
      if (typeof result === 'string') setNotice(result)
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

  function createBoard() {
    const name = window.prompt('Name the new board', 'Untitled board')
    if (name !== null) void run(() => boards.create(name))
  }

  function renameBoard() {
    const name = window.prompt('Rename board', boards.activeBoard?.name ?? '')
    if (name !== null) void run(() => boards.rename(name))
  }

  function deleteBoard() {
    const current = boards.activeBoard
    if (!current) return
    if (window.confirm(`Delete "${current.name}"? This permanently removes this app's local copies of its images and notes. Original files and exported archives are unaffected.`)) {
      void run(() => boards.remove(current.id))
    }
  }

  /**
   * A board picked by name, not by identity -- two entries reading the same
   * is a real source of "which one is this?" confusion, so a colliding name
   * is resolved before the import happens, not cleaned up after. The
   * archive's name is read without importing it; a suggested free name is
   * offered but not forced, since a deliberate same-named duplicate (typing
   * the original name back) is still allowed. Duplicate board never hits
   * this prompt because it names its own copy something already known to be
   * free.
   */
  async function importFile(file: File) {
    const name = await peekBoardArchiveName(file)
    const collides = name !== null && boards.boards.some((existing) => existing.name === name)
    if (!collides) {
      void run(() => boards.importFile(file))
      return
    }
    const chosen = window.prompt(
      `A board named "${name}" already exists. Choose a name for the imported board (or leave it as "${name}" to import it anyway).`,
      nextDuplicateName(name, boards.boards.map((existing) => existing.name)),
    )
    if (chosen === null) return
    void run(() => boards.importFile(file, chosen))
  }

  function runMenuAction(action: () => void) {
    setIsMenuOpen(false)
    action()
  }

  function chooseTheme(themeId: string) {
    void run(() => theme.choose(themeId))
  }

  return (
    <section ref={rootRef} className="board-toolbar" aria-label="Board controls" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent}>
      <select
        className="app-dropdown"
        aria-label="Open board"
        value={boards.activeBoard?.id ?? ''}
        disabled={busy}
        onChange={(event) => void run(() => boards.open(event.target.value))}
      >
        {boards.boards.map((board) => (
          <option key={board.id} value={board.id}>{board.name}</option>
        ))}
      </select>
      <button
        className="card-icon-button"
        type="button"
        title="New board"
        aria-label="New board"
        disabled={busy}
        onClick={createBoard}
      >
        <FilePlus2 size={17} />
      </button>
      <button
        className="card-icon-button board-action-secondary"
        type="button"
        title="Rename board"
        aria-label="Rename board"
        disabled={busy || !boards.activeBoard}
        onClick={renameBoard}
      >
        <Pencil size={16} />
      </button>
      <button
        className="card-icon-button board-action-secondary"
        type="button"
        title="Duplicate board"
        aria-label="Duplicate board"
        disabled={busy || !boards.activeBoard}
        onClick={() => void run(boards.duplicate)}
      >
        <Copy size={16} />
      </button>
      <button className="card-icon-button board-action-secondary board-action-transfer" type="button" title="Export board" aria-label="Export board" disabled={busy || !boards.activeBoard} onClick={() => void run(boards.exportActive)}>
        <Download size={17} />
      </button>
      <button className="card-icon-button board-action-secondary" type="button" title="Import board" aria-label="Import board" disabled={busy} onClick={() => inputRef.current?.click()}>
        <FolderUp size={17} />
      </button>
      <button
        className="card-icon-button board-action-secondary board-action-delete"
        type="button"
        title="Delete board"
        aria-label="Delete board"
        disabled={busy || !boards.activeBoard}
        onClick={deleteBoard}
      >
        <Trash2 size={17} />
      </button>
      <button
        ref={menuTriggerRef}
        className="card-icon-button board-actions-menu-trigger"
        type="button"
        title="More board actions"
        aria-label="More board actions"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        disabled={busy}
        onClick={() => setIsMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={17} aria-hidden="true" />
      </button>
      {isMenuOpen ? (
        <div ref={menuRef} className="board-actions-menu" role="menu" aria-label="Board actions">
          <button type="button" role="menuitem" disabled={!boards.activeBoard} onClick={() => runMenuAction(renameBoard)}>
            <Pencil size={16} aria-hidden="true" /><span>Rename board</span>
          </button>
          <button type="button" role="menuitem" disabled={!boards.activeBoard} onClick={() => runMenuAction(() => void run(boards.duplicate))}>
            <Copy size={16} aria-hidden="true" /><span>Duplicate board</span>
          </button>
          <button type="button" role="menuitem" disabled={!boards.activeBoard} onClick={() => runMenuAction(() => void run(boards.exportActive))}>
            <Download size={17} aria-hidden="true" /><span>Export board</span>
          </button>
          <button type="button" role="menuitem" onClick={() => runMenuAction(() => inputRef.current?.click())}>
            <FolderUp size={17} aria-hidden="true" /><span>Import board</span>
          </button>
          <button className="is-destructive" type="button" role="menuitem" disabled={!boards.activeBoard} onClick={() => runMenuAction(deleteBoard)}>
            <Trash2 size={17} aria-hidden="true" /><span>Delete board</span>
          </button>
          <div className="canvas-view-menu-section" role="group" aria-label="Theme for this board">
            <span className="canvas-view-menu-heading">Theme</span>
            {theme.options.map((option) => (
              <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === theme.pinnedThemeId} disabled={!boards.activeBoard} onClick={() => runMenuAction(() => chooseTheme(option.id))}>
                {option.id === theme.pinnedThemeId ? <Check size={16} aria-hidden="true" /> : <span className="board-theme-menu-spacer" aria-hidden="true" />}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <input
        ref={inputRef}
        className="visually-hidden-file-input"
        type="file"
        accept=".zip,.board.zip,application/zip"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.currentTarget.value = ''
        }}
      />
      {error ? <span className="board-toolbar-error">{error}</span> : null}
      {notice ? <span className="board-toolbar-error board-toolbar-notice" role="status">{notice}</span> : null}
    </section>
  )
}
