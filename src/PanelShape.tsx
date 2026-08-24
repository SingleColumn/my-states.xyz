import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  Rectangle2d,
  T,
  TLBaseShape,
} from 'tldraw'
import type { PanelType } from './types'
import { getCanonicalPanelLayout, getPanelMinimumSize } from './panelLayout'
import { SpotifyPanel } from './panels/SpotifyPanel'
import { SlideshowPanel } from './panels/SlideshowPanel'
import { NotesPanel } from './panels/NotesPanel'

export const PANEL_SHAPE_TYPE = 'music-panel'

export type PanelShape = TLBaseShape<
  typeof PANEL_SHAPE_TYPE,
  {
    w: number
    h: number
    panelType: string
  }
>

export class PanelShapeUtil extends BaseBoxShapeUtil<PanelShape> {
  static override type = PANEL_SHAPE_TYPE

  static override props: RecordProps<PanelShape> = {
    w: T.number,
    h: T.number,
    panelType: T.string,
  }

  override getDefaultProps(): PanelShape['props'] {
    const layout = getCanonicalPanelLayout('slideshow')
    return {
      w: layout.w,
      h: layout.h,
      panelType: 'slideshow',
    }
  }

  override component(shape: PanelShape) {
    return (
      <HTMLContainer
        className={`canvas-panel-shell panel-${shape.props.panelType}`}
        onPointerDownCapture={handlePanelPointerDownCapture}
        onTouchStartCapture={handlePanelPointerDownCapture}
        style={{
          width: shape.props.w,
          height: shape.props.h,
        }}
      >
        <PanelContent panelType={shape.props.panelType as PanelType} />
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
    const minimum = getPanelMinimumSize(shape.props.panelType as PanelType)
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

function PanelContent({ panelType }: { panelType: PanelType }) {
  if (panelType === 'spotify') return <SpotifyPanel />
  if (panelType === 'notes') return <NotesPanel />
  return <SlideshowPanel />
}

function handlePanelPointerDownCapture(event: React.PointerEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  if (target.closest('button, input, select, textarea, label, .cm-editor, .mdxeditor, [contenteditable="true"], [role="textbox"], .panel-interactive')) {
    ;(event as unknown as { isKilled?: boolean }).isKilled = true
    ;(event.nativeEvent as unknown as { isKilled?: boolean }).isKilled = true
    event.stopPropagation()
  }
}
