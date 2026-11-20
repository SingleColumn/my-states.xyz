import type { SpotifyPlaylistSummary } from '../api/_lib/spotifyCatalogTypes'

export const spotifyIframeApiUrl = 'https://open.spotify.com/embed/iframe-api/v1'

export interface SpotifyEmbedPlaybackData {
  playingURI?: string
  isPaused?: boolean
  isBuffering?: boolean
  duration?: number
  position?: number
}

export interface SpotifyEmbedEvent {
  data?: SpotifyEmbedPlaybackData
}

export type SpotifyEmbedEventName = 'ready' | 'playback_started' | 'playback_update'

export interface SpotifyEmbedController {
  loadEntity(spotifyUriOrUrl: string, preferVideo?: boolean, startAt?: number): void
  play(): void
  pause(): void
  resume(): void
  togglePlay(): void
  addListener(event: SpotifyEmbedEventName, callback: (event: SpotifyEmbedEvent) => void): void
  destroy(): void
}

export interface SpotifyIFrameApi {
  createController(
    element: HTMLElement,
    options: { uri?: string; url?: string; width?: number | string; height?: number | string },
    callback: (controller: SpotifyEmbedController) => void,
  ): void
}

let iframeApiPromise: Promise<SpotifyIFrameApi> | null = null

/**
 * Loads Spotify's supported iFrame API. It needs no visitor access token:
 * Spotify decides the playback experience inside its own Embed for the
 * visitor's browser and Spotify session.
 */
export function loadSpotifyIframeApi(): Promise<SpotifyIFrameApi> {
  if (iframeApiPromise) return iframeApiPromise

  iframeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onSpotifyIframeApiReady
    window.onSpotifyIframeApiReady = (api) => {
      previousReady?.(api)
      resolve(api)
    }

    const script = document.createElement('script')
    script.src = spotifyIframeApiUrl
    script.async = true
    script.addEventListener('error', () => {
      iframeApiPromise = null
      reject(new Error('Spotify’s iFrame API could not be loaded.'))
    }, { once: true })
    document.body.append(script)
  })

  return iframeApiPromise
}

/** Prefer Spotify's canonical URI, with its public URL as a safe fallback. */
export function playlistEmbedEntity(playlist: Pick<SpotifyPlaylistSummary, 'id' | 'uri' | 'url'>): string {
  const uri = playlist.uri.trim()
  if (uri) return uri
  const url = playlist.url.trim()
  if (url) return url
  return `spotify:playlist:${playlist.id}`
}

/**
 * Owns exactly one controller. The first playlist creates it; every later
 * playlist is handed to loadEntity, including a selection made while the
 * controller callback is still pending.
 */
export class SpotifyEmbedSession {
  private controller: SpotifyEmbedController | null = null
  private creating: Promise<SpotifyEmbedController> | null = null
  private destroyed = false

  constructor(
    private readonly api: SpotifyIFrameApi,
    private readonly host: HTMLElement,
    private readonly configure: (controller: SpotifyEmbedController) => void,
    private readonly height: number | string = 352,
  ) {}

  get currentController() {
    return this.controller
  }

  async load(entity: string): Promise<'created' | 'loaded'> {
    if (this.destroyed) throw new Error('The Spotify Embed test has been closed.')
    if (this.controller) {
      this.controller.loadEntity(entity)
      return 'loaded'
    }
    if (this.creating) {
      const controller = await this.creating
      if (this.destroyed) throw new Error('The Spotify Embed test has been closed.')
      controller.loadEntity(entity)
      return 'loaded'
    }

    this.creating = new Promise((resolve, reject) => {
      try {
        this.api.createController(this.host, { uri: entity, width: '100%', height: this.height }, (controller) => {
          if (this.destroyed) {
            controller.destroy()
            reject(new Error('The Spotify Embed test was closed while the player was loading.'))
            return
          }
          this.controller = controller
          this.configure(controller)
          resolve(controller)
        })
      } catch (caught) {
        reject(caught)
      }
    })

    try {
      await this.creating
      return 'created'
    } finally {
      this.creating = null
    }
  }

  destroy() {
    this.destroyed = true
    this.controller?.destroy()
    this.controller = null
  }
}
