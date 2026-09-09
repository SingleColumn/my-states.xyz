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

  override component(shape: PanelShape) {
    const editor = useEditor()

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
        <PanelContent panelId={shape.props.panelId} />
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

function PanelContent({ panelId }: { panelId: string }) {
  const { sessions } = useAppState()
  const panel = sessions.activeSession?.panels.find((candidate) => candidate.id === panelId)
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
