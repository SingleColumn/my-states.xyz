import { EyeOff, Maximize2, RotateCcw, Minimize2 } from 'lucide-react'
import { createContext, useContext, type ReactNode, type SyntheticEvent } from 'react'
import type { PanelType } from './types'

export interface PanelCommands {
  hidePanel(panelId: string): void
  togglePanelFullScreen(panelId: string): void
  restorePanelDefaultSize(panelId: string): void
  isPanelFullScreen(panelId: string): boolean
}

const PanelCommandsContext = createContext<PanelCommands | null>(null)

export function PanelCommandsProvider({ commands, children }: { commands: PanelCommands; children: ReactNode }) {
  return <PanelCommandsContext.Provider value={commands}>{children}</PanelCommandsContext.Provider>
}

export function PanelHeader({ panelId, panelType, title, children }: { panelId: string; panelType: PanelType; title: string; children?: ReactNode }) {
  const commands = useContext(PanelCommandsContext)
  if (!commands) throw new Error('PanelHeader must be rendered inside PanelCommandsProvider')
  const fullScreen = commands.isPanelFullScreen(panelId)
  const stop = (event: SyntheticEvent) => {
    event.stopPropagation()
    ;(event as unknown as { isKilled?: boolean }).isKilled = true
    ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
  }
  return (
    <header className="card-header" data-panel-type={panelType}>
      <h2 className="card-title">{title}</h2>
      <div className="card-header-actions">
        {children}
        <button className="card-icon-button" type="button" title="Hide panel" aria-label="Hide panel" onPointerDown={stop} onClick={(event) => { stop(event); commands.hidePanel(panelId) }}><EyeOff size={18} /></button>
        <button className="card-icon-button" type="button" title={fullScreen ? 'Restore previous panel size' : 'Expand panel to full screen'} aria-label={fullScreen ? 'Restore previous panel size' : 'Expand panel to full screen'} onPointerDown={stop} onClick={(event) => { stop(event); commands.togglePanelFullScreen(panelId) }}>{fullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
        <button className="card-icon-button" type="button" title="Restore panel to default size" aria-label="Restore panel to default size" onPointerDown={stop} onClick={(event) => { stop(event); commands.restorePanelDefaultSize(panelId) }}><RotateCcw size={18} /></button>
      </div>
    </header>
  )
}
