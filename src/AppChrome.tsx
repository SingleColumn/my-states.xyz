import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  DefaultActionsMenuContent, DefaultQuickActions, TldrawUiButtonIcon, TldrawUiMenuActionItem, TldrawUiMenuContextProvider,
  TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger, TldrawUiToolbar, TldrawUiToolbarButton,
  useCanRedo, useCanUndo, useEditor, usePassThroughWheelEvents, useReadonly, useValue,
} from 'tldraw'
import { AlignHorizontalDistributeCenter, Hand, Settings, Share2 } from 'lucide-react'
import { CanvasViewControls } from './CanvasViewControls'
import { BoardToolbar } from './BoardToolbar'
import { BoardShareDialog } from './BoardShareDialog'
import { useAppState } from './AppState'
import { BoardThemeSelect } from './BoardThemeSelect'
import type { PanelType } from './types'
import { SpikeModeSwitch } from './spike/SpikeModeSwitch'
import { getSpikeSnapshot, spikeState } from './spike/spikeFlag'

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
  onEnterMomentView(): void
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

/** The name beside the logo at the far left; selecting either opens the guide. */
export const HELP_ABOUT_LABEL = 'my-states.xyz'

// Panel actions live on the panel itself. Keeping only history controls here
// avoids a distant Delete or Duplicate button whose target is easy to miss.
function UndoRedoQuickActions() {
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()

  return (
    <>
      <TldrawUiMenuActionItem actionId="undo" disabled={!canUndo} />
      <TldrawUiMenuActionItem actionId="redo" disabled={!canRedo} />
    </>
  )
}

function ShareLauncher({ busy }: { busy: boolean }) {
  const { boards } = useAppState()
  const [open, setOpen] = useState(false)
  return <>
    <button className="board-share-launcher" type="button" aria-label="Share" title="Share this board"
      disabled={busy || !boards.activeBoard} onClick={() => setOpen(true)}>
      <Share2 size={16} aria-hidden="true" /><span>Share</span>
    </button>
    {open ? <BoardShareDialog onClose={() => setOpen(false)} /> : null}
  </>
}

/**
 * tldraw's arrange menu (align, distribute, stack, group…) with our own
 * trigger. tldraw's draws a vertical "⋮", which sat a few buttons away from
 * the board's "···" and read as a second, unexplained "more" menu. The
 * content and the read-only rule are tldraw's, copied from DefaultActionsMenu.
 */
function CanvasActionsMenu() {
  const editor = useEditor()
  const isReadonlyMode = useReadonly()
  const contentRef = useRef<HTMLDivElement | null>(null)
  usePassThroughWheelEvents(contentRef)
  const isInAcceptableReadonlyState = useValue('arrange menu in read-only', () => editor.isInAny('hand', 'zoom'), [editor])
  if (isReadonlyMode && !isInAcceptableReadonlyState) return null
  return (
    <span className="canvas-actions-menu">
      <TldrawUiPopover id="actions-menu">
        <TldrawUiPopoverTrigger>
          <TldrawUiToolbarButton type="icon" data-testid="actions-menu.button"
            aria-label="Canvas arrangement actions" title="Arrange selected panels">
            <TldrawUiButtonIcon icon={<AlignHorizontalDistributeCenter size={16} />} small />
          </TldrawUiToolbarButton>
        </TldrawUiPopoverTrigger>
        <TldrawUiPopoverContent side="bottom" sideOffset={6}>
          <TldrawUiToolbar ref={contentRef} label="Arrange selected panels" className="tlui-actions-menu tlui-buttons__grid" data-testid="actions-menu.content">
            <TldrawUiMenuContextProvider type="icons" sourceId="actions-menu">
              <DefaultActionsMenuContent />
            </TldrawUiMenuContextProvider>
          </TldrawUiToolbar>
        </TldrawUiPopoverContent>
      </TldrawUiPopover>
    </span>
  )
}

