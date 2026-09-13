import { T, createShapeId, type Editor, type TLShape, type TLShapePartial, type TLStoreSnapshot } from 'tldraw'
import type { CanvasCamera, LegacyCanvasContent, Panel, PanelConfigs, PanelLayout, PanelType } from './types'
import { PANEL_SHAPE_TYPE } from './panelShapeTypes'
import { panelShapeProps, type PanelShape, type PanelShapeProps } from './panelShapeSchema'
import { getPanelDefinition } from './panelRegistry'
import { createId } from './utils'

/**
 * Every read and write of a panel goes through here. tldraw's store is the
 * record of truth for a panel: its geometry, its order, whether it is shown,
 * and its configuration all live on the shape, so tldraw validates them,
 * persists them with the document, and undoes them together.
 *
 * Reads return a `Panel`, a plain view of the shape's props that components
 * can render. Writes take a patch and go through one function,
 * `writePanelShape`, which is where the choice of whether a write belongs in
 * the undo history is made. A user's edit is history; a write the app makes
 * on its own behalf (a lookup that fills in artwork, a normalisation on
 * load, a timer) is not, and passes `history: 'ignore'`.
 */

export function isPanelShape(shape: TLShape | undefined | null): shape is PanelShape {
  return !!shape && shape.type === PANEL_SHAPE_TYPE
}

const panelViews = new WeakMap<PanelShapeProps, Panel>()

/**
 * The panel a shape describes. tldraw keeps a shape's props object when only
 * its geometry changes, so the view is cached on the props: a drag does not
 * hand components a new panel object.
 */
export function panelFromShape(shape: PanelShape): Panel {
  const cached = panelViews.get(shape.props)
  if (cached) return cached
  const panel = {
    id: shape.props.panelId,
    type: shape.props.panel.type,
    config: shape.props.panel.config,
    visible: shape.props.visible,
    focusView: shape.props.focusView,
  } as Panel
  panelViews.set(shape.props, panel)
  return panel
}

/** Panel shapes in stacking order, hidden ones included. */
export function listPanelShapes(editor: Editor): PanelShape[] {
  return editor.getCurrentPageShapesSorted().filter(isPanelShape)
}

export function listPanels(editor: Editor): Panel[] {
  return listPanelShapes(editor).map(panelFromShape)
}

export function getPanelShape(editor: Editor, panelId: string): PanelShape | undefined {
  return listPanelShapes(editor).find((shape) => shape.props.panelId === panelId)
}

export function getPanel(editor: Editor, panelId: string): Panel | undefined {
  const shape = getPanelShape(editor, panelId)
  return shape ? panelFromShape(shape) : undefined
}

export interface PanelWriteOptions {
  /**
   * 'record' (the default) puts the write in the undo history, which is
   * right for anything the user did. 'ignore' keeps it out, for writes the
   * app makes by itself.
   */
  history?: 'record' | 'ignore'
}

export type PanelShapePatch = Partial<Pick<PanelShape, 'x' | 'y' | 'rotation' | 'isLocked'>> & {
  props?: Partial<PanelShapeProps>
}

const propsValidator = T.object(panelShapeProps)

let editDepth = 0

/**
 * Several writes that the user experiences as one action (leave focus view
 * and give the panel its size back; reset every panel's layout) are one undo
 * step: one stopping point before, and the writes inside share it.
 */
export function withPanelEdit<Result>(editor: Editor, name: string, fn: () => Result, options: PanelWriteOptions & { ignoreShapeLock?: boolean } = {}): Result {
  const history = options.history ?? 'record'
  if (history === 'record' && editDepth === 0) editor.markHistoryStoppingPoint(name)
  editDepth += 1
  try {
    let result!: Result
    editor.run(() => { result = fn() }, { history, ignoreShapeLock: options.ignoreShapeLock })
    return result
  } finally {
    editDepth -= 1
  }
}

/**
 * The one write path for panel shapes.
 *
 * The props are validated here, before tldraw sees them. tldraw validates
 * too, but a failure inside its transaction is treated as a crash of the
 * editor; checked first, a bad write is an ordinary error the caller gets
 * back (a command from an agent, say) and the canvas is untouched.
 *
 * A recorded write is its own undo step. tldraw merges consecutive changes
 * into one entry unless something marks a stopping point between them (its
 * own tools mark one at the start of every interaction), so without the mark
 * a config edit made right after a drag would undo together with the drag.
 */
export function writePanelShape(editor: Editor, panelId: string, patch: PanelShapePatch, options: PanelWriteOptions = {}) {
  const shape = getPanelShape(editor, panelId)
  if (!shape) return false
  const { props, ...rest } = patch
  const partial: TLShapePartial<PanelShape> = { id: shape.id, type: PANEL_SHAPE_TYPE, ...rest }
  if (props) partial.props = propsValidator.validate({ ...shape.props, ...props })
  const history = options.history ?? 'record'
  if (history === 'record' && editDepth === 0) editor.markHistoryStoppingPoint('panel write')
  editor.run(() => editor.updateShapes([partial]), { history })
  return true
}

export function updatePanelConfig<Type extends PanelType>(
  editor: Editor,
  panelId: string,
  patch: Partial<PanelConfigs[Type]>,
  options: PanelWriteOptions = {},
) {
  const shape = getPanelShape(editor, panelId)
  if (!shape) return false
  const panel = { type: shape.props.panel.type, config: { ...shape.props.panel.config, ...patch } } as PanelShapeProps['panel']
  return writePanelShape(editor, panelId, { props: { panel } }, options)
}

