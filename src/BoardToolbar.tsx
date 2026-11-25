import { Camera, Check, Copy, Download, EyeOff, FilePlus2, Focus, FocusIcon, FolderUp, MoreHorizontal, PanelsTopLeft, PanelTop, Pencil, RotateCcw, Share2, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppState } from './AppState'
import { useBoardThemeOptions } from './BoardThemeSelect'
import { peekBoardArchiveName } from './boardArchive'
import { BoardSaveStatus } from './BoardSaveStatus'
import { BoardShareDialog } from './BoardShareDialog'
import { importNameSuggestion } from './utils'
import { getPanelDefinition } from './panelRegistry'
import type { PanelType } from './types'

interface BoardToolbarProps {
  isCanvasReady: boolean
  editorMode: boolean
  canUseSelectedPanel: boolean
  canHideSelectedPanel: boolean
  hiddenPanels: Array<{ id: string; type: PanelType }>
  onFitAllPanels(): void
  onFitSelectedPanel(): void
  onResetSelectedPanel(): void
  onResetPanelLayout(): void
  onHideSelectedPanel(): void
  onRestorePanel(panelId: string): void
  onEnterMomentView(): void
}

export function BoardToolbar({ isCanvasReady, editorMode, canUseSelectedPanel, canHideSelectedPanel,
  hiddenPanels, onFitAllPanels, onFitSelectedPanel, onResetSelectedPanel, onResetPanelLayout,
  onHideSelectedPanel, onRestorePanel, onEnterMomentView }: BoardToolbarProps) {
  const { boards, panels, slideshow } = useAppState()
  // Only a board with an image collection has anything to choose between: an online one, or one
  // that came in with an imported board (stored pictures, every one credited to its creator).
  // The slideshow's own pictures are the ones loaded for it; a viewer's folder has no credit.
  const usesOnlineCollections = panels.all.some((panel) => {
    if (panel.type !== 'slideshow') return false
    const { imageSource } = panel.config
    if (imageSource.type === 'curated') return true
    if (imageSource.type !== 'session-assets') return false
    const images = slideshow.imagesFor(panel.id)
    return images.length > 0 && images.every((image) => image.attribution?.creator)
  })
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
  const [isShareOpen, setIsShareOpen] = useState(false)

  useEffect(() => {
    if (!isMenuOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('button[role^="menuitem"]:not(:disabled)')?.focus()

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsMenuOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setIsMenuOpen(false)
      menuTriggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMenuOpen])

  useLayoutEffect(() => {
    if (!isMenuOpen) return
    function placeMenu() {
      const menu = menuRef.current
      const trigger = menuTriggerRef.current
      if (!menu || !trigger) return
      menu.style.left = '0px'
      menu.style.right = 'auto'
      menu.style.maxHeight = ''
      const triggerRect = trigger.getBoundingClientRect()
      const width = menu.getBoundingClientRect().width
      const inset = 8
      const left = Math.max(inset, Math.min(triggerRect.left, window.innerWidth - width - inset))
      menu.style.left = `${left - triggerRect.left}px`
      menu.style.maxHeight = `${Math.max(80, window.innerHeight - menu.getBoundingClientRect().top - inset)}px`
    }
    placeMenu()
    window.addEventListener('resize', placeMenu)
    return () => window.removeEventListener('resize', placeMenu)
  }, [isMenuOpen, hiddenPanels.length, usesOnlineCollections])

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const key = event.key
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
    if (!(event.target instanceof HTMLButtonElement)) return
    const current = event.target
    const column = current.closest<HTMLElement>('[data-menu-column]')?.dataset.menuColumn
    if (!column) return
    const items = (name: string) => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(
      `[data-menu-column="${name}"] button[role^="menuitem"]:not(:disabled)` ) ?? [])
      .filter((button) => button.getClientRects().length > 0)
    const here = items(column)
    let next: HTMLButtonElement | undefined
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const index = here.indexOf(current)
      next = here[(index + (key === 'ArrowDown' ? 1 : -1) + here.length) % here.length]
    } else if (key === 'Home') next = here[0]
    else if (key === 'End') next = here.at(-1)
    else {
      const there = items(column === 'panels' ? 'board' : 'panels')
      const y = current.getBoundingClientRect().top + current.getBoundingClientRect().height / 2
      next = there.reduce<HTMLButtonElement | undefined>((nearest, candidate) => {
        const center = candidate.getBoundingClientRect().top + candidate.getBoundingClientRect().height / 2
        const best = nearest?.getBoundingClientRect()
        return !best || Math.abs(center - y) < Math.abs(best.top + best.height / 2 - y) ? candidate : nearest
      }, undefined)
    }
    if (next) { event.preventDefault(); next.focus() }
  }

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
      importNameSuggestion(name, file.name, boards.boards.map((existing) => existing.name)),
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
        className="board-share-launcher"
        type="button"
        title="Share this board"
        disabled={busy || !boards.activeBoard}
        onClick={() => setIsShareOpen(true)}
      >
        <Share2 size={16} aria-hidden="true" /><span>Share</span>
      </button>
      <span className="board-menu-anchor">
        <button
          ref={menuTriggerRef}
          className="card-icon-button board-actions-menu-trigger"
          type="button"
          title="Board and panel options"
          aria-label="Board and panel options"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          disabled={busy}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={17} aria-hidden="true" />
        </button>
        {isMenuOpen ? (
          <div ref={menuRef} className={`board-actions-menu${editorMode && !hiddenPanels.length ? ' is-board-only' : ''}`}
            role="menu" aria-label="Board and panel options" onKeyDown={handleMenuKeyDown}>
            {!editorMode || hiddenPanels.length ? <div className="board-actions-menu-column board-actions-menu-panels" data-menu-column="panels" role="group" aria-labelledby="toolbar-panels-heading">
              <div id="toolbar-panels-heading" className="card-header-menu-heading">Panels</div>
              {editorMode ? null : <>
                <div className="board-actions-menu-section" role="group" aria-labelledby="toolbar-all-panels-heading">
                  <div id="toolbar-all-panels-heading" className="card-header-menu-heading">All panels</div>
                  <button type="button" role="menuitem" disabled={!isCanvasReady} title="Fit all panels into view" onClick={() => runMenuAction(onFitAllPanels)}>
                    <span className="card-header-menu-icon"><Focus size={16} aria-hidden="true" /></span><span>Fit all panels</span>
                  </button>
                  <button type="button" role="menuitem" disabled={!isCanvasReady} onClick={() => runMenuAction(onResetPanelLayout)}>
                    <span className="card-header-menu-icon"><PanelsTopLeft size={16} aria-hidden="true" /></span><span>Reset panel layout</span>
                  </button>
                </div>
                <div className="board-actions-menu-section" role="group" aria-labelledby="toolbar-selected-panel-heading">
                  <div id="toolbar-selected-panel-heading" className="card-header-menu-heading">Selected panel{canUseSelectedPanel ? '' : ' · none selected'}</div>
                  <button type="button" role="menuitem" disabled={!isCanvasReady || !canUseSelectedPanel}
                    title={canUseSelectedPanel ? 'Fit the selected panel into the usable workspace' : 'Select exactly one panel to fit it'}
                    onClick={() => runMenuAction(onFitSelectedPanel)}>
                    <span className="card-header-menu-icon"><FocusIcon size={16} aria-hidden="true" /></span><span>Fit selected panel</span>
                  </button>
                  <button type="button" role="menuitem" disabled={!isCanvasReady || !canUseSelectedPanel}
                    title={canUseSelectedPanel ? 'Reset the selected panel to its default size' : 'Select exactly one panel to reset its size'}
                    onClick={() => runMenuAction(onResetSelectedPanel)}>
                    <span className="card-header-menu-icon"><PanelTop size={16} aria-hidden="true" /></span><span>Reset selected panel size</span>
                  </button>
                  <button type="button" role="menuitem" disabled={!isCanvasReady || !canHideSelectedPanel}
                    title={canHideSelectedPanel ? 'Hide the selected panel without deleting it' : 'Select exactly one panel to hide it'}
                    onClick={() => runMenuAction(onHideSelectedPanel)}>
                    <span className="card-header-menu-icon"><EyeOff size={16} aria-hidden="true" /></span><span>Hide selected panel</span>
                  </button>
                </div>
              </>}
              {hiddenPanels.length ? <div className="board-actions-menu-section" role="group" aria-labelledby="toolbar-hidden-panels-heading">
                <div id="toolbar-hidden-panels-heading" className="card-header-menu-heading">Hidden panels</div>
                {hiddenPanels.map((panel, index) => <button key={panel.id} type="button" role="menuitem"
                  onClick={() => runMenuAction(() => onRestorePanel(panel.id))}>
                  <span className="card-header-menu-icon"><RotateCcw size={16} aria-hidden="true" /></span>
                  <span>Restore {getPanelDefinition(panel.type).label} {index + 1}</span>
                </button>)}
              </div> : null}
            </div> : null}
            <div className="board-actions-menu-column board-actions-menu-board" data-menu-column="board" role="group" aria-labelledby="toolbar-board-heading">
              <div id="toolbar-board-heading" className="card-header-menu-heading">Board</div>
              <button type="button" role="menuitem" disabled={!boards.activeBoard} onClick={() => runMenuAction(renameBoard)}>
                <span className="card-header-menu-icon"><Pencil size={16} aria-hidden="true" /></span><span>Rename board</span>
              </button>
              <button type="button" role="menuitem" disabled={!boards.activeBoard} onClick={() => runMenuAction(() => void run(boards.duplicate))}>
                <span className="card-header-menu-icon"><Copy size={16} aria-hidden="true" /></span><span>Duplicate board</span>
              </button>
              <button type="button" role="menuitem" disabled={!boards.activeBoard} title={usesOnlineCollections ? 'Image panels keep the one picture they are showing now.' : undefined} onClick={() => runMenuAction(() => void run(() => boards.exportActive()))}>
                <span className="card-header-menu-icon"><Download size={17} aria-hidden="true" /></span><span>Export board</span>
              </button>
              {usesOnlineCollections ? <button type="button" role="menuitem" disabled={!boards.activeBoard}
                title="Includes every picture in the image collections this board uses, so slideshows keep playing after import. The file is larger."
                onClick={() => runMenuAction(() => void run(() => boards.exportActive({ wholeCollections: true })))}>
                <span className="card-header-menu-icon"><Download size={17} aria-hidden="true" /></span><span className="board-actions-menu-wrapped-label">Export with complete image collection</span>
              </button> : null}
              <button type="button" role="menuitem" onClick={() => runMenuAction(() => inputRef.current?.click())}>
                <span className="card-header-menu-icon"><FolderUp size={17} aria-hidden="true" /></span><span>Import board</span>
              </button>
              {!editorMode ? <button type="button" role="menuitem"
                title="Hide the toolbar and panel controls, leaving your image, writing and song ready for a screenshot"
                onClick={() => runMenuAction(onEnterMomentView)}>
                <span className="card-header-menu-icon"><Camera size={16} aria-hidden="true" /></span><span>Prepare board for screenshot</span>
              </button> : null}
              {/* On a wide window the theme has its own selector in the toolbar; this copy is for narrow ones. */}
              <div className="board-actions-menu-section board-actions-menu-theme" role="group" aria-label="Theme for this board">
                <div className="card-header-menu-heading">Theme</div>
                {theme.options.map((option) => <button key={option.id} type="button" role="menuitemradio"
                  aria-checked={option.id === theme.pinnedThemeId} disabled={!boards.activeBoard}
                  onClick={() => runMenuAction(() => chooseTheme(option.id))}>
                  <span className="card-header-menu-icon">{option.id === theme.pinnedThemeId ? <Check size={16} aria-hidden="true" /> : null}</span>
                  <span>{option.label}</span>
                </button>)}
              </div>
              <div className="board-actions-menu-divider" role="separator" />
              <button className="is-destructive" type="button" role="menuitem" disabled={!boards.activeBoard} onClick={() => runMenuAction(deleteBoard)}>
                <span className="card-header-menu-icon"><Trash2 size={17} aria-hidden="true" /></span><span>Delete board</span>
              </button>
            </div>
          </div>
        ) : null}
      </span>
      <BoardSaveStatus />
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
      {isShareOpen ? <BoardShareDialog onClose={() => setIsShareOpen(false)} /> : null}
    </section>
  )
}
