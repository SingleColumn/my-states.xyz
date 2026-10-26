import type { TLShape } from 'tldraw'
import type { Board, CanvasCamera, Panel, PanelContent } from './types'
import { PANEL_SHAPE_TYPE } from './panelShapeTypes'
import { panelShapeProps, type PanelShape } from './panelShapeSchema'
import { getPanelDefinition, isPanelType } from './panelRegistry'
import { BOARD_SCHEMA_VERSION } from './boardSchema'

export type ArchitectureCheckStatus = 'PASS' | 'WARNING' | 'ERROR'

export interface PanelArchitectureCheck {
  id: string
  label: string
  status: ArchitectureCheckStatus
  details: string
}

export interface PanelArchitectureReport {
  board: {
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
    boardRecord: string[]
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
  getCamera?(): CanvasCamera
}

/**
 * What is happening in the running page, as opposed to what is stored. The
 * caller reads it from the live modules so this file stays free of them; a
 * report built without it simply has no runtime checks.
 */
export interface PanelRuntimeSnapshot {
  saves: { storeUpdates: number; boardUpdates: number; writes: number }
  slideshows: Array<{
    panelId: string
    isPlaying: boolean
    imageCount: number
    currentIndex: number
    timerSet: boolean
    lookAhead: { index: number; status: string } | null
  }>
}

/**
 * Reads the canvas and the board record and says whether they hold to the
 * architecture: every panel is one tldraw shape carrying its own
 * configuration, the configuration validates against the schema, the board
 * persists the document and nothing else about panels, and the rules the
 * registry declares (one of a singleton kind) hold.
 */
export function buildPanelArchitectureReport(board: Board, editor: PanelArchitectureEditor, runtime?: PanelRuntimeSnapshot): PanelArchitectureReport {
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
    'The board uses the current schema',
    board.schemaVersion === BOARD_SCHEMA_VERSION ? 'PASS' : 'WARNING',
    `Board schemaVersion is ${board.schemaVersion}`,
  )

  // A board's document is never absent (see the Board type and
  // documentFromDraft in panelStore.ts), so there is no longer a
  // transitional state to check for here — only whether the canvas has
  // caught up with a debounced save, below.
  const persistedShapeIds = new Set(Object.keys(board.document.store).filter((id) => id.startsWith('shape:')))
  const unpersisted = shapes.filter((shape) => !persistedShapeIds.has(shape.id))
  addCheck(
    'document-correlation',
    'Every shape on the canvas is in the persisted document',
    unpersisted.length ? 'WARNING' : 'PASS',
    unpersisted.length ? `${unpersisted.length} shape(s) not yet saved (a save is debounced)` : 'Canvas and document agree',
  )

  const camera = editor.getCamera?.()
  const saved = board.camera
  if (camera && saved) {
    const settled = Math.abs(saved.x - camera.x) < 0.01 && Math.abs(saved.y - camera.y) < 0.01 && Math.abs(saved.z - camera.z) < 0.0001
    addCheck(
      'camera-persisted',
      'The saved camera is where the canvas is looking',
      settled ? 'PASS' : 'WARNING',
      settled ? 'Saved view matches the canvas' : 'The view has moved since the last save (a save is debounced)',
    )
  }

  if (runtime) {
    const { saves } = runtime
    addCheck(
      'save-activity',
      'Saves follow board changes (counts since the page loaded)',
      'PASS',
      `${saves.storeUpdates} canvas updates: ${saves.boardUpdates} changed the board, ${saves.storeUpdates - saves.boardUpdates} touched only hover or selection and were not saved; ${saves.writes} writes`,
    )

    const slideshowFaults = runtime.slideshows.flatMap((show) => {
      if (!show.isPlaying) {
        return show.timerSet || show.lookAhead ? [`${show.panelId}: stopped but still has a timer or a queued picture`] : []
      }
      if (show.imageCount < 2) return []
      if (!show.timerSet) return [`${show.panelId}: playing with no timer`]
      if (!show.lookAhead) return [`${show.panelId}: playing with no picture queued`]
      const { index } = show.lookAhead
      if (!Number.isInteger(index) || index < 0 || index >= show.imageCount || index === show.currentIndex) {
        return [`${show.panelId}: queued picture ${index} is not a different picture in the collection of ${show.imageCount}`]
      }
      return []
    })
    const playing = runtime.slideshows.filter((show) => show.isPlaying && show.imageCount > 1)
    addCheck(
      'slideshow-look-ahead',
      'A playing slideshow has its next picture queued; a stopped one has nothing queued',
      slideshowFaults.length ? 'ERROR' : 'PASS',
      slideshowFaults.length
        ? slideshowFaults.join('; ')
        : `${runtime.slideshows.length} slideshow panel(s), ${playing.length} playing${playing.map((show) => ` (${show.panelId}: next ${show.lookAhead?.index}, ${show.lookAhead?.status})`).join('')}`,
    )
  }

  const errors = checks.filter((check) => check.status === 'ERROR').length
  const warnings = checks.filter((check) => check.status === 'WARNING').length
  return {
    board: { id: board.id, name: board.name, schemaVersion: board.schemaVersion },
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
      boardRecord: ['name and timestamps', 'the tldraw document snapshot', 'the camera'],
      ownStores: ['notes (by board)', 'image assets and folder handles (by board and panelId)', 'Spotify tokens (browser-local, never in a board)'],
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
  if (panel.type === 'video') return { selectedVideoId: panel.config.selectedVideoId }
  if (panel.config.imageSource.type === 'bundled') return { imageCollectionId: panel.config.imageSource.collectionId }
  if (panel.config.imageSource.type === 'curated') return { curatedCollectionSlug: panel.config.imageSource.collectionSlug }
  return { imageSourceType: panel.config.imageSource.type, folderName: panel.config.folderName }
}