/**
 * A hidden panel keeps its shape, and with it its place and configuration,
 * so showing it again is one write. The shape is locked while hidden so
 * nothing on the canvas can select, move or delete what it cannot see.
 */
export function setPanelVisible(editor: Editor, panelId: string, visible: boolean, options: PanelWriteOptions = {}) {
  return withPanelEdit(editor, visible ? 'show panel' : 'hide panel', () => writePanelShape(editor, panelId, { isLocked: !visible, props: { visible } }, options), { ...options, ignoreShapeLock: true })
}

export function setPanelFocusView(editor: Editor, panelId: string, focusView: boolean, options: PanelWriteOptions = {}) {
  return writePanelShape(editor, panelId, { props: { focusView } }, options)
}

export interface PanelPlacement {
  x: number
  y: number
  w?: number
  h?: number
  rotation?: number
}

/** The props a brand-new panel of a type starts with. */
export function createPanelProps<Type extends PanelType>(type: Type, panelId = createId('panel')): PanelShapeProps {
  const definition = getPanelDefinition(type)
  return {
    w: definition.defaultLayout.w,
    h: definition.defaultLayout.h,
    panelId,
    panel: { type, config: definition.createConfig() } as PanelShapeProps['panel'],
    visible: true,
    focusView: false,
  }
}

export function createPanelShape<Type extends PanelType>(
  editor: Editor,
  type: Type,
  placement?: PanelPlacement,
  options: PanelWriteOptions = {},
): PanelShape {
  const definition = getPanelDefinition(type)
  const id = createShapeId()
  const props = createPanelProps(type)
  const shape: TLShapePartial<PanelShape> = {
    id,
    type: PANEL_SHAPE_TYPE,
    x: placement?.x ?? definition.defaultLayout.x,
    y: placement?.y ?? definition.defaultLayout.y,
    rotation: placement?.rotation ?? 0,
    props: { ...props, w: placement?.w ?? props.w, h: placement?.h ?? props.h },
  }
  const history = options.history ?? 'record'
  if (history === 'record' && editDepth === 0) editor.markHistoryStoppingPoint('add panel')
  editor.run(() => editor.createShapes([shape]), { history })
  return editor.getShape(id) as PanelShape
}

/**
 * The shapes a pre-snapshot moment's panels become. Every panel gets a shape,
 * hidden ones too (locked, so the canvas leaves them alone); a panel with no
 * saved layout takes its type's default place.
 */
export function shapesForLegacyContent(legacy: LegacyCanvasContent): TLShapePartial<PanelShape>[] {
  const ids = new Set(legacy.panels.map((panel) => panel.id))
  if (ids.size !== legacy.panels.length || ids.has('')) throw new Error('This moment contains missing or duplicate panel identities. Its original data has been kept.')
  const layouts = new Map((legacy.canvas?.panels ?? []).map((layout) => [layout.panelId, layout]))
  // A panel with no saved layout goes after every panel that has one.
  const orderOf = (panel: Panel) => layouts.get(panel.id)?.order ?? Number.MAX_SAFE_INTEGER
  const ordered = [...legacy.panels].sort((left, right) => orderOf(left) - orderOf(right))
  return ordered.map((panel) => {
    const definition = getPanelDefinition(panel.type)
    const layout = layouts.get(panel.id)
    const visible = panel.visible !== false
    const shape = {
      id: createShapeId(),
      type: PANEL_SHAPE_TYPE as typeof PANEL_SHAPE_TYPE,
      x: layout?.x ?? definition.defaultLayout.x,
      y: layout?.y ?? definition.defaultLayout.y,
      rotation: layout?.rotation ?? 0,
      isLocked: !visible,
      props: {
        w: layout?.w ?? definition.defaultLayout.w,
        h: layout?.h ?? definition.defaultLayout.h,
        panelId: panel.id,
        panel: { type: panel.type, config: panel.config } as PanelShapeProps['panel'],
        visible,
        focusView: panel.focusView === true,
      },
    }
    // Validate before entering editor.run: an exception inside a tldraw
    // transaction marks the editor as crashed, even if the caller catches it.
    T.object(panelShapeProps).validate(shape.props)
    T.number.validate(shape.x)
    T.number.validate(shape.y)
    T.number.validate(shape.rotation)
    return shape
  })
}

/**
 * The pre-snapshot shape of a document, for the archive format and for
 * anything that wants panels without an editor. Order is stacking order.
 */
export function legacyContentFromDocument(document: TLStoreSnapshot, camera: CanvasCamera | null): LegacyCanvasContent {
  const shapes = Object.values(document.store)
    .filter((record): record is PanelShape => record.typeName === 'shape' && (record as TLShape).type === PANEL_SHAPE_TYPE)
    .sort((left, right) => (left.index < right.index ? -1 : left.index > right.index ? 1 : 0))
  const panels = shapes.map(panelFromShape)
  const layouts: PanelLayout[] = shapes.map((shape, order) => ({
    panelId: shape.props.panelId,
    x: shape.x,
    y: shape.y,
    w: shape.props.w,
    h: shape.props.h,
    rotation: shape.rotation,
    order,
  }))
  return { panels, canvas: camera ? { camera, panels: layouts } : null }
}
