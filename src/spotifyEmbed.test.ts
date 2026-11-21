import { describe, expect, it, vi } from 'vitest'
import { playlistEmbedEntity, SpotifyEmbedSession, type SpotifyEmbedController, type SpotifyIFrameApi } from './spotifyEmbed'

function controllerStub(): SpotifyEmbedController {
  return {
    loadEntity: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    togglePlay: vi.fn(),
    addListener: vi.fn(),
    destroy: vi.fn(),
  }
}

describe('playlistEmbedEntity', () => {
  it('uses the canonical URI returned by anonymous catalog search', () => {
    expect(playlistEmbedEntity({ id: 'abc', uri: 'spotify:playlist:abc', url: 'https://open.spotify.com/playlist/abc' }))
      .toBe('spotify:playlist:abc')
  })

  it('falls back through the public URL to a URI made from the playlist id', () => {
    expect(playlistEmbedEntity({ id: 'abc', uri: '', url: 'https://open.spotify.com/playlist/abc' }))
      .toBe('https://open.spotify.com/playlist/abc')
    expect(playlistEmbedEntity({ id: 'abc', uri: '', url: '' })).toBe('spotify:playlist:abc')
  })
})

describe('SpotifyEmbedSession', () => {
  it('creates one controller and switches later playlists with loadEntity', async () => {
    const controller = controllerStub()
    const api: SpotifyIFrameApi = {
      createController: vi.fn((_element, _options, callback) => callback(controller)),
    }
    const session = new SpotifyEmbedSession(api, {} as HTMLElement, vi.fn())

    await expect(session.load('spotify:playlist:first')).resolves.toBe('created')
    await expect(session.load('spotify:playlist:second')).resolves.toBe('loaded')

    expect(api.createController).toHaveBeenCalledTimes(1)
    expect(controller.loadEntity).toHaveBeenCalledWith('spotify:playlist:second')
  })

  it('can make the player fill a responsive host without recreating it', async () => {
    const controller = controllerStub()
    const api: SpotifyIFrameApi = {
      createController: vi.fn((_element, _options, callback) => callback(controller)),
    }
    const host = {} as HTMLElement
    const session = new SpotifyEmbedSession(api, host, vi.fn(), '100%')

    await session.load('spotify:playlist:first')

    expect(api.createController).toHaveBeenCalledWith(
      host,
      { uri: 'spotify:playlist:first', width: '100%', height: '100%' },
      expect.any(Function),
    )
  })

  it('loads the newest selection into the same controller when creation is still pending', async () => {
    const controller = controllerStub()
    let finishCreating!: (controller: SpotifyEmbedController) => void
    const api: SpotifyIFrameApi = {
      createController: vi.fn((_element, _options, callback) => { finishCreating = callback }),
    }
    const session = new SpotifyEmbedSession(api, {} as HTMLElement, vi.fn())

    const first = session.load('spotify:playlist:first')
    const second = session.load('spotify:playlist:second')
    finishCreating(controller)

    await expect(first).resolves.toBe('created')
    await expect(second).resolves.toBe('loaded')
    expect(api.createController).toHaveBeenCalledTimes(1)
    expect(controller.loadEntity).toHaveBeenCalledWith('spotify:playlist:second')
  })

  it('destroys its controller only when the session is closed', async () => {
    const controller = controllerStub()
    const api: SpotifyIFrameApi = {
      createController: vi.fn((_element, _options, callback) => callback(controller)),
    }
    const session = new SpotifyEmbedSession(api, {} as HTMLElement, vi.fn())
    await session.load('spotify:playlist:first')

    session.destroy()

    expect(controller.destroy).toHaveBeenCalledTimes(1)
    await expect(session.load('spotify:playlist:second')).rejects.toThrow('closed')
  })
})
