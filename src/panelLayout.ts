import type { CanvasState, Panel, PanelLayout, PanelType } from './types'

export const PANEL_TYPES = ['spotify', 'slideshow', 'notes'] as const satisfies readonly PanelType[]

export const CANONICAL_PANEL_LAYOUTS = [
  { panelType: 'spotify', x: -720, y: -300, w: 460, h: 720 },
  { panelType: 'slideshow', x: -220, y: -300, w: 460, h: 720 },
  { panelType: 'notes', x: 280, y: -300, w: 460, h: 720 },
] as const

export const PANEL_MINIMUM_SIZES: Readonly<Record<PanelType, { w: number; h: number }>> = {
  spotify: { w: 320, h: 260 },
  slideshow: { w: 320, h: 260 },
  notes: { w: 320, h: 260 },
}

/**
 * The size a panel shrinks to in focus view. The Music panel drops the playlist
 * URL, search, and results and keeps playback, so it needs far less room. A
 * panel with no entry keeps the size it has: the Images panel gives the room
 * the controls used to take to the picture instead of shrinking away from it.
 */
export const PANEL_FOCUS_VIEW_SIZES: Partial<Record<PanelType, { w: number; h: number }>> = {
  spotify: { w: 380, h: 460 },
}

export function getCanonicalPanelLayout(panelType: PanelType): Omit<PanelLayout, 'panelId'> & { panelType: PanelType } {
  const layout = CANONICAL_PANEL_LAYOUTS.find((candidate) => candidate.panelType === panelType)
  if (!layout) throw new Error(`No canonical layout exists for ${panelType}.`)
  return { ...layout }
}

export function getPanelMinimumSize(panelType: PanelType) {
  return PANEL_MINIMUM_SIZES[panelType]
}

/** Null when this kind of panel keeps its size in focus view. */
export function getPanelFocusViewSize(panelType: PanelType) {
  return PANEL_FOCUS_VIEW_SIZES[panelType] ?? null
}

export function isPanelInFocusView(panel: Pick<Panel, 'focusView'>) {
  return panel.focusView === true
}

export function isPanelVisible(panel: Pick<Panel, 'visible'>) {
  return panel.visible !== false
}

export function setPanelVisibility(panels: readonly Panel[], panelId: string, visible: boolean): Panel[] {
  return panels.map((panel) => panel.id === panelId ? { ...panel, visible } : panel)
}

export function getVisiblePanels(panels: readonly Panel[]) {
  return panels.filter(isPanelVisible)
}

export function showAllPanels(panels: readonly Panel[]): Panel[] {
  return panels.map((panel) => isPanelVisible(panel) ? panel : { ...panel, visible: true })
}

export function getRenderablePanelLayouts(panels: readonly Panel[], canvas: CanvasState | null): PanelLayout[] {
  const byId = new Map(panels.map((panel) => [panel.id, panel]))
  const layouts = canvas
    ? canvas.panels.filter((layout) => {
        const panel = byId.get(layout.panelId)
        return panel !== undefined && isPanelVisible(panel)
      })
    : []
  if (canvas) return layouts.map((layout, order) => ({ ...layout, order: layout.order ?? order }))
  const presentIds = new Set(layouts.map((layout) => layout.panelId))
  const missing = getVisiblePanels(panels)
    .filter((panel) => !presentIds.has(panel.id))
    .map((panel, order) => {
      const layout = getCanonicalPanelLayout(panel.type)
      return { panelId: panel.id, x: layout.x, y: layout.y, w: layout.w, h: layout.h, rotation: 0, order: layouts.length + order }
    })
  return [...layouts, ...missing].map((layout, order) => ({ ...layout, order: layout.order ?? order }))
}

export function mergeVisiblePanelLayouts(
  panels: readonly Panel[],
  existingCanvas: CanvasState | null,
  visibleLayouts: readonly PanelLayout[],
): PanelLayout[] {
  const panelById = new Map(panels.map((panel) => [panel.id, panel]))
  const visibleById = new Map(visibleLayouts.map((layout) => [layout.panelId, layout]))
  const result: PanelLayout[] = []
  const seen = new Set<string>()
  for (const layout of existingCanvas?.panels ?? []) {
    const panel = panelById.get(layout.panelId)
    if (!panel || seen.has(layout.panelId)) continue
    if (isPanelVisible(panel)) {
      const current = visibleById.get(panel.id)
      if (!current) continue
      result.push({ ...current, order: layout.order ?? result.length })
    } else {
      result.push({ ...layout, order: layout.order ?? result.length })
    }
    seen.add(panel.id)
  }
  for (const layout of visibleLayouts) {
    if (!panelById.has(layout.panelId) || seen.has(layout.panelId)) continue
    result.push({ ...layout, order: layout.order ?? result.length })
    seen.add(layout.panelId)
  }
  return result
}

export function mergePanelLayouts(layouts: readonly PanelLayout[]): PanelLayout[] {
  const firstById = new Map<string, PanelLayout>()
  for (const layout of layouts) {
    if (!firstById.has(layout.panelId)) firstById.set(layout.panelId, layout)
  }
  return [...firstById.values()].map((layout) => ({ ...layout }))
}

export function resetPanelLayoutSize(layout: PanelLayout, panelType: PanelType): PanelLayout {
  const canonical = getCanonicalPanelLayout(panelType)
  return {
    ...layout,
    x: layout.x + (layout.w - canonical.w) / 2,
    y: layout.y + (layout.h - canonical.h) / 2,
    w: canonical.w,
    h: canonical.h,
  }
}

export function resetAllPanelLayouts(panels: readonly { id: string; type: PanelType }[]): PanelLayout[] {
  return panels.map((panel) => {
    const layout = getCanonicalPanelLayout(panel.type)
    return { panelId: panel.id, x: layout.x, y: layout.y, w: layout.w, h: layout.h }
  })
}

export function getCollectivePanelBounds(layouts: readonly PanelLayout[]) {
  if (!layouts.length) return null
  const minX = Math.min(...layouts.map((layout) => layout.x))
  const minY = Math.min(...layouts.map((layout) => layout.y))
  const maxX = Math.max(...layouts.map((layout) => layout.x + layout.w))
  const maxY = Math.max(...layouts.map((layout) => layout.y + layout.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
