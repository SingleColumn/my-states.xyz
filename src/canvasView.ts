import type { Editor } from 'tldraw'

const PANEL_SHAPE_TYPE = 'music-panel'

export interface ViewportInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface ViewRect {
  x: number
  y: number
  w: number
  h: number
}

export interface FitCamera {
  x: number
  y: number
  z: number
}

export const DEFAULT_VIEW_MARGIN = 16
export const FALLBACK_CHROME_HEIGHT = 52

export function getChromeAwareInsets(chromeBottom: number | null | undefined, viewport: ViewRect, margin = DEFAULT_VIEW_MARGIN): ViewportInsets {
  const safeChromeBottom = Number.isFinite(chromeBottom) ? Math.max(viewport.y, chromeBottom as number) : viewport.y + FALLBACK_CHROME_HEIGHT
  return {
    top: Math.max(margin, safeChromeBottom - viewport.y + margin),
    right: margin,
    bottom: margin,
    left: margin,
  }
}

export function getUsableViewport(viewport: ViewRect, insets: ViewportInsets): ViewRect | null {
  const x = viewport.x + Math.max(0, insets.left)
  const y = viewport.y + Math.max(0, insets.top)
  const w = viewport.w - Math.max(0, insets.left) - Math.max(0, insets.right)
  const h = viewport.h - Math.max(0, insets.top) - Math.max(0, insets.bottom)
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

export function calculateFitCamera(
  bounds: ViewRect | null,
  viewport: ViewRect,
  insets: ViewportInsets,
  minZoom: number,
  maxZoom: number,
): FitCamera | null {
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null
  const usable = getUsableViewport(viewport, insets)
  if (!usable) return null

  const z = clamp(Math.min(usable.w / bounds.w, usable.h / bounds.h), minZoom, maxZoom)
  const targetScreenX = usable.x + usable.w / 2
  const targetScreenY = usable.y + usable.h / 2
  return {
    x: (targetScreenX - viewport.x) / z - (bounds.x + bounds.w / 2),
    y: (targetScreenY - viewport.y) / z - (bounds.y + bounds.h / 2),
    z,
  }
}

export function getCollectiveBounds(bounds: readonly ViewRect[]): ViewRect | null {
  if (!bounds.length) return null
  const minX = Math.min(...bounds.map((item) => item.x))
  const minY = Math.min(...bounds.map((item) => item.y))
  const maxX = Math.max(...bounds.map((item) => item.x + item.w))
  const maxY = Math.max(...bounds.map((item) => item.y + item.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function getSelectedPanelBounds(
  panels: readonly { id: string; bounds: ViewRect | null }[],
  selectedIds: readonly string[],
): ViewRect | null {
  if (selectedIds.length !== 1) return null
  return panels.find((panel) => panel.id === selectedIds[0])?.bounds ?? null
}

export function getPanelBounds(editor: Editor): ViewRect | null {
  const bounds = getPanelBoundsWithIds(editor).map((panel) => panel.bounds)
  return getCollectiveBounds(bounds)
}

export function getSelectedPanelPageBounds(editor: Editor): ViewRect | null {
  const selectedIds = editor.getSelectedShapeIds().map(String)
  const selected = getSelectedPanelBounds(
    getPanelBoundsWithIds(editor).map(({ id, bounds }) => ({ id: String(id), bounds })),
    selectedIds,
  )
  return selected
}

export function fitEditorToBounds(editor: Editor, bounds: ViewRect | null, insets: ViewportInsets): boolean {
  const viewport = editor.getViewportScreenBounds()
  const options = editor.getCameraOptions()
  const baseZoom = editor.getBaseZoom()
  const camera = calculateFitCamera(
    bounds,
    { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h },
    insets,
    options.zoomSteps[0] * baseZoom,
    options.zoomSteps[options.zoomSteps.length - 1] * baseZoom,
  )
  if (!camera) return false
  editor.setCamera(camera, { immediate: true })
  return true
}

function getPanelBoundsWithIds(editor: Editor) {
  return editor
    .getCurrentPageShapes()
    .filter((shape) => shape.type === PANEL_SHAPE_TYPE)
    .map((shape) => ({ id: shape.id, bounds: editor.getShapePageBounds(shape) }))
    .filter((item): item is { id: typeof item.id; bounds: NonNullable<typeof item.bounds> } => Boolean(item.bounds))
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}
