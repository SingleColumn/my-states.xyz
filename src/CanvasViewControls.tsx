import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import type { PanelType } from './types'
import { PANEL_TYPES, getPanelDefinition } from './panelRegistry'
import { useAppState } from './AppState'

interface CanvasViewControlsProps {
  isReady: boolean
  onAddPanel(panelType: PanelType): void
  editorMode?: boolean
}

/**
 * "Add panel" as a labelled button with its own menu. A native <select> drew
 * its list in the operating system's colours, which clashed with every other
 * menu in the toolbar, and its "+" was a CSS overlay with no words beside it.
 */
export function CanvasViewControls({ isReady, onAddPanel, editorMode = false }: CanvasViewControlsProps) {
  const { panels } = useAppState()
  // Editor mode draws one Writing panel as the page, so a second one is only
  // offered when the existing Writing panel is hidden.
  const writingIsThePage = editorMode && panels.all.some((panel) => panel.type === 'notes' && panel.visible)
  // Video panels remain supported for saved boards, but are temporarily
  // unavailable as a new-panel choice in the user interface.
  const choices = PANEL_TYPES.filter((type) => type !== 'video' && !(type === 'notes' && writingIsThePage))
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(current + step + items.length) % items.length].focus()
  }

  function choose(type: PanelType) {
    setIsOpen(false)
    onAddPanel(type)
  }

  return (
    <div ref={rootRef} className="canvas-view-controls" onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      <button ref={triggerRef} type="button" className="app-chrome-control app-chrome-panel-add-control"
        aria-label="Add panel" title="Add a panel to this board" aria-haspopup="menu" aria-expanded={isOpen}
        disabled={!isReady} onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setIsOpen(true) } }}>
        <Plus size={16} aria-hidden="true" />
        <span className="app-chrome-panel-add-label">Add panel</span>
        <ChevronDown className="app-chrome-panel-add-chevron" size={14} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div ref={menuRef} className="add-panel-menu" role="menu" aria-label="Add panel" onKeyDown={moveFocus}>
          {choices.map((type) => {
            const definition = getPanelDefinition(type)
            // A singleton already on the board would be refused, so say so here instead.
            const alreadyHere = definition.singleton && panels.all.some((panel) => panel.type === type)
            return (
              <button key={type} type="button" role="menuitem" disabled={alreadyHere}
                title={alreadyHere ? `This board already has a ${definition.label} panel` : undefined}
                onClick={() => choose(type)}>
                {definition.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
