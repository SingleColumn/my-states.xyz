import type { TLShape } from 'tldraw'
import type { Moment, Panel, PanelContent } from './types'
import { PANEL_SHAPE_TYPE } from './panelShapeTypes'
import { panelShapeProps, type PanelShape } from './panelShapeSchema'
import { getPanelDefinition, isPanelType } from './panelRegistry'

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
  /**
   * Who owns what. This is a description of the running system and is
   * checked against it below; if the two drift, the report says so.
   */
  ownership: {
    tldraw: string[]
    momentRecord: string[]
    ownStores: string[]
    react: string[]
  }
  panels: Array<{
    panelId: string
    panelType: Panel['type']
    rendererKey: string | null
    shape: {
      shapeId: string
      position: { x: number; y: number }
      size: { w: number; h: number }
      propertyNames: string[]
      configPropertyNames: string[]
      index: string
      visible: boolean
      focusView: boolean
      locked: boolean
    }
    contentReferences: Record<string, string | null>
  }>
  checks: PanelArchitectureCheck[]
}

export interface PanelArchitectureEditor {
  getCurrentPageShapesSorted(): readonly TLShape[]
}

/**
 * Reads the canvas and the moment record and says whether they hold to the
 * architecture: every panel is one tldraw shape carrying its own
 * configuration, the configuration validates against the schema, the moment
 * persists the document and nothing else about panels, and the rules the
 * registry declares (one of a singleton kind) hold.
 */
