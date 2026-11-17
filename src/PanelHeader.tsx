import { Check, EyeOff, Maximize2, MoreHorizontal, RotateCcw, Minimize2, Trash2 } from 'lucide-react'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PanelType } from './types'
import { panelContentProps } from './panelSurface'

export interface PanelCommands {
  hidePanel(panelId: string): void
  deletePanel(panelId: string): void
  togglePanelFullScreen(panelId: string): void
  restorePanelDefaultSize(panelId: string): void
  isPanelFullScreen(panelId: string): boolean
  /** Shrink a panel to its focus view, or give it back its previous size. */
  togglePanelFocusView(panelId: string): void
  /** Grow a panel that is still at its short starting height to its default height. */
  expandPanelFromStartingHeight(panelId: string): void
  /**
   * SPIKE: Editor mode's own panel actions for a window (minimise, hide,
   * delete). When it returns a list, it replaces the canvas ones and the
   * panel's focus-view item, which act on a canvas shape nobody can see.
   */
  windowMenuItems?(panelId: string): PanelMenuItem[] | undefined
  /**
   * SPIKE: where Editor mode draws header menus. Each panel frame clips and
   * layers its own content, so a menu drawn inside one is cut off by a short
   * window and hidden under the windows when it is the page's. Drawn here,
   * above everything, it is neither.
   */
  menuLayer?: HTMLElement | null
}

const PanelCommandsContext = createContext<PanelCommands | null>(null)

export function PanelCommandsProvider({ commands, children }: { commands: PanelCommands; children: ReactNode }) {
  return <PanelCommandsContext.Provider value={commands}>{children}</PanelCommandsContext.Provider>
}

export function usePanelCommands(): PanelCommands {
  const commands = useContext(PanelCommandsContext)
  if (!commands) throw new Error('Panel commands are only available inside PanelCommandsProvider')
  return commands
}

/**
 * One entry in a panel's header menu. A panel describes what it can do as
 * data and the header draws it, so every panel's menu reads the same way and
 * a new action is one object, not a styled button.
 */
export interface PanelMenuItem {
  id: string
  label: string
  icon?: ReactNode
  onSelect(): void
  disabled?: boolean
  /** A toggle: drawn with a check mark when on. */
  checked?: boolean
  destructive?: boolean
}

/**
 * One setting with a few values, drawn as a single line of buttons -- the
 * text size, the paper width -- rather than one menu line per value. Picking
 * a value leaves the menu open, so the values can be tried one after another
 * and compared, which is what a setting like this is chosen by.
 */
export interface PanelMenuChoices {
  id: string
  kind: 'choices'
  label: string
  icon?: ReactNode
  options: PanelMenuChoice[]
  /**
   * Close the menu once a value is picked. For a choice that changes what
   * the panel shows (grid or carousel), where the menu would only be in
   * the way; a look like the text size leaves it open to compare.
   */
  closeOnSelect?: boolean
}

export interface PanelMenuChoice {
  id: string
  /** What the button shows; may be short, or a picture of the value. */
  content: ReactNode
  /** Its full name, for the tooltip and for anyone not seeing the button. */
  label: string
  checked: boolean
  onSelect(): void
}

export type PanelMenuEntry = PanelMenuItem | PanelMenuChoices

/** A group of a panel's own actions, under an optional heading. */
export interface PanelMenuSection {
  heading?: string
  items: PanelMenuEntry[]
}

function isChoices(entry: PanelMenuEntry): entry is PanelMenuChoices {
  return 'kind' in entry && entry.kind === 'choices'
}

