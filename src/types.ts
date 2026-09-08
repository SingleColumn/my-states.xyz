export type PanelType = 'spotify' | 'slideshow' | 'notes'

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
  id: string
  type: PanelType
  /** Absent means visible for sessions written before panel visibility existed. */
  visible?: boolean
  /** Absent means the full panel. True keeps the Music panel's playback controls only. */
  focusView?: boolean
  createdAt: number
  updatedAt: number
}

export type Panel =
  | (PanelBase & { type: 'spotify'; config: { playlist: SpotifyPlaylistReference } })
  | (PanelBase & { type: 'slideshow'; config: SlideshowSettings })
  | (PanelBase & { type: 'notes'; config: { activeNoteId: string | null } })

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

export interface SessionImage extends ImageMetadata {
  id: string
  sessionId: string
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
  sessionId: string | null
  filename: string
  mimeType: string
  url: string
  urlKind: 'object-url' | 'static'
  /** Sample collections credit every image; a viewer's own folder cannot. */
  attribution?: ImageAttribution
}

export interface Note {
  id: string
  sessionId: string
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

export interface SpotifyPlaylistState {
  id: string | null
  uri: string | null
  name: string | null
  url: string | null
  lastSearch: string
}

export interface SpotifyPlaylistReference {
  id: string | null
  uri: string | null
  name: string | null
  url: string | null
  /** Optional: sessions saved before the panel showed playlist artwork have none. */
  image?: string | null
}

export interface Session {
  id: string
  name: string
  schemaVersion: 2
  createdAt: number
  updatedAt: number
  panels: Panel[]
  canvas: CanvasState | null
}

export interface SessionSummary {
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
