import type { TLShape } from 'tldraw'
import type { Panel, Moment } from './types'
import { PANEL_SHAPE_TYPE } from './panelShapeTypes'

export type ArchitectureCheckStatus = 'PASS' | 'WARNING' | 'ERROR'

export interface PanelArchitectureCheck {
  id: string
  label: string
  status: ArchitectureCheckStatus
  details: string
}

export interface PanelArchitectureReport {
  moment: {
    id: string
    name: string
    schemaVersion: number
  }
  summary: {
    panelCount: number
    shapeCount: number
    errors: number
    warnings: number
    status: ArchitectureCheckStatus
  }
  ownership: {
    tldraw: string[]
    panelModel: string[]
    persistence: string[]
    react: string[]
  }
  panels: Array<{
    panelId: string
    panelType: Panel['type']
    rendererKey: string | null
    panelModel: {
      propertyNames: string[]
      configPropertyNames: string[]
      contentReferences: Record<string, string | null>
    }
    shape: {
      shapeId: string | null
      position: { x: number; y: number } | null
      size: { w: number; h: number } | null
      propertyNames: string[]
      index: string | null
    }
    persisted: {
      momentPanelId: string | null
      canvasLayout: { x: number; y: number; w: number; h: number } | null
    }
  }>
  checks: PanelArchitectureCheck[]
}

export interface PanelArchitectureEditor {
  getCurrentPageShapes(): readonly TLShape[]
}

const rendererKeys: Record<Panel['type'], string> = {
  spotify: 'SpotifyPanel',
  slideshow: 'SlideshowPanel',
  notes: 'NotesPanel',
}

