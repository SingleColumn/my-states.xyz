import { useEffect, useRef } from 'react'
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  Rectangle2d,
  T,
  TLBaseShape,
  useEditor,
} from 'tldraw'
import { useAppState } from './AppState'
import type { PanelType } from './types'
import { getCanonicalPanelLayout, getPanelMinimumSize } from './panelLayout'
import { SpotifyPanel } from './panels/SpotifyPanel'
import { SlideshowPanel } from './panels/SlideshowPanel'
import { NotesPanel } from './panels/NotesPanel'
import { PANEL_SHAPE_TYPE } from './panelShapeTypes'

export { PANEL_SHAPE_TYPE } from './panelShapeTypes'

export type PanelShape = TLBaseShape<
  typeof PANEL_SHAPE_TYPE,
  {
    w: number
    h: number
    panelId: string
  }
>

export function getPanelIdFromShape(shape: PanelShape) {
  return shape.props.panelId
}

export class PanelShapeUtil extends BaseBoxShapeUtil<PanelShape> {
  static override type = PANEL_SHAPE_TYPE

  static override props: RecordProps<PanelShape> = {
    w: T.number,
    h: T.number,
    panelId: T.string,
  }

  override getDefaultProps(): PanelShape['props'] {
    const layout = getCanonicalPanelLayout('slideshow')
    return {
      w: layout.w,
      h: layout.h,
      panelId: '',
    }
  }

  // Deliberately NOT editable, and panel selection deliberately does not set
  // tldraw's `editingShapeId`. Both look tempting as a way to stop tldraw
  // treating Delete/Ctrl+C as canvas shortcuts while someone types in a note,
  // and an earlier version did exactly that -- but `editingShapeId` is not a
  // passive flag. tldraw's default side effects put the select tool into
  // `select.editing_shape` whenever it is set, and that state ignores
  // pointer-down on the edited shape and hides every resize handle, so panels
  // could no longer be dragged or resized.
  //
  // It was also unnecessary. Every handler it was meant to stand down already
  // checks the focused element instead: the canvas keydown handler via
  // `activeElementShouldCaptureKeys`, native copy/cut/paste via its own
  // `areShortcutsDisabled`, and the UI action hotkeys via hotkeys-js's default
  // filter. All three ignore keys typed into a contenteditable or input, which
  // is exactly where a panel's text lives. Wheel is the one thing they do not
  // cover -- see useNativeWheelScrollScope below.

  override component(shape: PanelShape) {
    const editor = useEditor()
    const wheelScopeRef = useNativeWheelScrollScope()

    return (
      <HTMLContainer
        className="canvas-panel-shell"
        onPointerDownCapture={(event) => handlePanelPointerDownCapture(editor, shape.id, event)}
        onTouchStartCapture={(event) => handlePanelPointerDownCapture(editor, shape.id, event)}
        onContextMenu={(event) => handlePanelContextMenu(editor, shape.id, event)}
        style={{
          width: shape.props.w,
          height: shape.props.h,
        }}
      >
        <div ref={wheelScopeRef} className="canvas-panel-wheel-scope">
          <PanelContent panelId={shape.props.panelId} />
        </div>
      </HTMLContainer>
    )
  }

  override indicator(shape: PanelShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={22} ry={22} />
  }

  override getGeometry(shape: PanelShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  override onResize(shape: PanelShape, info: Parameters<BaseBoxShapeUtil<PanelShape>['onResize']>[1]) {
    const resized = super.onResize(shape, info) as PanelShape
    const minimum = getPanelMinimumSize('slideshow')
    return {
      ...resized,
      props: {
        ...resized.props,
        w: Math.max(minimum.w, resized.props.w),
        h: Math.max(minimum.h, resized.props.h),
      },
    }
  }
}

/**
 * Lets a genuinely scrollable region inside a panel -- the Notes editor, in
 * particular -- own the wheel instead of the canvas panning underneath it.
 *
 * tldraw's own gesture handler has an escape hatch for this (`canScroll` on
 * the shape util), but it is gated on the shape being tldraw's "editing"
 * shape, which panels deliberately never are -- see the comment on the shape
 * util above. It also depends on tldraw's own pointer-position tracking,
 * which panel content starves: a click or drag on interactive/text content is
 * deliberately kept from reaching tldraw at all (see
 * handlePanelPointerDownCapture and canvasEventBlockerProps in NotesPanel),
 * so tldraw's tracked pointer position goes stale the moment the cursor is
 * over that content -- exactly where a wheel-scroll fix is needed. Rather
 * than widen what reaches tldraw's pointer pipeline just to keep that
 * position fresh, this intercepts the wheel event directly.
 *
 * tldraw's canvas-pan/zoom listener is bound in bubble phase on an ancestor,
 * so a capture-phase listener here always runs first regardless of that
 * pointer state -- capture listeners along a path finish before any bubble
 * listener anywhere on it starts. The scroll itself is applied by hand rather
 * than left to the browser's default action: tldraw also registers a
 * non-passive wheel listener further up, and stopping propagation before a
 * non-passive listener gets to run leaves some browsers unable to resolve
 * whether the gesture was prevented, so the default scroll silently never
 * happens. Applying it directly removes that ambiguity.
 */
function useNativeWheelScrollScope() {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.addEventListener('wheel', handleNativeWheel, { capture: true, passive: false })
    return () => node.removeEventListener('wheel', handleNativeWheel, { capture: true })
  }, [])

  return ref
}

