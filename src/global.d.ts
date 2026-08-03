import 'react'

declare global {
  interface ImportMetaEnv {
    readonly VITE_SPOTIFY_CLIENT_ID?: string
    readonly VITE_SPOTIFY_REDIRECT_URI?: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }

  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite'
  }

  interface FileSystemHandle {
    readonly kind: 'file' | 'directory'
    readonly name: string
    queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
    requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  }

  interface FileSystemFileHandle extends FileSystemHandle {
    readonly kind: 'file'
    getFile(): Promise<File>
  }

  interface FileSystemDirectoryHandle extends FileSystemHandle {
    readonly kind: 'directory'
    entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>
  }

  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
    Spotify?: typeof Spotify
    onSpotifyWebPlaybackSDKReady?: () => void
  }

  namespace Spotify {
    interface PlaybackState {
      paused: boolean
      position: number
      duration: number
      track_window: {
        current_track: {
          name: string
          artists: Array<{ name: string }>
          album: {
            name: string
            images: Array<{ url: string; width?: number; height?: number }>
          }
        }
      }
    }

    interface WebPlaybackError {
      message: string
    }

    interface PlayerInit {
      name: string
      getOAuthToken: (callback: (token: string) => void) => void
      volume?: number
    }

    class Player {
      constructor(init: PlayerInit)
      connect(): Promise<boolean>
      disconnect(): void
      addListener(event: 'ready', callback: (event: { device_id: string }) => void): boolean
      addListener(event: 'not_ready', callback: (event: { device_id: string }) => void): boolean
      addListener(event: 'player_state_changed', callback: (state: PlaybackState | null) => void): boolean
      addListener(
        event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
        callback: (event: WebPlaybackError) => void,
      ): boolean
      togglePlay(): Promise<void>
      previousTrack(): Promise<void>
      nextTrack(): Promise<void>
      setVolume(volume: number): Promise<void>
      seek(positionMs: number): Promise<void>
    }
  }
}

declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string
    directory?: string
  }
}