export function PanelHeader({ panelId, panelType, title, menuItems, menuSections, trailingMenuItems, trailingMenuHeading, menuDefaultOpen, children }: {
  panelId: string
  panelType: PanelType
  title: string
  /** The panel's own actions: what it does with its content. */
  menuItems?: PanelMenuItem[]
  /**
   * SPIKE: the panel's own actions in headed groups, in place of
   * `menuItems`. The panel's window actions follow as a group headed
   * "Panel", so the whole menu reads as headed groups.
   */
  menuSections?: PanelMenuSection[]
  /** Kept as the last block of the menu — e.g. Music's Log out. */
  trailingMenuItems?: PanelMenuItem[]
  /** SPIKE: the heading over `trailingMenuItems` in a headed menu. */
  trailingMenuHeading?: string
  /** Anything the header shows beside the menu: popovers, a hidden file input, an inline picker. */
  children?: ReactNode
  /** Start with the menu open: for static renders, which cannot click it open. */
  menuDefaultOpen?: boolean
}) {
  const commands = usePanelCommands()
  const fullScreen = commands.isPanelFullScreen(panelId)

  const windowItems = commands.windowMenuItems?.(panelId)
  const withoutFocusView = (items: PanelMenuEntry[]) => windowItems ? items.filter((item) => item.id !== 'focus-view') : items
  const headed = menuSections !== undefined
  // SPIKE: in a headed menu the focus view is a size of the panel, like full
  // screen, so it is drawn in the Panel group, right after Hide panel,
  // whichever group the panel listed it in.
  const focusViewItem = headed && !windowItems
    ? menuSections.flatMap((section) => section.items).find((item): item is PanelMenuItem => item.id === 'focus-view' && !isChoices(item))
    : undefined
  const panelItems: PanelMenuItem[] = windowItems ?? [
    { id: 'hide', label: 'Hide panel', icon: <EyeOff size={17} aria-hidden="true" />, onSelect: () => commands.hidePanel(panelId) },
    ...(focusViewItem ? [focusViewItem] : []),
    {
      id: 'full-screen',
      label: fullScreen ? 'Restore previous panel size' : 'Expand panel to full screen',
      icon: fullScreen ? <Minimize2 size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />,
      onSelect: () => commands.togglePanelFullScreen(panelId),
    },
    { id: 'default-size', label: 'Restore panel to default size', icon: <RotateCcw size={17} aria-hidden="true" />, onSelect: () => commands.restorePanelDefaultSize(panelId) },
    { id: 'delete', label: 'Delete panel', icon: <Trash2 size={17} aria-hidden="true" />, destructive: true, onSelect: () => commands.deletePanel(panelId) },
  ]

  // Sections are drawn with a rule between them, grouped by what they act on:
  // the content, the panel, then whatever the panel wants kept last.
  const sections: PanelMenuSection[] = [
    ...(menuSections ?? [{ items: menuItems ?? [] }]).map((section) => ({ ...section, items: headed ? section.items.filter((item) => item.id !== 'focus-view') : withoutFocusView(section.items) })),
    { heading: headed ? 'Panel' : undefined, items: panelItems },
    { heading: headed ? trailingMenuHeading : undefined, items: trailingMenuItems ?? [] },
  ].filter((section) => section.items.length > 0)

  return (
    <header className="card-header" data-panel-type={panelType}>
      <h2 className="card-title">{title}</h2>
      {/* The title is frame: pressing it drags the panel. The actions are one
          content region, so the menu and everything a panel puts beside it is
          operable without any handler of its own. */}
      <div className="card-header-actions" {...panelContentProps}>
        {children}
        <PanelMenu label={`${title} panel actions`} sections={sections} defaultOpen={menuDefaultOpen} layer={commands.menuLayer ?? null} />
      </div>
    </header>
  )
}

/** How far a canvas-zoomed menu may shrink or grow from its own size. */
const MENU_ZOOM_MIN = 0.7
const MENU_ZOOM_MAX = 1.25

