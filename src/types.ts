import type { TLStoreSnapshot } from 'tldraw'

/**
 * The configuration each kind of panel carries. This map is the one place a
 * panel type is declared for the type system; the registry in
 * panelRegistry.ts and the component table in PanelShape.tsx are both keyed
 * by it, so adding a key here is what makes the compiler ask for the rest.
 */
export interface PanelConfigs {
  spotify: { playlist: SpotifyPlaylistReference }
  slideshow: SlideshowSettings
  notes: { activeNoteId: string | null }
}

export type PanelType = keyof PanelConfigs
export type PanelConfig<T extends PanelType = PanelType> = PanelConfigs[T]

/** A panel's type and configuration together, discriminated on `type`. */
export type PanelContent<T extends PanelType = PanelType> = { [K in PanelType]: { type: K; config: PanelConfigs[K] } }[T]

export interface PanelLayout {
  panelId: string
  x: number
  y: number
  w: number
  h: number
  rotation?: number
  order?: number
}

export interface CanvasState {
  camera: {
    x: number
    y: number
    z: number
  }
  panels: PanelLayout[]
}

export interface PanelBase {
  /** Stable application identity; notes, image assets and folder handles are keyed by it. */
  id: string
  visible: boolean
  /** True keeps the Music panel's playback controls only. */
  focusView: boolean
}

/**
 * A panel as the app reads it. The tldraw shape is the record of truth: this
 * is a view of the shape's props, produced by panelStore.ts, and a panel is
 * changed by writing the shape, never by writing one of these.
 */
export type Panel<T extends PanelType = PanelType> = PanelBase & PanelContent<T>

export interface SlideshowSettings {
  folderName: string | null
  imageSource: ImageCollectionSource
  currentIndex: number
  intervalMs: number
  transitionMs: number
  shuffle: boolean
  zoom: number
}

export type ImageCollectionSource =
  | { type: 'none' }
  | { type: 'session-assets' }
  | { type: 'bundled'; collectionId: string }

export interface ImageMetadata {
  name: string
  size: number
  lastModified: number
  width: number | null
  height: number | null
}

export interface MomentImage extends ImageMetadata {
  id: string
  momentId: string
  panelId?: string
  filename: string
  mimeType: string
}

/** Who made a picture, and where the original can be seen. */
export interface ImageAttribution {
  creator: string
  creatorUrl?: string
  sourceUrl?: string
}

export interface ImageItem extends ImageMetadata {
  id: string
  momentId: string | null
  filename: string
  mimeType: string
  url: string
  urlKind: 'object-url' | 'static'
  /** Sample collections credit every image; a viewer's own folder cannot. */
  attribution?: ImageAttribution
}

export interface Note {
  id: string
  momentId: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

export interface SpotifyTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
}

export interface SpotifyPlaylistReference {
  id: string | null
  uri: string | null
  name: string | null
  url: string | null
  /** Filled in by the artwork lookup after the playlist is chosen. */
  image?: string | null
}

export interface CanvasCamera {
  x: number
  y: number
  z: number
}

/**
 * A moment's canvas in the app's own terms: its panels and where they sit.
 * Every new or imported moment starts as a draft; the canvas turns it into
 * a tldraw document the first time it opens the moment, and the draft is
 * dropped. The exported archive carries a draft too, so the file format
 * stays in the app's vocabulary rather than tldraw's.
 */
export interface MomentDraft {
  panels: Panel[]
  canvas: CanvasState | null
}

export interface Moment {
  id: string
  name: string
  schemaVersion: 1
  createdAt: number
  updatedAt: number
  camera: CanvasCamera | null
  /**
   * tldraw's document: every panel shape with its geometry, order and
   * configuration. Null until the canvas has built it from `draft`.
   */
  document: TLStoreSnapshot | null
  draft?: MomentDraft
}

export interface MomentSummary {
  id: string
  name: string
  updatedAt: number
}

export interface SpotifyTrackState {
  title: string
  artist: string
  album: string
  albumArt: string | null
  url: string | null
  durationMs: number
  positionMs: number
  paused: boolean
}
