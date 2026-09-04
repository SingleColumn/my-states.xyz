import { useCallback, useEffect } from 'react'
import { ContextMenu as RadixContextMenu } from 'radix-ui'
import {
  ArrangeMenuSubmenu,
  ClipboardMenuGroup,
  ReorderMenuSubmenu,
  SelectAllMenuItem,
  TldrawUiMenuActionItem,
  TldrawUiMenuContextProvider,
  TldrawUiMenuGroup,
  preventDefault,
  useContainer,
  useEditor,
  useEditorComponents,
  useMenuIsOpen,
  useTranslation,
  useValue,
  type TLUiContextMenuProps,
} from 'tldraw'
import { PANEL_SHAPE_TYPE } from './panelShapeTypes'

/**
 * Stands in for tldraw's built-in context menu, with one difference: Radix's
 * open/closed state is *controlled* by tldraw's menu state rather than tracked
 * separately alongside it.
 *
 * Why: tldraw closes its own menus on any canvas pointer-down (both
 * `Editor.dispatch` and `MenuClickCapture` call `clearOpenMenus`), which
 * unmounts the menu. Radix would normally notice that outside click through a
 * bubble-phase `pointerdown` listener on `document` -- but tldraw's container
 * calls `stopPropagation` on pointer-down, and because React delegates events
 * from its root the native event stops there and never reaches `document`. So
 * Radix never hears about the click. With tldraw's default (uncontrolled) menu
 * the two states then drift apart: tldraw believes the menu is closed while
 * Radix still believes it is open, and every later right-click asks Radix to
 * open a menu it thinks is already open -- a no-op, so nothing ever reappears.
 *
 * Passing `open` makes tldraw's menu state the single source of truth, so the
 * two cannot disagree.
 */
export function CanvasContextMenu({ children, disabled = false }: TLUiContextMenuProps) {
  const editor = useEditor()
  const container = useContainer()
  const msg = useTranslation()
  const { Canvas } = useEditorComponents()
  const [isOpen, handleOpenChange] = useMenuIsOpen('context menu')

  // While the menu is open, keep Escape from also reaching the canvas, where it
  // would clear the very selection the menu is acting on.
  useEffect(() => {
    if (!isOpen) return
    const keepShapeFocusOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      editor.getContainer().focus()
    }
    const options = { capture: true } as const
    document.body.addEventListener('keydown', keepShapeFocusOnEscape, options)
    return () => document.body.removeEventListener('keydown', keepShapeFocusOnEscape, options)
  }, [editor, isOpen])

  // When a menu closes, Radix waits a tick and then puts focus back where it
  // was. By the time that runs the user may have already opened the *next*
  // menu -- and pulling focus out of it closes it again, which looks exactly
  // like a right-click that did nothing. Restore focus ourselves instead, and
  // only when nothing else has claimed it in the meantime.
  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault()
      if (document.activeElement === document.body) editor.getContainer().focus()
    },
    [editor],
  )

  return (
    <RadixContextMenu.Root dir="ltr" open={isOpen} onOpenChange={handleOpenChange} modal={false}>
      <RadixContextMenu.Trigger onContextMenu={undefined} dir="ltr" disabled={disabled}>
        {Canvas ? <Canvas /> : null}
      </RadixContextMenu.Trigger>
      {isOpen ? (
        <RadixContextMenu.Portal container={container}>
          <RadixContextMenu.Content
            className="tlui-menu tlui-scrollable"
            data-testid="context-menu"
            aria-label={msg('context-menu.title')}
            alignOffset={-4}
            collisionPadding={4}
            onContextMenu={preventDefault}
            onCloseAutoFocus={handleCloseAutoFocus}
          >
            <TldrawUiMenuContextProvider type="context-menu" sourceId="context-menu">
              {children ?? <CanvasContextMenuContent />}
            </TldrawUiMenuContextProvider>
          </RadixContextMenu.Content>
        </RadixContextMenu.Portal>
      ) : null}
    </RadixContextMenu.Root>
  )
}

function HidePanelMenuItem() {
  const editor = useEditor()
  const isOnePanelSelected = useValue(
    'is one panel selected',
    () => editor.getOnlySelectedShape()?.type === PANEL_SHAPE_TYPE,
    [editor],
  )
  if (!isOnePanelSelected) return null
  return <TldrawUiMenuActionItem actionId="hide-panel" />
}

/**
 * The right-click menu, trimmed to the things that mean something for a canvas
 * of panels.
 *
 * Dropped from tldraw's default menu:
 * - "Move to page", because a session is a single page with nowhere to move to.
 * - The whole "Edit" submenu. For a panel it only ever offered Flatten (which
 *   rasterises a shape, so it does nothing to live HTML), Lock/unlock, and
 *   Group/Ungroup on a multi-selection -- and grouping would reparent panels,
 *   which breaks saved positions because each layout is stored from the shape's
 *   own x/y.
 * - "Copy as" and "Export as" (SVG/PNG). A shape without a `toSvg` exporter is
 *   written into the SVG as a foreignObject holding its live HTML, and that
 *   HTML is inert once the SVG is rasterised or pasted elsewhere: an SVG read
 *   as an image runs no scripts and loads no iframes, so the Spotify embed can
 *   never come through, and external image and stylesheet references drop out
 *   with it. The result is the empty frame you get today.
 *
 * Added: "Hide panel", the same action as the toolbar's "Hide selected panel",
 * so it is reachable where the user already is -- on the panel itself.
 */
function CanvasContextMenuContent() {
  const editor = useEditor()
  const isSelectToolActive = useValue(
    'is select tool active',
    () => editor.getCurrentToolId() === 'select',
    [editor],
  )
  if (!isSelectToolActive) return null

  return (
    <>
      <TldrawUiMenuGroup id="panel">
        <HidePanelMenuItem />
      </TldrawUiMenuGroup>
      <TldrawUiMenuGroup id="modify">
        <ArrangeMenuSubmenu />
        <ReorderMenuSubmenu />
      </TldrawUiMenuGroup>
      <ClipboardMenuGroup />
      <TldrawUiMenuGroup id="select-all">
        <SelectAllMenuItem />
      </TldrawUiMenuGroup>
    </>
  )
}
