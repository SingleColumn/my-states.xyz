import { T } from 'tldraw'
import type { ImageCollectionSource, PanelConfigs, PanelType, SlideshowSettings, SpotifyPlaylistReference } from './types'

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
}

export const DEFAULT_SLIDESHOW_ZOOM = 1.1

export const defaultSlideshowSettings: SlideshowSettings = {
  folderName: null,
  imageSource: { type: 'none' },
  currentIndex: 0,
  intervalMs: 5000,
  transitionMs: 450,
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

export const slideshowSettingsValidator: T.Validator<SlideshowSettings> = T.object({
  folderName: T.nullable(T.string),
  imageSource: imageCollectionSourceValidator,
  currentIndex: T.integer,
  intervalMs: T.positiveNumber,
  transitionMs: T.number,
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
