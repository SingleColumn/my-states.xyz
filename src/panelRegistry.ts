import { T } from 'tldraw'
import type { ImageCollectionSource, PanelConfigs, PanelType, SlideshowSettings, SpotifyPlaylistReference } from './types'
import { choice, color, f, mixS, s, type LeafSpec } from './themes/leaf'

/**
 * One entry per panel type: everything the rest of the app needs to know
 * about a kind of panel without naming it. Layouts, the shape schema, panel
 * creation, duplication, the Add panel menu, the architecture report and the
 * archive all read from here. The component that renders a type is the one
 * thing kept out, in PanelShape.tsx, so this module stays free of React and
 * loads in tests and in storage.
 *
 * Adding a panel type is: a config type in types.ts, an entry here, a
 * component in PanelShape.tsx, and the panel's own file.
 */
export interface PanelDefinition<Type extends PanelType> {
  type: Type
  /** The word the user sees: on the panel, in menus, in the report. */
  label: string
  /** At most one on a moment. Duplicating or adding a second is refused. */
  singleton: boolean
  /** Where a new panel of this kind lands and how big it is. */
  defaultLayout: { x: number; y: number; w: number; h: number }
  minimumSize: { w: number; h: number }
  /** The size focus view shrinks to. Null keeps the size the panel has. */
  focusViewSize: { w: number; h: number } | null
  createConfig(): PanelConfigs[Type]
  /** tldraw validates every write to the shape against this. */
  configValidator: T.Validator<PanelConfigs[Type]>
  /**
   * Projects arbitrary input onto this type's known keys and validates the
   * result: a missing key takes its default, a malformed known value
   * throws. The one place a panel from outside the canvas (a new moment's
   * defaults, an imported archive) becomes trustworthy.
   */
  normalizeConfig(value: unknown): PanelConfigs[Type]
  /** The config a copy of this panel starts with. Null means a copy is not allowed. */
  duplicateConfig(config: PanelConfigs[Type]): PanelConfigs[Type] | null
  /**
   * How a theme addresses this panel. Every panel gets `accent` and
   * `panelBackground` (the tokens `--accent-<type>` and `--bg-<type>`, set
   * on the panel by PanelShape.tsx); `fields` are the further values this
   * panel exposes. The theme spec, its JSON Schema and the compiler read
   * this, so a new panel type is themeable by declaring it here.
   */
  theme: PanelThemeIdentity
}

export interface PanelThemeIdentity {
  /** The group name in a theme file, e.g. `components.images` for the slideshow. */
  key: string
  description?: string
  fields?: Record<string, LeafSpec>
}

export const DEFAULT_SLIDESHOW_ZOOM = 1.1

export const defaultSlideshowSettings: SlideshowSettings = {
  folderName: null,
  imageSource: { type: 'none' },
  currentIndex: 0,
  intervalMs: 5000,
  transitionMs: 1000,
  shuffle: false,
  zoom: DEFAULT_SLIDESHOW_ZOOM,
}

export const defaultSpotifyPlaylistReference: SpotifyPlaylistReference = {
  id: null,
  uri: null,
  name: null,
  url: null,
}

export const spotifyPlaylistReferenceValidator: T.Validator<SpotifyPlaylistReference> = T.object({
  id: T.nullable(T.string),
  uri: T.nullable(T.string),
  name: T.nullable(T.string),
  url: T.nullable(T.string),
  image: T.optional(T.nullable(T.string)),
})

export const spotifyConfigValidator: T.Validator<PanelConfigs['spotify']> = T.object({ playlist: spotifyPlaylistReferenceValidator })

export const imageCollectionSourceValidator: T.Validator<ImageCollectionSource> = T.union('type', {
  none: T.object({ type: T.literal('none') }),
  'session-assets': T.object({ type: T.literal('session-assets') }),
  bundled: T.object({ type: T.literal('bundled'), collectionId: T.string }),
})

// The floor a slideshow's own timer already enforces (SlideshowPanel.tsx);
// stated here too so a value this low is rejected before it ever reaches a
// running timer, not just clamped once one is already ticking.
const MIN_SLIDESHOW_INTERVAL_MS = 100

export const slideshowSettingsValidator: T.Validator<SlideshowSettings> = T.object({
  folderName: T.nullable(T.string),
  imageSource: imageCollectionSourceValidator,
  // A negative index is never corrected elsewhere (AppState.tsx only
  // resets an index the image count has outgrown, not a negative one), so
  // it is rejected here, at the one gate every source of configuration -
  // live edit, import, agent command - writes through.
  currentIndex: T.positiveInteger,
  intervalMs: T.positiveNumber.check((value) => {
    if (value < MIN_SLIDESHOW_INTERVAL_MS) throw new T.ValidationError(`Expected at least ${MIN_SLIDESHOW_INTERVAL_MS}ms, got ${value}`)
  }),
  transitionMs: T.positiveNumber,
  shuffle: T.boolean,
  zoom: T.positiveNumber,
})

export const notesConfigValidator: T.Validator<PanelConfigs['notes']> = T.object({ activeNoteId: T.nullable(T.string) })

/** Input that is not a plain object is rejected outright; `undefined` (a missing key) becomes an empty object so its fields take their defaults below. */
export function record(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved panel configuration is not an object.')
  return value as Record<string, unknown>
}

/** Copy only known keys; a missing one takes its default. */
function fields(defaults: object, input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, input[key] === undefined ? fallback : input[key]]))
}