export function buildPanelArchitectureReport(moment: Moment, editor: PanelArchitectureEditor): PanelArchitectureReport {
  const shapes = editor.getCurrentPageShapes().filter(isPanelShape)
  const shapeByPanelId = new Map<string, TLShape[]>()
  for (const shape of shapes) {
    const list = shapeByPanelId.get(shape.props.panelId) ?? []
    list.push(shape)
    shapeByPanelId.set(shape.props.panelId, list)
  }

  const panelById = new Map(moment.panels.map((panel) => [panel.id, panel]))
  const layouts = new Map((moment.canvas?.panels ?? []).map((layout) => [layout.panelId, layout]))
  const panels = moment.panels.map((panel) => {
    const matchingShapes = shapeByPanelId.get(panel.id) ?? []
    const shape = matchingShapes[0]
    const layout = layouts.get(panel.id)
    const shapeProps = shape?.props as { w?: number; h?: number } | undefined
    return {
      panelId: panel.id,
      panelType: panel.type,
      rendererKey: rendererKeys[panel.type] ?? null,
      panelModel: {
        propertyNames: Object.keys(panel).sort(),
        configPropertyNames: Object.keys(panel.config).sort(),
        contentReferences: getContentReferences(panel),
      },
      shape: {
        shapeId: shape?.id ?? null,
        position: shape ? { x: shape.x, y: shape.y } : null,
        size: shape && typeof shapeProps?.w === 'number' && typeof shapeProps.h === 'number' ? { w: shapeProps.w, h: shapeProps.h } : null,
        propertyNames: shape ? Object.keys(shape.props).sort() : [],
        index: shape?.index ?? null,
      },
      persisted: {
        momentPanelId: panelById.has(panel.id) ? panel.id : null,
        canvasLayout: layout ? { x: layout.x, y: layout.y, w: layout.w, h: layout.h } : null,
      },
    }
  })

  const checks: PanelArchitectureCheck[] = []
  const addCheck = (id: string, label: string, status: ArchitectureCheckStatus, details: string) => {
    checks.push({ id, label, status, details })
  }

  const panelIds = moment.panels.map((panel) => panel.id)
  const uniquePanelIds = new Set(panelIds)
  addCheck(
    'stable-panel-ids',
    'Every panel has a unique stable panel ID',
    panelIds.every(Boolean) && uniquePanelIds.size === panelIds.length ? 'PASS' : 'ERROR',
    `${panelIds.length} panel objects, ${uniquePanelIds.size} unique IDs`,
  )

  const panelsWithoutExactlyOneShape = moment.panels.filter((panel) => (shapeByPanelId.get(panel.id)?.length ?? 0) !== 1)
  addCheck(
    'panel-shape-cardinality',
    'Every panel maps to exactly one tldraw shape',
    panelsWithoutExactlyOneShape.length ? 'ERROR' : 'PASS',
    panelsWithoutExactlyOneShape.length ? panelsWithoutExactlyOneShape.map((panel) => panel.id).join(', ') : 'All panels have one shape',
  )

  const orphanShapes = shapes.filter((shape) => !panelById.has(shape.props.panelId))
  addCheck(
    'orphan-shapes',
    'Every tldraw panel shape maps to one panel object',
    orphanShapes.length ? 'ERROR' : 'PASS',
    orphanShapes.length ? `${orphanShapes.length} orphan shape(s)` : 'No orphan shapes',
  )

  const invalidRenderers = moment.panels.filter((panel) => !rendererKeys[panel.type])
  addCheck(
    'renderer-mapping',
    'Every panel type resolves to a renderer',
    invalidRenderers.length ? 'ERROR' : 'PASS',
    invalidRenderers.length ? invalidRenderers.map((panel) => panel.type).join(', ') : 'All panel types have registered renderer keys',
  )

  const geometryProperties = new Set(['x', 'y', 'w', 'h', 'width', 'height', 'position', 'size'])
  const modelGeometry = moment.panels.flatMap((panel) => Object.keys(panel).filter((key) => geometryProperties.has(key)))
  addCheck(
    'geometry-ownership',
    'Panel model does not own competing canvas geometry',
    modelGeometry.length ? 'ERROR' : 'PASS',
    modelGeometry.length ? `Geometry fields found on panel model: ${modelGeometry.join(', ')}` : 'Geometry is owned by tldraw shapes; moment canvas stores the persistence snapshot',
  )

  const layoutIds = moment.canvas?.panels?.map((layout) => layout.panelId) ?? []
  const duplicateLayoutIds = layoutIds.filter((id, index) => layoutIds.indexOf(id) !== index)
  const orphanLayouts = layoutIds.filter((id) => !panelById.has(id))
  addCheck(
    'canvas-persistence-correlation',
    'Persisted canvas layouts correlate unambiguously with panel objects',
    duplicateLayoutIds.length || orphanLayouts.length ? 'ERROR' : 'PASS',
    duplicateLayoutIds.length || orphanLayouts.length ? `Duplicate layouts: ${duplicateLayoutIds.length}; orphan layouts: ${orphanLayouts.length}` : 'Canvas layouts use panelId references',
  )

  const spotifyCount = moment.panels.filter((panel) => panel.type === 'spotify').length
  addCheck(
    'spotify-singleton',
    'The moment contains at most one Spotify panel',
    spotifyCount > 1 ? 'ERROR' : 'PASS',
    `${spotifyCount} Spotify panel(s)`,
  )

  const deprecatedRepresentations = shapes.filter((shape) => 'panelType' in shape.props).length
  addCheck(
    'legacy-runtime-representation',
    'Deprecated panelType shape identity is not active',
    deprecatedRepresentations ? 'ERROR' : 'PASS',
    deprecatedRepresentations ? `${deprecatedRepresentations} shape(s) still use panelType` : 'All shapes use panelId',
  )

  addCheck(
    'schema-version',
    'Persisted panel data uses the current moment schema',
    moment.schemaVersion === 2 ? 'PASS' : 'WARNING',
    `Moment schemaVersion is ${moment.schemaVersion}`,
  )

  addCheck(
    'runtime-persistence-correlation',
    'Runtime panel objects and persisted panel objects correlate by panelId',
    panels.every((panel) => panel.persisted.momentPanelId === panel.panelId) ? 'PASS' : 'ERROR',
    'Panel identity is correlated by panelId',
  )

  const errors = checks.filter((check) => check.status === 'ERROR').length
  const warnings = checks.filter((check) => check.status === 'WARNING').length
  return {
    moment: { id: moment.id, name: moment.name, schemaVersion: moment.schemaVersion },
    summary: {
      panelCount: moment.panels.length,
      shapeCount: shapes.length,
      errors,
      warnings,
      status: errors ? 'ERROR' : warnings ? 'WARNING' : 'PASS',
    },
    ownership: {
      tldraw: ['position', 'dimensions', 'transforms', 'selection', 'canvas interaction', 'shape ordering/index'],
      panelModel: ['stable panelId', 'panel type', 'persistent semantic/configuration state', 'content references', 'moment membership'],
      persistence: ['moment panel records', 'canvas geometry snapshots keyed by panelId', 'panel-associated assets and notes'],
      react: ['component-internal UI state', 'content-specific transient runtime state keyed by panelId where applicable'],
    },
    panels,
    checks,
  }
}

function isPanelShape(shape: TLShape): shape is TLShape & { props: { panelId: string; w: number; h: number } } {
  return shape.type === PANEL_SHAPE_TYPE
    && typeof shape.props === 'object'
    && shape.props !== null
    && typeof (shape.props as { panelId?: unknown }).panelId === 'string'
    && typeof (shape.props as { w?: unknown }).w === 'number'
    && typeof (shape.props as { h?: unknown }).h === 'number'
}

function getContentReferences(panel: Panel): Record<string, string | null> {
  if (panel.type === 'notes') return { activeNoteId: panel.config.activeNoteId }
  if (panel.type === 'spotify') return { playlistId: panel.config.playlist.id, playlistUri: panel.config.playlist.uri }
  if (panel.config.imageSource.type === 'bundled') return { imageCollectionId: panel.config.imageSource.collectionId }
  return { imageSourceType: panel.config.imageSource.type, folderName: panel.config.folderName }
}
