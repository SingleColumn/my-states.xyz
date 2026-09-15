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
 * A moment's canvas in the app's own terms: its panels and where they sit,
 * rather than tldraw's document shape. This is the interchange format: a
 * new or imported moment is built from one (storage turns it straight into
 * a document, with no editor involved), and the exported archive carries
 * one too, so the file format stays in the app's own vocabulary and a
 * change to tldraw's does not become a change to the file.
 */
export interface MomentDraft {
  panels: Panel[]
  canvas: CanvasState | null
}

export interface Moment {
  id: string
  name: string
  schemaVersion: 2
  createdAt: number
  updatedAt: number
  camera: CanvasCamera | null
  /** tldraw's document: every panel shape with its geometry, order and configuration. */
  document: TLStoreSnapshot
  /**
   * The theme this moment pins, by id. Absent means the moment follows the
   * theme chosen in Settings, which is what every moment written before
   * themes existed does. A pinned theme that is not installed is kept, not
   * cleared: the app falls back to the global theme and says so.
   */
  themeId?: string
}

export interface MomentSummary {
  id: string
  name: string
  updatedAt: number
  themeId?: string
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
