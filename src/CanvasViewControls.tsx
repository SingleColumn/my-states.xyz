import { Focus, MoreHorizontal, PanelsTopLeft, PanelTop } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface CanvasViewControlsProps {
  isReady: boolean
  canResetSelectedPanel: boolean
  onFitPanels(): void
  onResetSelectedPanel(): void
  onResetPanelLayout(): void
}

export function CanvasViewControls({
  isReady,
  canResetSelectedPanel,
  onFitPanels,
  onResetSelectedPanel,
  onResetPanelLayout,
}: CanvasViewControlsProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isMenuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsMenuOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setIsMenuOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMenuOpen])

  function runMenuAction(action: () => void) {
    setIsMenuOpen(false)
    action()
  }

  return (
    <div
      ref={rootRef}
      className="canvas-view-controls"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className="app-badge-control"
        type="button"
        title="Fit all panels into view"
        disabled={!isReady}
        onClick={onFitPanels}
      >
        <Focus size={16} aria-hidden="true" />
        <span>Fit panels</span>
      </button>
      <button
        ref={triggerRef}
        className="app-badge-control app-badge-menu-trigger"
        type="button"
        title="Panel view and layout actions"
        aria-label="Open panel view and layout actions"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        disabled={!isReady}
        onClick={() => setIsMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {isMenuOpen ? (
        <div className="canvas-view-menu" role="menu" aria-label="Panel view and layout actions">
          <button
            type="button"
            role="menuitem"
            disabled={!canResetSelectedPanel}
            title={canResetSelectedPanel ? 'Reset the selected panel to its default size' : 'Select exactly one panel to reset its size'}
            onClick={() => runMenuAction(onResetSelectedPanel)}
          >
            <PanelTop size={16} aria-hidden="true" />
            <span>Reset selected panel size</span>
          </button>
          <button type="button" role="menuitem" onClick={() => runMenuAction(onResetPanelLayout)}>
            <PanelsTopLeft size={16} aria-hidden="true" />
            <span>Reset panel layout</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