function PanelMenu({ label, sections, defaultOpen = false, layer }: { label: string; sections: PanelMenuSection[]; defaultOpen?: boolean; layer: HTMLElement | null }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [layerPosition, setLayerPosition] = useState<CSSProperties | null>(null)

  // SPIKE: in a menu layer the list has no header to hang from, so it is
  // placed against the ⋯ button: below it, or above it when there is no room
  // below, or as low as fits when there is room for neither. Runs before
  // paint, so the list never shows in the wrong place.
  useLayoutEffect(() => {
    if (!isOpen || !layer || !triggerRef.current || !menuRef.current) {
      setLayerPosition(null)
      return
    }
    const trigger = triggerRef.current.getBoundingClientRect()
    const bounds = layer.getBoundingClientRect()
    // The menu follows the canvas zoom, so its text keeps pace with the
    // panel's, but only within a readable range: at 30% the panel's own text
    // is tiny and a menu that small could not be read. The zoom is the ⋯
    // button's drawn width over its own: 1 anywhere that is not scaled
    // (Editor mode), so there the menu stays its own size.
    const drawn = trigger.width / (triggerRef.current.offsetWidth || trigger.width)
    const scale = Math.min(MENU_ZOOM_MAX, Math.max(MENU_ZOOM_MIN, drawn))
    const height = menuRef.current.offsetHeight * scale
    const gap = parseFloat(getComputedStyle(layer).getPropertyValue('--space-popover-offset')) || 8
    const margin = 8
    let top = trigger.bottom + gap - bounds.top
    if (top + height > bounds.height - margin) {
      const above = trigger.top - gap - height - bounds.top
      top = above >= margin ? above : Math.max(margin, bounds.height - margin - height)
    }
    // Scaled from its top-right corner, which is the corner placed against the button.
    setLayerPosition({ top, right: bounds.right - trigger.right, zIndex: 1000, pointerEvents: 'auto', transform: `scale(${scale})`, transformOrigin: 'top right' })
  }, [isOpen, layer])

  // Same closing rules as the board toolbar's menu: a press anywhere else,
  // or Escape. The document listener sees presses on the canvas too, because
  // the panel shell marks its pointer events handled rather than stopping them.
  useEffect(() => {
    if (!isOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()

    function handlePointerDown(event: PointerEvent) {
      // The list may be drawn elsewhere (a menu layer), so it counts too.
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setIsOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      triggerRef.current?.focus()
    }

    // SPIKE: a menu drawn on a layer is placed once, against the ⋯ button,
    // and does not follow the panel. Scrolling or zooming the canvas moves the
    // panel out from under it, so either one closes it, as does a resize.
    function handleMove(event: Event) {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    if (layer) {
      document.addEventListener('wheel', handleMove, { capture: true, passive: true })
      window.addEventListener('resize', handleMove)
    }
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('wheel', handleMove, { capture: true })
      window.removeEventListener('resize', handleMove)
    }
  }, [isOpen, layer])

  function choose(item: PanelMenuItem) {
    setIsOpen(false)
    item.onSelect()
  }

  return (
    <div ref={rootRef} className="card-header-menu-root">
      <button
        ref={triggerRef}
        className={`card-icon-button${isOpen ? ' is-active' : ''}`}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {isOpen ? withLayer(
        <div
          ref={menuRef}
          className="card-header-menu"
          role="menu"
          aria-label={label}
          // Hidden for the one measuring pass before it is placed.
          style={layer ? (layerPosition ?? { visibility: 'hidden' }) : undefined}
          {...(layer ? panelContentProps : {})}
        >
          {sections.map((section, index) => (
            <div key={index} className="card-header-menu-section" role="group" aria-label={section.heading}>
              {section.heading ? <div className="card-header-menu-heading" aria-hidden="true">{section.heading}</div> : null}
              {section.items.map((item) => isChoices(item) ? (
                <div key={item.id} className="card-header-menu-choices" role="group" aria-label={item.label}>
                  <span className="card-header-menu-choices-name" aria-hidden="true">
                    <span className="card-header-menu-icon">{item.icon}</span>
                    <span className="card-header-menu-label">{item.label}</span>
                  </span>
                  <span className="card-header-menu-options">
                    {item.options.map((option) => (
                      <button
                        key={option.id}
                        className={option.checked ? 'is-checked' : undefined}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.checked}
                        aria-label={option.label}
                        title={option.label}
                        onClick={() => {
                          if (item.closeOnSelect) setIsOpen(false)
                          option.onSelect()
                        }}
                      >
                        {option.content}
                      </button>
                    ))}
                  </span>
                </div>
              ) : (
                <button
                  key={item.id}
                  className={item.destructive ? 'is-destructive' : undefined}
                  type="button"
                  role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  onClick={() => choose(item)}
                >
                  <span className="card-header-menu-icon" aria-hidden="true">{item.icon}</span>
                  <span className="card-header-menu-label">{item.label}</span>
                  {item.checked ? <Check size={16} aria-hidden="true" className="card-header-menu-check" /> : null}
                </button>
              ))}
            </div>
          ))}
        </div>,
      ) : null}
    </div>
  )

  function withLayer(menu: ReactNode) {
    return layer ? createPortal(menu, layer) : menu
  }
}