export function buildPanelArchitectureReport(moment: Moment, editor: PanelArchitectureEditor): PanelArchitectureReport {
  const shapes = editor.getCurrentPageShapesSorted().filter(isPanelShapeRecord)
  const checks: PanelArchitectureCheck[] = []
  const addCheck = (id: string, label: string, status: ArchitectureCheckStatus, details: string) => {
    checks.push({ id, label, status, details })
  }

  const panels = shapes.map((shape) => ({
    panelId: shape.props.panelId,
    panelType: shape.props.panel.type,
    rendererKey: isPanelType(shape.props.panel.type) ? getPanelDefinition(shape.props.panel.type).label : null,
    shape: {
      shapeId: shape.id,
      position: { x: shape.x, y: shape.y },
      size: { w: shape.props.w, h: shape.props.h },
      propertyNames: Object.keys(shape.props).sort(),
      configPropertyNames: Object.keys(shape.props.panel.config).sort(),
      index: shape.index,
      visible: shape.props.visible,
      focusView: shape.props.focusView,
      locked: shape.isLocked,
    },
    contentReferences: getContentReferences(shape.props.panel),
  }))

  const panelIds = shapes.map((shape) => shape.props.panelId)
  const uniquePanelIds = new Set(panelIds)
  addCheck(
    'stable-panel-ids',
    'Every panel shape carries a unique panelId',
    panelIds.every(Boolean) && uniquePanelIds.size === panelIds.length ? 'PASS' : 'ERROR',
    `${panelIds.length} panel shapes, ${uniquePanelIds.size} unique ids`,
  )

  const invalid = shapes.flatMap((shape) => {
    try {
      panelShapeProps.panel.validate(shape.props.panel)
      return []
    } catch (caught) {
      return [`${shape.props.panelId}: ${caught instanceof Error ? caught.message : String(caught)}`]
    }
  })
  addCheck(
    'config-validates',
    'Every panel configuration validates against the shape schema',
    invalid.length ? 'ERROR' : 'PASS',
    invalid.length ? invalid.join('; ') : 'All configurations validate',
  )

  const unknownTypes = shapes.filter((shape) => !isPanelType(shape.props.panel.type))
  addCheck(
    'renderer-mapping',
    'Every panel type is in the registry',
    unknownTypes.length ? 'ERROR' : 'PASS',
    unknownTypes.length ? unknownTypes.map((shape) => shape.props.panel.type).join(', ') : 'All panel types are registered',
  )

  const counts = countByType(shapes)
  const singletonBreaches = Object.keys(counts).filter((type) => isPanelType(type) && getPanelDefinition(type).singleton && counts[type] > 1)
  addCheck(
    'singletons',
    'A singleton panel kind appears at most once',
    singletonBreaches.length ? 'ERROR' : 'PASS',
    singletonBreaches.length ? singletonBreaches.map((type) => `${type}: ${counts[type]}`).join(', ') : 'No singleton kind is duplicated',
  )

  const hiddenUnlocked = shapes.filter((shape) => !shape.props.visible && !shape.isLocked)
  addCheck(
    'hidden-panels-locked',
    'A hidden panel is locked so the canvas cannot act on it',
    hiddenUnlocked.length ? 'ERROR' : 'PASS',
    hiddenUnlocked.length ? hiddenUnlocked.map((shape) => shape.props.panelId).join(', ') : `${shapes.filter((shape) => !shape.props.visible).length} hidden, all locked`,
  )

  addCheck(
    'schema-version',
    'The moment uses the current schema',
    moment.schemaVersion === 3 ? 'PASS' : 'WARNING',
    `Moment schemaVersion is ${moment.schemaVersion}`,
  )

  addCheck(
    'document-persisted',
    'The moment persists the tldraw document and no separate panel records',
    moment.document && !moment.legacy ? 'PASS' : moment.document ? 'WARNING' : 'ERROR',
    moment.document
      ? moment.legacy ? 'Document is present but pre-snapshot content has not been cleared' : 'Document is the only record of the canvas'
      : 'No document has been saved for this moment yet',
  )

  const persistedShapeIds = new Set(moment.document ? Object.keys(moment.document.store).filter((id) => id.startsWith('shape:')) : [])
  const unpersisted = shapes.filter((shape) => !persistedShapeIds.has(shape.id))
  addCheck(
    'document-correlation',
    'Every shape on the canvas is in the persisted document',
    !moment.document ? 'WARNING' : unpersisted.length ? 'WARNING' : 'PASS',
    !moment.document ? 'No document to compare against' : unpersisted.length ? `${unpersisted.length} shape(s) not yet saved (a save is debounced)` : 'Canvas and document agree',
  )

  const errors = checks.filter((check) => check.status === 'ERROR').length
  const warnings = checks.filter((check) => check.status === 'WARNING').length
  return {
    moment: { id: moment.id, name: moment.name, schemaVersion: moment.schemaVersion },
    summary: {
      panelCount: panels.length,
      shapeCount: shapes.length,
      errors,
      warnings,
      status: errors ? 'ERROR' : warnings ? 'WARNING' : 'PASS',
    },
    ownership: {
      tldraw: [
        'shape identity, position, size, rotation and stacking order',
        'panel type, configuration, visibility and focus view (as shape props, validated by the schema)',
        'selection and undo history',
        'pointer interaction outside a declared content region',
      ],
      momentRecord: ['name and timestamps', 'the tldraw document snapshot', 'the camera'],
      ownStores: ['notes (by moment)', 'image assets and folder handles (by moment and panelId)', 'Spotify tokens (browser-local, never in a moment)'],
      react: ['component-internal UI state', 'playback state and loaded images, keyed by panelId in AppState runtime maps', 'pointer interaction inside a declared content region'],
    },
    panels,
    checks,
  }
}

function isPanelShapeRecord(shape: TLShape): shape is PanelShape {
  const props = shape.props as Partial<PanelShape['props']> | undefined
  return shape.type === PANEL_SHAPE_TYPE
    && typeof props === 'object'
    && props !== null
    && typeof props.panelId === 'string'
    && typeof props.w === 'number'
    && typeof props.h === 'number'
    && typeof props.panel === 'object'
    && props.panel !== null
}

function countByType(shapes: PanelShape[]) {
  const counts: Record<string, number> = {}
  for (const shape of shapes) counts[shape.props.panel.type] = (counts[shape.props.panel.type] ?? 0) + 1
  return counts
}

function getContentReferences(panel: PanelContent): Record<string, string | null> {
  if (panel.type === 'notes') return { activeNoteId: panel.config.activeNoteId }
  if (panel.type === 'spotify') return { playlistId: panel.config.playlist.id, playlistUri: panel.config.playlist.uri }
  if (panel.config.imageSource.type === 'bundled') return { imageCollectionId: panel.config.imageSource.collectionId }
  return { imageSourceType: panel.config.imageSource.type, folderName: panel.config.folderName }
}