export function normalizePlaylist(value: unknown): SpotifyPlaylistReference {
  const input = record(value)
  return {
    ...fields(defaultSpotifyPlaylistReference, input),
    ...(input.image !== undefined ? { image: input.image } : {}),
  } as SpotifyPlaylistReference
}

export function normalizeSlideshowSettings(value: unknown): SlideshowSettings {
  const input = record(value)
  const source = input.imageSource === undefined ? { type: 'none' } : record(input.imageSource)
  const imageSource = source.type === 'bundled'
    ? { type: source.type, collectionId: source.collectionId }
    : { type: source.type }
  const config = { ...fields(defaultSlideshowSettings, input), imageSource }
  return slideshowSettingsValidator.validate(config)
}

const spotify: PanelDefinition<'spotify'> = {
  type: 'spotify',
  label: 'Music',
  singleton: true,
  defaultLayout: { x: -720, y: -300, w: 460, h: 720 },
  minimumSize: { w: 320, h: 260 },
  // The Music panel drops the playlist URL, search and results in focus view
  // and keeps playback, so it needs far less room.
  focusViewSize: { w: 380, h: 460 },
  createConfig: () => ({ playlist: { ...defaultSpotifyPlaylistReference } }),
  configValidator: spotifyConfigValidator,
  normalizeConfig: (value) => spotifyConfigValidator.validate({ playlist: normalizePlaylist(record(value).playlist) }),
  duplicateConfig: () => null,
  theme: {
    key: 'spotify',
    description: 'The Music panel.',
    fields: {
      artworkShadow: { kind: 'shadow', description: 'Shadow under album art.', token: '--shadow-album-art', derive: f('shadowSmall') },
      artworkPlaceholder: color('Where album art would be, before there is any.', { token: '--color-album-empty', derive: mixS('textPrimary', 8) }),
      artworkPlaceholderHighlight: color('The highlight on the placeholder.', { token: '--color-album-empty-highlight', derive: mixS('textPrimary', 16) }),
      playlistRowBackground: color('A playlist row.', { token: '--color-card-bg', derive: mixS('surfacePrimary', 18) }),
      playlistRowBackgroundHover: color('A playlist row under the pointer.', { token: '--color-card-bg-hover', derive: s('interactiveHover') }),
    },
  },
}

const slideshow: PanelDefinition<'slideshow'> = {
  type: 'slideshow',
  label: 'Images',
  singleton: false,
  defaultLayout: { x: -220, y: -300, w: 460, h: 720 },
  minimumSize: { w: 320, h: 260 },
  // The Images panel keeps its size in focus view and gives the room its
  // controls took to the picture instead.
  focusViewSize: null,
  createConfig: () => ({ ...defaultSlideshowSettings, imageSource: { ...defaultSlideshowSettings.imageSource } }),
  configValidator: slideshowSettingsValidator,
  normalizeConfig: normalizeSlideshowSettings,
  duplicateConfig: (config) => ({ ...config, imageSource: { ...config.imageSource } }),
  theme: {
    key: 'images',
    description: 'The Images panel.',
    fields: {
      frameBorder: { kind: 'border', description: 'A border around the picture, as a border shorthand: a photo matte such as "8px solid #fff", or "none".', token: '--image-frame-border' },
      frameShadow: { kind: 'shadow', description: 'A shadow under the picture, or "none". Not drawn when the edge is torn.', token: '--image-frame-shadow' },
      edge: choice('The edge of the picture.', 'image-edge', ['none', 'deckle'], '--image-edge-mask'),
      tilt: { kind: 'angle', description: 'A rotation of the picture, e.g. "-1.5deg" for a photo glued in by hand; "0deg" (the default) for straight.', token: '--image-tilt' },
      inset: { kind: 'length', description: 'Room kept around the picture inside its stage, e.g. "14px" so a matte, a shadow or a tilt is not clipped; "0px" (the default) fills the stage.', token: '--image-inset' },
    },
  },
}

const notes: PanelDefinition<'notes'> = {
  type: 'notes',
  label: 'Notes',
  singleton: false,
  defaultLayout: { x: 280, y: -300, w: 460, h: 720 },
  minimumSize: { w: 320, h: 260 },
  focusViewSize: null,
  createConfig: () => ({ activeNoteId: null }),
  configValidator: notesConfigValidator,
  normalizeConfig: (value) => {
    const input = record(value)
    return notesConfigValidator.validate({ activeNoteId: input.activeNoteId === undefined ? null : input.activeNoteId })
  },
  duplicateConfig: (config) => ({ activeNoteId: config.activeNoteId }),
  theme: {
    key: 'notes',
    description: 'The Notes panel.',
    fields: {
      titleForeground: color('The note title.', { token: '--color-note-title', derive: s('textPrimary') }),
      controlBackground: color('The note selector and title field.', { token: '--color-note-control-bg', derive: s('surfaceOverlay') }),
      controlBackgroundHover: color('Those controls under the pointer.', { token: '--color-note-control-bg-hover', derive: s('interactiveHover') }),
    },
  },
}

export const panelRegistry: { readonly [K in PanelType]: PanelDefinition<K> } = { spotify, slideshow, notes }

/** In the order a new moment lays them out, left to right. */
export const PANEL_TYPES = Object.keys(panelRegistry) as readonly PanelType[]

export function getPanelDefinition<Type extends PanelType>(type: Type): PanelDefinition<Type> {
  return panelRegistry[type]
}

export function isPanelType(value: unknown): value is PanelType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(panelRegistry, value)
}
