export type PanelType = 'spotify' | 'slideshow' | 'notes'

export interface PanelLayout {
  panelId: string
  x: number
  y: number
  w: number
  h: number
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

export interface ImageItem extends ImageMetadata {
  id: string
  sessionId: string | null
  filename: string
  mimeType: string
  url: string
  urlKind: 'object-url' | 'static'
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