function handleNativeWheel(event: WheelEvent) {
  // Ctrl/Cmd+wheel is a zoom gesture, not a scroll -- leave it for tldraw to
  // zoom the canvas even while the pointer is over scrollable content.
  if (event.ctrlKey || event.metaKey) return
  if (!(event.currentTarget instanceof Element) || !(event.target instanceof Node)) return
  const scrollable = findScrollableAncestor(event.target, event.currentTarget)
  if (!scrollable) return
  event.preventDefault()
  event.stopPropagation()
  scrollable.scrollTop += event.deltaY
  scrollable.scrollLeft += event.deltaX
}

function findScrollableAncestor(start: Node, boundary: Element): HTMLElement | null {
  let node: Node | null = start
  while (node) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node)
      const canScrollY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight
      if (canScrollY) return node
    }
    if (node === boundary) break
    node = node.parentNode
  }
  return null
}

function PanelContent({ panelId }: { panelId: string }) {
  const { moments } = useAppState()
  const panel = moments.activeMoment?.panels.find((candidate) => candidate.id === panelId)
  if (!panel) return <div className="panel">This panel is no longer available.</div>
  if (panel.type === 'spotify') return <SpotifyPanel panelId={panel.id} />
  if (panel.type === 'notes') return <NotesPanel panelId={panel.id} />
  return <SlideshowPanel panelId={panel.id} />
}

// The surfaces where a right-click means "act on this text", not "act on this
// panel" - so the browser's own Cut/Copy/Paste should be offered instead of
// tldraw's shape clipboard.
const textEditingSelector = 'input, textarea, .cm-editor, [contenteditable="true"], [role="textbox"]'

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(textEditingSelector) !== null
}

/**
 * tldraw's canvas menu offers clipboard actions that operate on shapes, so its
 * Paste dropped the clipboard onto the canvas as a new shape instead of into
 * the note the user had right-clicked. Letting the event through unhandled
 * gives the browser's own menu, whose Cut/Copy/Paste act on the text selection
 * -- the same thing Ctrl+V already did.
 */
function handlePanelContextMenu(
  editor: ReturnType<typeof useEditor>,
  shapeId: PanelShape['id'],
  event: React.MouseEvent<HTMLDivElement>,
) {
  if (isTextEditingTarget(event.target)) {
    event.stopPropagation()
    return
  }
  editor.select(shapeId)
}

function handlePanelPointerDownCapture(
  editor: ReturnType<typeof useEditor>,
  shapeId: PanelShape['id'],
  event: React.PointerEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
) {
  const isRightClick = 'button' in event && event.button === 2

  // Selecting the panel here would pull focus out of the caret, and tldraw
  // would open its own menu over the text. Leave both alone.
  if (isRightClick && isTextEditingTarget(event.target)) {
    ;(event as unknown as { isKilled?: boolean }).isKilled = true
    ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
    return
  }

  if (!('button' in event) || event.button === 0 || isRightClick) {
    editor.select(shapeId)
  }

  if (isRightClick) return
  const target = event.target
  if (!(target instanceof Element)) return

  if (target.closest('button, input, select, textarea, label, .cm-editor, [contenteditable="true"], [role="textbox"], [role="option"], [role="combobox"], [data-radix-select-viewport], .mdxeditor-toolbar, .mdxeditor-popup-container, .panel-interactive')) {
    ;(event as unknown as { isKilled?: boolean }).isKilled = true
    ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true

    // Keep the event on the document so tldraw's context menu can observe an
    // outside click and close before a later right-click opens a new menu.
    // The killed flag still prevents canvas manipulation.
  }
}
