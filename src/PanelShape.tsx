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
        onContextMenu={() => editor.select(shape.id)}
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

function handlePanelPointerDownCapture(
  editor: ReturnType<typeof useEditor>,
  shapeId: PanelShape['id'],
  event: React.PointerEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
) {
  if (!('button' in event) || event.button === 0 || event.button === 2) {
    editor.select(shapeId)
  }

  if ('button' in event && event.button === 2) return
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
