import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  Rectangle2d,
  T,
  TLBaseShape,
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
    return (
      <HTMLContainer
        className="canvas-panel-shell"
        onPointerDownCapture={handlePanelPointerDownCapture}
        onTouchStartCapture={handlePanelPointerDownCapture}
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

function handlePanelPointerDownCapture(event: React.PointerEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) {
  const target = event.target
  if (!(target instanceof Element)) return

  if (target.closest('button, input, select, textarea, label, .cm-editor, [contenteditable="true"], [role="textbox"], [role="option"], [role="combobox"], [data-radix-select-viewport], .mdxeditor-toolbar, .mdxeditor-popup-container, .panel-interactive')) {
    ;(event as unknown as { isKilled?: boolean }).isKilled = true
    ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true

    // Radix needs the pointer event to reach its select trigger so a second
    // click can close the menu. The killed flag still keeps the canvas from
    // treating the interaction as panel manipulation.
    if (!target.closest('[role="combobox"], [role="option"], [data-radix-select-viewport]')) {
      event.stopPropagation()
    }
  }
}