export function AppChrome({
  isCanvasReady,
  isPanMode,
  canUseSelectedPanel,
  onTogglePanMode,
  onEnterMomentView,
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
  const [boardBusy, setBoardBusy] = useState(false)
  // SPIKE: in Editor mode the canvas is hidden, so the controls that move or
  // arrange it would act on something nobody can see. They are left out
  // rather than greyed, because there is nothing for them to do there.
  const { editorMode } = useSyncExternalStore(spikeState.subscribe, getSpikeSnapshot)
  useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const root = element.closest<HTMLElement>('.app-root')
      root?.style.setProperty('--app-chrome-height', `${rect.height}px`)
      root?.style.setProperty('--app-board-text-left', `${boardTextLeft(element)}px`)
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
      <div className="app-chrome-identity">
        <button
          className="app-chrome-brand"
          type="button"
          aria-label={`${HELP_ABOUT_LABEL}: how it works`}
          title="How it works"
          onClick={onOpenHelpAbout}
        >
          <img className="app-chrome-brand-logo" src="/favicon.svg" alt="" width={26} height={26} />
          <span className="app-chrome-brand-name">{HELP_ABOUT_LABEL}</span>
        </button>
        <SpikeModeSwitch />
      </div>
      <div className="app-chrome-boards">
        <BoardToolbar
          onBusyChange={setBoardBusy}
          isCanvasReady={isCanvasReady}
          editorMode={editorMode}
          canUseSelectedPanel={canUseSelectedPanel}
          canHideSelectedPanel={canHideSelectedPanel}
          hiddenPanels={hiddenPanels}
          onFitAllPanels={onFitAllPanels}
          onFitSelectedPanel={onFitSelectedPanel}
          onResetSelectedPanel={onResetSelectedPanel}
          onResetPanelLayout={onResetPanelLayout}
          onHideSelectedPanel={onHideSelectedPanel}
          onRestorePanel={onRestorePanel}
          onEnterMomentView={onEnterMomentView}
        />
      </div>

      <section className="app-chrome-canvas" aria-label={editorMode ? 'Panel controls' : 'Canvas view controls'}>
        {editorMode ? null : <button
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
        </button>}
        <CanvasViewControls
          isReady={isCanvasReady}
          onAddPanel={onAddPanel}
          editorMode={editorMode}
        />
        <TldrawUiToolbar className="app-chrome-tldraw-actions tlui-buttons__horizontal" label="Canvas actions">
          <DefaultQuickActions><UndoRedoQuickActions /></DefaultQuickActions>
          {editorMode ? null : <CanvasActionsMenu />}
        </TldrawUiToolbar>
      </section>

      <div className="app-chrome-spacer" aria-hidden="true" />

      <nav className="app-chrome-tldraw" aria-label="Board and application controls">
        <ShareLauncher busy={boardBusy} />
        <BoardThemeSelect />
        <button
          className="app-chrome-control settings-launcher"
          type="button"
          aria-label="Settings"
          title={`Settings. Theme: ${activeThemeName}`}
          onClick={onOpenSettings}
        >
          <Settings size={16} aria-hidden="true" />
        </button>
        {/* Log in, and later the account menu, goes here when it exists. No
            space is held for it until then, so Settings sits at the right edge. */}
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
 * state, e.g. the open menus) on every render that touched any prop.
 */
export function AppChromeMenuPanel() {
  const props = useContext(AppChromePropsContext)
  if (!props) return null
  return <AppChrome {...props} />
}

/**
 * Where the open board's name is laid out, measured from the toolbar's own
 * left edge.
 *
 * A panel at full screen puts its title directly beneath this, and two
 * bands of text stacked on each other have to share a left column or the
 * seam reads as careless. That column cannot be written in the stylesheet:
 * it is the toolbar's inset plus the picker's border and padding, each of
 * which a theme may change. So the name itself is measured here and handed
 * over as a custom property. Measuring from the toolbar rather than the
 * window also makes it the same number before and after the toolbar goes
 * flush to the window edge.
 */
function boardTextLeft(chrome: HTMLElement) {
  const name = chrome.querySelector('.board-picker-name')
  if (!name) return 0
  return name.getBoundingClientRect().x - chrome.getBoundingClientRect().x
}

function stopCanvasEvent(event: React.SyntheticEvent) {
  ;(event as unknown as { isKilled?: boolean }).isKilled = true
  ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
  event.stopPropagation()
}
