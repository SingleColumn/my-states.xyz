import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DefaultActionsMenu, DefaultActionsMenuContent, DefaultQuickActions, TldrawUiToolbar } from 'tldraw'
import { Hand } from 'lucide-react'
import { CanvasViewControls } from './CanvasViewControls'
import { isPanelReportEnabled } from './panelReportFeature'
import { SessionToolbar } from './SessionToolbar'
import type { PanelType } from './types'

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
  onOpenHelpAbout(): void
  onMeasure(rect: AppChromeRect): void
  canHideSelectedPanel: boolean
  hiddenPanels: Array<{ id: string; type: PanelType }>
  onHideSelectedPanel(): void
  onRestorePanel(panelId: string): void
  onAddPanel(panelType: PanelType): void
}

export const HELP_ABOUT_LABEL = 'About'

// Draws first-time visitors' attention to the About button without blocking the canvas.
const ABOUT_PULSE_SEEN_KEY = 'mic:about-pulse-seen'
const ABOUT_PULSE_DURATION_MS = 20000

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
  onOpenHelpAbout,
  onMeasure,
  canHideSelectedPanel,
  hiddenPanels,
  onHideSelectedPanel,
  onRestorePanel,
  onAddPanel,
}: AppChromeProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [pulseAbout, setPulseAbout] = useState(false)
  // Read once at mount (a lazy initializer is safe under StrictMode's dev
  // double-invoke). Re-reading localStorage from inside the effect below
  // would break under that same double-invoke: the first invocation writes
  // the "seen" flag, so a second invocation reading it fresh would see its
  // own write and skip setting up the timer that turns the pulse back off.
  const [wasAlreadySeen] = useState(() => {
    try {
      return window.localStorage.getItem(ABOUT_PULSE_SEEN_KEY) === '1'
    } catch {
      return true
    }
  })

  useEffect(() => {
    if (wasAlreadySeen) return

    setPulseAbout(true)
    try {
      window.localStorage.setItem(ABOUT_PULSE_SEEN_KEY, '1')
    } catch {
      // Private browsing or storage disabled: pulse will simply reappear next visit.
    }
    const timeout = window.setTimeout(() => setPulseAbout(false), ABOUT_PULSE_DURATION_MS)
    return () => window.clearTimeout(timeout)
  }, [wasAlreadySeen])

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
          onAddPanel={onAddPanel}
          canUseSelectedPanel={canUseSelectedPanel}
          onFitPanels={onFitAllPanels}
          onFitSelectedPanel={onFitSelectedPanel}
          onResetSelectedPanel={onResetSelectedPanel}
          onResetPanelLayout={onResetPanelLayout}
          canHideSelectedPanel={canHideSelectedPanel}
          hiddenPanels={hiddenPanels}
          onHideSelectedPanel={onHideSelectedPanel}
          onRestorePanel={onRestorePanel}
        />
      </section>

      <div className="app-chrome-spacer" aria-hidden="true" />

      <nav className="app-chrome-tldraw" aria-label="Canvas and application controls">
        <TldrawUiToolbar className="app-chrome-tldraw-actions tlui-buttons__horizontal" label="Canvas actions">
          <DefaultQuickActions />
          <DefaultActionsMenu>
            <DefaultActionsMenuContent />
          </DefaultActionsMenu>
        </TldrawUiToolbar>
        {isPanelReportEnabled(import.meta.env.DEV, import.meta.env.VITE_ENABLE_PANEL_REPORT) && onOpenArchitectureReport ? (
          <button className="app-chrome-control architecture-report-launcher" type="button" onClick={onOpenArchitectureReport} title="Inspect panel architecture">
            Panel report
          </button>
        ) : null}
        <button
          className={`app-chrome-control about-launcher${pulseAbout ? ' about-launcher-pulse' : ''}`}
          type="button"
          onClick={() => {
            setPulseAbout(false)
            onOpenHelpAbout()
          }}
          title="About Music Images Canvas"
        >
          {HELP_ABOUT_LABEL}
        </button>
      </nav>
    </div>
  )
}

const AppChromePropsContext = createContext<AppChromeProps | null>(null)

export function AppChromePropsProvider({ value, children }: { value: AppChromeProps; children: ReactNode }) {
  return <AppChromePropsContext.Provider value={value}>{children}</AppChromePropsContext.Provider>
}

/**
 * A stable component reference for tldraw's `components.MenuPanel` slot. tldraw
 * unmounts and remounts that slot whenever the component reference changes, so
 * this reads AppChrome's props from context instead of closing over them
 * directly - closing over them would give a new function (and a lost AppChrome
 * state, e.g. the About-button pulse) on every render that touched any prop.
 */
export function AppChromeMenuPanel() {
  const props = useContext(AppChromePropsContext)
  if (!props) return null
  return <AppChrome {...props} />
}

function stopCanvasEvent(event: React.SyntheticEvent) {
  ;(event as unknown as { isKilled?: boolean }).isKilled = true
  ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
  event.stopPropagation()
}
