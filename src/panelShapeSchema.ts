import { T, createShapePropsMigrationIds, createShapePropsMigrationSequence, type TLBaseShape } from 'tldraw'
import type { PanelContent, PanelType } from './types'
import { PANEL_SHAPE_TYPE } from './panelShapeTypes'
import { panelRegistry } from './panelRegistry'

/**
 * The panel shape's props: its size, a stable id for the stores that hang
 * off a panel, and the panel itself: type, configuration, whether it is
 * shown and whether it is in focus view. tldraw validates every write
 * against this, persists it in the moment's document, and undoes it with
 * everything else on the canvas. The moment record carries nothing about a
 * panel that is not here.
 *
 * This module has no React in it so the schema can be read by storage and
 * by tests.
 */

export const panelContentValidator = T.union('type', {
  spotify: T.object({ type: T.literal('spotify'), config: panelRegistry.spotify.configValidator }),
  slideshow: T.object({ type: T.literal('slideshow'), config: panelRegistry.slideshow.configValidator }),
  notes: T.object({ type: T.literal('notes'), config: panelRegistry.notes.configValidator }),
}) as unknown as T.Validator<PanelContent>

// If a panel type is added to PanelConfigs without a branch above, this stops compiling.
const _everyTypeHasABranch: Record<PanelType, true> = { spotify: true, slideshow: true, notes: true }
void _everyTypeHasABranch

export const panelShapeProps = {
  w: T.number,
  h: T.number,
  panelId: T.string,
  panel: panelContentValidator,
  visible: T.boolean,
  focusView: T.boolean,
}

export type PanelShapeProps = { [K in keyof typeof panelShapeProps]: T.TypeOf<(typeof panelShapeProps)[K]> }

export type PanelShape = TLBaseShape<typeof PANEL_SHAPE_TYPE, PanelShapeProps>

export const panelShapeMigrationVersions = createShapePropsMigrationIds(PANEL_SHAPE_TYPE, {})

/**
 * Persisted shapes carry the version they were written with, and tldraw runs
 * these when it loads an older one. The sequence is empty: the props above
 * are the first shape ever persisted by the `my-states` database. A change
 * to them is a migration here, and the point at which the decision to
 * discard earlier saved work has to be revisited.
 */
export const panelShapeMigrations = createShapePropsMigrationSequence({
  sequence: [],
})
