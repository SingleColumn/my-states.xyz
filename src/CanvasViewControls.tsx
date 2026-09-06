import { EyeOff, Focus, FocusIcon, MoreHorizontal, PanelsTopLeft, PanelTop, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PanelType } from './types'

interface CanvasViewControlsProps {
  isReady: boolean
  onAddPanel(panelType: PanelType): void
  canUseSelectedPanel: boolean
  onFitPanels(): void
  onFitSelectedPanel(): void
  onResetSelectedPanel(): void
  onResetPanelLayout(): void
  canHideSelectedPanel: boolean
  hiddenPanels: Array<{ id: string; type: PanelType }>
  onHideSelectedPanel(): void
  onRestorePanel(panelId: string): void
}

export function CanvasViewControls({
  isReady,
  onAddPanel,
  canUseSelectedPanel,
  onFitPanels,
  onFitSelectedPanel,
  onResetSelectedPanel,
  onResetPanelLayout,
  canHideSelectedPanel,
  hiddenPanels,
  onHideSelectedPanel,
  onRestorePanel,
}: CanvasViewControlsProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [panelTypeToAdd, setPanelTypeToAdd] = useState<PanelType | ''>('')
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

  function handleAddPanel(event: React.ChangeEvent<HTMLSelectElement>) {
    const panelType = event.target.value as PanelType | ''
    setPanelTypeToAdd('')
    if (panelType) onAddPanel(panelType)
  }

  return (
    <div
      ref={rootRef}
      className="canvas-view-controls"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <select
        className="app-dropdown app-chrome-control app-chrome-panel-add-control"
        aria-label="Add panel"
        title="Choose a panel type to add"
        value={panelTypeToAdd}
        disabled={!isReady}
        onChange={handleAddPanel}
      >
        <option value="">Add panel</option>
        <option value="spotify">Music</option>
        <option value="slideshow">Images</option>
        <option value="notes">Notes</option>
      </select>
      <button
        className="app-chrome-control app-chrome-fit-control"
        type="button"
        aria-label="Fit all panels"
        title="Fit all panels into view"
        disabled={!isReady}
        onClick={onFitPanels}
      >
        <Focus size={16} aria-hidden="true" />
        <span className="canvas-control-label-long">Fit all</span>
        <span className="canvas-control-label-short">Fit</span>
      </button>
      <button
        ref={triggerRef}
        className="app-chrome-control app-chrome-menu-trigger"
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
            disabled={!canUseSelectedPanel}
            title={canUseSelectedPanel ? 'Fit the selected panel into the usable workspace' : 'Select exactly one panel to fit it'}
            onClick={() => runMenuAction(onFitSelectedPanel)}
          >
            <FocusIcon size={16} aria-hidden="true" />
            <span>Fit selected panel</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canUseSelectedPanel}
            title={canUseSelectedPanel ? 'Reset the selected panel to its default size' : 'Select exactly one panel to reset its size'}
            onClick={() => runMenuAction(onResetSelectedPanel)}
          >
            <PanelTop size={16} aria-hidden="true" />
            <span>Reset selected panel size</span>
          </button>
          <button type="button" role="menuitem" onClick={() => runMenuAction(onResetPanelLayout)}>
            <PanelsTopLeft size={16} aria-hidden="true" />
            <span>Reset panel layout</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canHideSelectedPanel}
            title={canHideSelectedPanel ? 'Hide the selected panel without deleting it' : 'Select exactly one panel to hide it'}
            onClick={() => runMenuAction(onHideSelectedPanel)}
          >
            <EyeOff size={16} aria-hidden="true" />
            <span>Hide selected panel</span>
          </button>
          {hiddenPanels.length ? (
            <div className="canvas-view-menu-section" role="group" aria-label="Hidden panels">
              <span className="canvas-view-menu-heading">Hidden panels</span>
              {hiddenPanels.map((panel, index) => (
                <button key={panel.id} type="button" role="menuitem" onClick={() => runMenuAction(() => onRestorePanel(panel.id))}>
                  <RotateCcw size={16} aria-hidden="true" />
                  <span>Restore {panelTypeLabel(panel.type)} {index + 1}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function panelTypeLabel(type: PanelType) {
  return type === 'spotify' ? 'Spotify' : type === 'slideshow' ? 'Images' : 'Notes'
}
