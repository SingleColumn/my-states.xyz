import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DefaultActionsMenu, DefaultActionsMenuContent, DefaultQuickActions, TldrawUiToolbar } from 'tldraw'
import { Hand, Settings } from 'lucide-react'
import { CanvasViewControls } from './CanvasViewControls'
import { MomentToolbar } from './MomentToolbar'
import { MomentThemeSelect } from './MomentThemeSelect'
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
  onOpenHelpAbout(): void
  onOpenSettings(): void
  /** Named on the Settings button so the theme in use can be read from the chrome. */
  activeThemeName: string
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
  onOpenHelpAbout,
  onOpenSettings,
  activeThemeName,
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
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const root = element.closest<HTMLElement>('.app-root')
      root?.style.setProperty('--app-chrome-height', `${rect.height}px`)
      root?.style.setProperty('--app-moment-text-left', `${momentTextLeft(element)}px`)
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
      <MomentToolbar />

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
        <button
          className="app-chrome-control settings-launcher"
          type="button"
          aria-label="Settings"
          title={`Settings. Theme: ${activeThemeName}`}
          onClick={onOpenSettings}
        >
          <Settings size={16} aria-hidden="true" />
        </button>
        <MomentThemeSelect />
        <button
          className={`app-chrome-control about-launcher${pulseAbout ? ' about-launcher-pulse' : ''}`}
          type="button"
          onClick={() => {
            setPulseAbout(false)
            onOpenHelpAbout()
          }}
          title="About my-states.xyz"
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

/**
 * What a browser lays out before a select's text, on top of whatever
 * padding the stylesheet gives it. The inset is the browser's, not ours, so
 * it is a measured constant rather than a derived one: 4px in Chromium, and
 * being a pixel out elsewhere costs a pixel of alignment and nothing more.
 */
const SELECT_TEXT_INSET = 4

/**
 * Where the open moment's name is laid out, measured from the toolbar's own
 * left edge.
 *
 * A panel at full screen puts its title directly beneath this, and two
 * bands of text stacked on each other have to share a left column or the
 * seam reads as careless. That column cannot be written in the stylesheet:
 * it is the toolbar's inset plus the dropdown's border and padding, each of
 * which a theme may change, plus what the browser adds inside the control.
 * So it is measured here and handed over as a custom property. Measuring
 * from the toolbar rather than the window also makes it the same number
 * before and after the toolbar goes flush to the window edge.
 */
function momentTextLeft(chrome: HTMLElement) {
  const select = chrome.querySelector('.moment-toolbar select')
  if (!select) return 0
  const style = getComputedStyle(select)
  const inset = select.getBoundingClientRect().x - chrome.getBoundingClientRect().x
  return inset + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) + SELECT_TEXT_INSET
}

function stopCanvasEvent(event: React.SyntheticEvent) {
  ;(event as unknown as { isKilled?: boolean }).isKilled = true
  ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
  event.stopPropagation()
}
