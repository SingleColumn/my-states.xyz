import { useState } from 'react'
import type { PanelType } from './types'
import { PANEL_TYPES, getPanelDefinition } from './panelRegistry'
import { useAppState } from './AppState'

interface CanvasViewControlsProps {
  isReady: boolean
  onAddPanel(panelType: PanelType): void
  editorMode?: boolean
}

export function CanvasViewControls({ isReady, onAddPanel, editorMode = false }: CanvasViewControlsProps) {
  const { panels } = useAppState()
  // Editor mode draws one Writing panel as the page, so a second one is only
  // offered when the existing Writing panel is hidden.
  const writingIsThePage = editorMode && panels.all.some((panel) => panel.type === 'notes' && panel.visible)
  const [panelTypeToAdd, setPanelTypeToAdd] = useState<PanelType | ''>('')

  function handleAddPanel(event: React.ChangeEvent<HTMLSelectElement>) {
    const panelType = event.target.value as PanelType | ''
    setPanelTypeToAdd('')
    // Video panels remain supported for saved boards, but are temporarily
    // unavailable as a new-panel choice in the user interface.
    if (panelType && panelType !== 'video') onAddPanel(panelType)
  }

  return (
    <div className="canvas-view-controls" onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      <select className="app-dropdown app-chrome-control app-chrome-panel-add-control"
        aria-label="Add panel" title="Choose a panel type to add" value={panelTypeToAdd}
        disabled={!isReady} onChange={handleAddPanel}>
        <option value="">Add panel</option>
        {PANEL_TYPES.filter((type) => type !== 'video' && !(type === 'notes' && writingIsThePage)).map((type) => (
          <option value={type} key={type}>{getPanelDefinition(type).label}</option>
        ))}
      </select>
    </div>
  )
}
