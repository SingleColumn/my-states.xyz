import { Check, EyeOff, Maximize2, MoreHorizontal, RotateCcw, Minimize2 } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PanelType } from './types'
import { panelContentProps } from './panelSurface'

export interface PanelCommands {
  hidePanel(panelId: string): void
  togglePanelFullScreen(panelId: string): void
  restorePanelDefaultSize(panelId: string): void
  isPanelFullScreen(panelId: string): boolean
  /** Shrink a panel to its focus view, or give it back its previous size. */
  togglePanelFocusView(panelId: string): void
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

export function PanelHeader({ panelId, panelType, title, menuItems, trailingMenuItems, menuDefaultOpen, children }: {
  panelId: string
  panelType: PanelType
  title: string
  /** The panel's own actions: what it does with its content. */
  menuItems?: PanelMenuItem[]
  /** Kept as the last block of the menu — e.g. Music's Log out. */
  trailingMenuItems?: PanelMenuItem[]
  /** Anything the header shows beside the menu: popovers, a hidden file input, an inline picker. */
  children?: ReactNode
  /** Start with the menu open: for static renders, which cannot click it open. */
  menuDefaultOpen?: boolean
}) {
  const commands = usePanelCommands()
  const fullScreen = commands.isPanelFullScreen(panelId)

  const panelItems: PanelMenuItem[] = [
    { id: 'hide', label: 'Hide panel', icon: <EyeOff size={17} aria-hidden="true" />, onSelect: () => commands.hidePanel(panelId) },
    {
      id: 'full-screen',
      label: fullScreen ? 'Restore previous panel size' : 'Expand panel to full screen',
      icon: fullScreen ? <Minimize2 size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />,
      onSelect: () => commands.togglePanelFullScreen(panelId),
    },
    { id: 'default-size', label: 'Restore panel to default size', icon: <RotateCcw size={17} aria-hidden="true" />, onSelect: () => commands.restorePanelDefaultSize(panelId) },
  ]

  // Sections are drawn with a rule between them, grouped by what they act on:
  // the content, the panel, then whatever the panel wants kept last.
  const sections = [menuItems ?? [], panelItems, trailingMenuItems ?? []].filter((section) => section.length > 0)

  return (
    <header className="card-header" data-panel-type={panelType}>
      <h2 className="card-title">{title}</h2>
      {/* The title is frame: pressing it drags the panel. The actions are one
          content region, so the menu and everything a panel puts beside it is
          operable without any handler of its own. */}
      <div className="card-header-actions" {...panelContentProps}>
        {children}
        <PanelMenu label={`${title} panel actions`} sections={sections} defaultOpen={menuDefaultOpen} />
      </div>
    </header>
  )
}

function PanelMenu({ label, sections, defaultOpen = false }: { label: string; sections: PanelMenuItem[][]; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // Same closing rules as the moment toolbar's menu: a press anywhere else,
  // or Escape. The document listener sees presses on the canvas too, because
  // the panel shell marks its pointer events handled rather than stopping them.
  useEffect(() => {
    if (!isOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

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
      {isOpen ? (
        <div ref={menuRef} className="card-header-menu" role="menu" aria-label={label}>
          {sections.map((section, index) => (
            <div key={index} className="card-header-menu-section" role="group">
              {section.map((item) => (
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
        </div>
      ) : null}
    </div>
  )
}
