import 'react'

declare global {
  interface ImportMetaEnv {
    readonly DEV: boolean
    readonly VITE_SPOTIFY_REDIRECT_URI?: string
    readonly VITE_ENABLE_PANEL_REPORT?: string
    readonly VITE_IMAGE_COLLECTIONS_BASE_URL?: string
    readonly VITE_POSTHOG_HOST: string
    readonly VITE_POSTHOG_INTERNAL_TESTER?: string
    readonly VITE_POSTHOG_PROJECT_TOKEN: string
    readonly VITE_TLDRAW_LICENSE_KEY?: string
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
    /** The canvas as data and its verbs as commands; see canvasApi.ts. Present while the canvas is mounted. */
    myStates?: import('./canvasApi').CanvasApi
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
    onSpotifyIframeApiReady?: (api: import('./spotifyEmbed').SpotifyIFrameApi) => void
    instgrm?: {
      Embeds: {
        process(): void
      }
    }
  }

}

declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string
    directory?: string
  }
}
