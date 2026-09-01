import { useLayoutEffect, useRef } from 'react'
import { DefaultActionsMenu, DefaultPageMenu, DefaultQuickActions, TldrawUiToolbar } from 'tldraw'
import { Hand } from 'lucide-react'
import { CanvasViewControls } from './CanvasViewControls'
import { isPanelReportEnabled } from './panelReportFeature'
import { SessionToolbar } from './SessionToolbar'

export interface AppChromeRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

interface AppChromeProps {
  isCanvasReady: boolean
  isPanMode: boolean
  canUseSelectedPanel: boolean
  onTogglePanMode(): void
  onFitAllPanels(): void
  onFitSelectedPanel(): void
  onResetSelectedPanel(): void
  onResetPanelLayout(): void
  onOpenArchitectureReport?(): void
  onMeasure(rect: AppChromeRect): void
}

export function AppChrome({
  isCanvasReady,
  isPanMode,
  canUseSelectedPanel,
  onTogglePanMode,
  onFitAllPanels,
  onFitSelectedPanel,
  onResetSelectedPanel,
  onResetPanelLayout,
  onOpenArchitectureReport,
  onMeasure,
}: AppChromeProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      element.closest<HTMLElement>('.app-root')?.style.setProperty('--app-chrome-height', `${rect.height}px`)
      onMeasure({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height })
    }
    measure()
    window.addEventListener('resize', measure)
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [onMeasure])

  return (
    <div ref={rootRef} className="app-chrome" onPointerDown={stopCanvasEvent} onMouseDown={stopCanvasEvent} onClick={stopCanvasEvent}>
      <SessionToolbar />

      <section className="app-chrome-canvas" aria-label="Canvas view controls">
        <button
          className="app-chrome-control app-chrome-pan-control"
          type="button"
          aria-label={isPanMode ? 'Exit pan mode' : 'Pan canvas'}
          aria-pressed={isPanMode}
          title={isPanMode ? 'Exit pan mode' : 'Pan canvas: drag to move the view'}
          onClick={onTogglePanMode}
        >
          <Hand size={16} aria-hidden="true" />
          <span className="canvas-control-label-long">{isPanMode ? 'Exit pan mode' : 'Pan canvas'}</span>
          <span className="canvas-control-label-short">{isPanMode ? 'Exit' : 'Pan'}</span>
        </button>
        <CanvasViewControls
          isReady={isCanvasReady}
          canUseSelectedPanel={canUseSelectedPanel}
          onFitPanels={onFitAllPanels}
          onFitSelectedPanel={onFitSelectedPanel}
          onResetSelectedPanel={onResetSelectedPanel}
          onResetPanelLayout={onResetPanelLayout}
        />
      </section>

      <div className="app-chrome-spacer" aria-hidden="true" />

      <nav className="app-chrome-tldraw" aria-label="Canvas history and page controls">
        <DefaultPageMenu />
        <TldrawUiToolbar className="app-chrome-tldraw-actions tlui-buttons__horizontal" label="Canvas actions">
          <DefaultQuickActions />
          <DefaultActionsMenu />
        </TldrawUiToolbar>
        {isPanelReportEnabled(import.meta.env.DEV, import.meta.env.VITE_ENABLE_PANEL_REPORT) && onOpenArchitectureReport ? (
          <button className="app-chrome-control architecture-report-launcher" type="button" onClick={onOpenArchitectureReport} title="Inspect panel architecture">
            Panel report
          </button>
        ) : null}
      </nav>
    </div>
  )
}

function stopCanvasEvent(event: React.SyntheticEvent) {
  ;(event as unknown as { isKilled?: boolean }).isKilled = true
  ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
  event.stopPropagation()
}
