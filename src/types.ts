export type PanelType = 'spotify' | 'slideshow' | 'notes'

export interface PanelLayout {
  panelType: PanelType
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

export interface SlideshowSettings {
  folderName: string | null
  currentIndex: number
  intervalMs: number
  transitionMs: number
  shuffle: boolean
  zoom: number
}

export interface ImageMetadata {
  name: string
  size: number
  lastModified: number
  width: number | null
  height: number | null
}

export interface ImageItem extends ImageMetadata {
  url: string
}

export interface Note {
  id: string
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

export interface SpotifyTrackState {
  title: string
  artist: string
  album: string
  albumArt: string | null
  durationMs: number
  positionMs: number
  paused: boolean
}
