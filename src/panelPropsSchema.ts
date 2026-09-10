import { T, createShapePropsMigrationIds, createShapePropsMigrationSequence } from 'tldraw'
import type { ImageCollectionSource, Panel, SlideshowSettings, SpotifyPlaylistReference } from './types'
import { defaultSlideshowSettings } from './storage'
import { PANEL_SHAPE_TYPE } from './panelShapeTypes'

/**
 * PROTOTYPE: what a panel's semantic state looks like as tldraw shape props.
 *
 * Nothing here is wired into PanelShapeUtil. The file exists to settle one
 * load-bearing claim of the "config into props" proposal mechanically: that
 * every `Panel` config in types.ts can be expressed in tldraw's validator
 * vocabulary, so that the tldraw store would validate it on every write, an
 * agent reading `editor.getShape()` would see a self-describing record, and
 * `editor.updateShape()` would be the one write path. The accompanying test
 * runs the real configs the app creates through these validators.
 *
 * What it also shows, by omission: the *first* move of existing sessions
 * cannot be a tldraw props migration. A props migration receives only the
 * shape's old props (`{ w, h, panelId }`); the config it needs lives in the
 * app's IndexedDB session record, which is asynchronous and out of reach.
 * That move has to happen where the app already rebuilds shapes from the
 * session on load (`restoreCanvas` in App.tsx). tldraw migrations are for
 * every change *after* that.
 */

export const spotifyPlaylistReferenceValidator: T.Validator<SpotifyPlaylistReference> = T.object({
  id: T.nullable(T.string),
  uri: T.nullable(T.string),
  name: T.nullable(T.string),
  url: T.nullable(T.string),
  image: T.optional(T.nullable(T.string)),
})

export const imageCollectionSourceValidator: T.Validator<ImageCollectionSource> = T.union('type', {
  none: T.object({ type: T.literal('none') }),
  'session-assets': T.object({ type: T.literal('session-assets') }),
  bundled: T.object({ type: T.literal('bundled'), collectionId: T.string }),
})

export const slideshowSettingsValidator: T.Validator<SlideshowSettings> = T.object({
  folderName: T.nullable(T.string),
  imageSource: imageCollectionSourceValidator,
  currentIndex: T.integer,
  intervalMs: T.positiveNumber,
  transitionMs: T.number,
  shuffle: T.boolean,
  zoom: T.positiveNumber,
})

/**
 * The per-shape half of `Panel`: its type and configuration, discriminated
 * the same way `Panel` is. `id`, `createdAt` and `updatedAt` are not here
 * because a shape already has an id and tldraw does not keep timestamps on
 * records; `visible` and `focusView` are separate props below.
 */
export const panelContentValidator = T.union('type', {
  spotify: T.object({ type: T.literal('spotify'), config: T.object({ playlist: spotifyPlaylistReferenceValidator }) }),
  slideshow: T.object({ type: T.literal('slideshow'), config: slideshowSettingsValidator }),
  notes: T.object({ type: T.literal('notes'), config: T.object({ activeNoteId: T.nullable(T.string) }) }),
})

export type PanelShapeContent = T.TypeOf<typeof panelContentValidator>

// The validator's type and the app's `Panel` type must describe the same
// values; if `Panel` gains a variant these lines stop compiling. (`Pick`
// is applied per variant because it does not distribute over a union.)
type PanelContentOf<P> = P extends Panel ? Pick<P, 'type' | 'config'> : never
const _panelToValidator: PanelShapeContent = null as unknown as PanelContentOf<Panel>
const _validatorToPanel: PanelContentOf<Panel> = null as unknown as PanelShapeContent
void _panelToValidator
void _validatorToPanel

/** The shape props the proposal would give the panel shape. */
export const proposedPanelShapeProps = {
  w: T.number,
  h: T.number,
  /** Kept so notes, assets and the session keep a stable foreign key. */
  panelId: T.string,
  panel: panelContentValidator,
  visible: T.boolean,
  focusView: T.boolean,
}

export type ProposedPanelShapeProps = { [K in keyof typeof proposedPanelShapeProps]: T.TypeOf<(typeof proposedPanelShapeProps)[K]> }

export const panelShapeMigrationVersions = createShapePropsMigrationIds(PANEL_SHAPE_TYPE, {
  AddPanelContent: 1,
})

/**
 * The migration tldraw would run on any persisted panel shape that predates
 * the `panel` prop. It can only invent a placeholder, for the reason given at
 * the top of this file; the app-level load path is what fills it in.
 */
export const panelShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: panelShapeMigrationVersions.AddPanelContent,
      up(props) {
        props.panel = { type: 'slideshow', config: { ...defaultSlideshowSettings } }
        props.visible = true
        props.focusView = false
      },
      down(props) {
        delete props.panel
        delete props.visible
        delete props.focusView
      },
    },
  ],
})
