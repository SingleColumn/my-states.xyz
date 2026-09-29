import { expect, test, type Page } from '@playwright/test'
import { cameraZoom, choosePanelMenuItem, describeCanvas, dispatch, openApp, panelOfType, shapeOf } from './helpers'

/**
 * The Music panel with no Spotify session — which is how everyone arrives.
 *
 * Every test here runs in a fresh browser profile, so there are no Spotify
 * tokens: this is literally the first-visit panel. Spotify is never reached;
 * the app's own discovery endpoints are answered by the mocks below, which is
 * also what proves the panel asks this app rather than Spotify when nobody
 * has connected.
 */

const playlistResults = [
  ['r1', 'Rain on Glass'],
  ['r2', 'Rain at Night'],
  ['r3', 'Rainy Window'],
] as const

const curatedIds = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']

function playlistSummary(id: string, name: string) {
  return {
    id,
    name,
    uri: `spotify:playlist:${id}`,
    url: `https://open.spotify.com/playlist/${id}`,
    image: null,
    owner: 'Someone',
    trackCount: 40,
  }
}

/**
 * The curated pool is a source file, and it ships empty so that no
 * invented Spotify id is ever shipped. The dev server hands its modules over
 * as JavaScript, so a pool for the duration of one test is a reply to the
 * request for that module — the panel then reads it exactly as it reads the
 * real one.
 */
async function withCuratedPool(page: Page, ids: readonly string[]) {
  await page.route('**/src/config/spotifyCuratedPlaylists*', async (route) => {
    await route.fulfill({
      contentType: 'text/javascript',
      body: `export const curatedSpotifyPlaylists = ${JSON.stringify(ids.map((id) => ({ id, category: id })))};\n`,
    })
  })
}

/** This app's own discovery endpoints, answered without touching Spotify. */
async function withDiscovery(page: Page) {
  const calls: string[] = []

  await page.route('**/api/spotify/search*', async (route) => {
    calls.push(route.request().url())
    const url = new URL(route.request().url())
    const body = url.searchParams.get('type') === 'track'
      ? { items: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: 'https://open.spotify.com/track/t1', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 293_000 }] }
      : { items: playlistResults.map(([id, name]) => playlistSummary(id, name)), hasMore: false }
    await route.fulfill({ json: body })
  })

  // Metadata for whatever ids are asked about, so a test's pool and the
  // cards it produces cannot drift apart.
  await page.route('**/api/spotify/playlists*', async (route) => {
    calls.push(route.request().url())
    const ids = new URL(route.request().url()).searchParams.get('ids')?.split(',') ?? []
    await route.fulfill({ json: { items: ids.map((id) => playlistSummary(id, `Playlist ${id}`)) } })
  })

  // Nothing in this panel may reach Spotify itself without a session. A
  // request that does is a failure, not a slow test.
  await page.route('**://*.spotify.com/**', async (route) => {
    calls.push(route.request().url())
    await route.abort()
  })

  return { calls }
}

async function openMusicPanel(page: Page) {
  await openApp(page)
  const music = await panelOfType(page, 'spotify')
  return { music, shape: await shapeOf(page, music.panelId) }
}

test.describe('the Music panel, before Spotify is connected', () => {
  test('opens on a working search and an offer to connect, not on a login wall', async ({ page }) => {
    const { calls } = await withDiscovery(page)
    await withCuratedPool(page, curatedIds)
    const { shape } = await openMusicPanel(page)

    await expect(shape.getByLabel('Search playlists')).toBeVisible()
    await expect(shape.getByRole('button', { name: 'Connect Spotify', exact: true })).toBeVisible()
    await expect(shape.getByText('Suggested for this session')).toBeVisible()
    await expect(shape.locator('.suggestion-card')).toHaveCount(6)
    // The card that used to be the whole body when logged out.
    await expect(shape.getByText('Play a playlist')).toHaveCount(0)

    expect(calls.every((url) => url.includes('/api/spotify/'))).toBe(true)
  })

  test('replaces the suggestions with results as someone types, and gives them back', async ({ page }) => {
    await withDiscovery(page)
    await withCuratedPool(page, curatedIds)
    const { shape } = await openMusicPanel(page)
    await expect(shape.locator('.suggestion-card')).toHaveCount(6)

    await shape.getByLabel('Search playlists').fill('rain')
    await expect(shape.getByRole('button', { name: /Rain on Glass/ })).toBeVisible()
    await expect(shape.getByText('Suggested for this session')).toHaveCount(0)

    await shape.getByLabel('Search playlists').fill('')
    await expect(shape.getByText('Suggested for this session')).toBeVisible()
    await expect(shape.locator('.suggestion-card')).toHaveCount(6)
  })

  test('deals another set of suggestions without reloading or connecting', async ({ page }) => {
    await withDiscovery(page)
    await withCuratedPool(page, [...curatedIds, 'c7', 'c8', 'c9', 'c10'])
    const { shape } = await openMusicPanel(page)
    await expect(shape.locator('.suggestion-card')).toHaveCount(6)

    const before = await shape.locator('.suggestion-card strong').allInnerTexts()
    await shape.getByRole('button', { name: 'Shuffle suggestions' }).click()

    await expect.poll(async () => shape.locator('.suggestion-card strong').allInnerTexts())
      .not.toEqual(before)
    expect(page.url()).toContain('127.0.0.1')
  })

  // A click on a result is not a disguised login button: it chooses the
  // playlist, the page stays where it is, and nothing plays.
  test('chooses a playlist without leaving the page for Spotify', async ({ page }) => {
    await withDiscovery(page)
    const { shape, music } = await openMusicPanel(page)
    const urlBefore = page.url()

    const connect = shape.getByRole('button', { name: /connect spotify/i })
    // Nothing chosen yet, so nothing to draw the eye to.
    await expect(connect).not.toHaveClass(/is-inviting/)

    await shape.getByLabel('Search playlists').fill('rain')
    await shape.getByRole('button', { name: /Rain on Glass/ }).click()

    await expect.poll(async () => (await describeCanvas(page)).panels.find((panel) => panel.panelId === music.panelId)?.config)
      .toMatchObject({ playlist: { id: 'r1', name: 'Rain on Glass' } })
    expect(page.url()).toBe(urlBefore)

    // Now that something is chosen and only connecting can play it, the one
    // button that does that carries a halo.
    await expect(connect).toHaveClass(/is-inviting/)

    // It is the About button's slow halo, not a quick flash: the same twenty
    // seconds, run once, made of slow pulses.
    const animation = await connect.evaluate((element) => {
      const computed = getComputedStyle(element)
      return { name: computed.animationName, duration: computed.animationDuration, iterations: computed.animationIterationCount }
    })
    expect(animation).toEqual({ name: 'spotify-connect-invite', duration: '20s', iterations: '1' })

    // And it is actually glowing at some point in that sequence, in the same
    // theme colour the About button uses.
    const glow = await connect.evaluate((element) => {
      const running = element.getAnimations()[0]
      running.pause()
      running.currentTime = 3_000 // inside the first pulse's hold
      return { boxShadow: getComputedStyle(element).boxShadow, glowColour: getComputedStyle(document.documentElement).getPropertyValue('--color-attention-glow').trim() }
    })
    expect(glow.boxShadow).not.toBe('none')
    expect(glow.glowColour).not.toBe('')

    // A click that seems to do nothing reads as broken, so the panel says why
    // it is not playing and that connecting brings the visitor back.
    const note = shape.getByRole('status')
    await expect(note).toContainText('Connect Spotify to play this playlist here')
    await expect(note).toContainText('come straight back to this page')

    // One way to connect, however much has been chosen -- and no way out of
    // the app to Spotify, which would leave the visitor with nothing to return to.
    await expect(shape.getByRole('button', { name: /connect spotify/i })).toHaveCount(1)
    await expect(shape.getByRole('link')).toHaveCount(0)
  })

  // A dropdown beside the field made it the narrower half of its row. What the
  // search looks for is a setting, so it lives in the panel's menu and the
  // field runs the full width of the row under it.
  test('gives the search field the whole row, with the search type in the panel menu', async ({ page }) => {
    await withDiscovery(page)
    const { shape } = await openMusicPanel(page)

    await expect(shape.getByLabel('Search type')).toHaveCount(0)
    await expect(shape.locator('.panel-body select')).toHaveCount(0)

    const field = await shape.getByLabel('Search playlists').boundingBox()
    const buttons = await shape.locator('.spotify-search-actions').boundingBox()
    expect(field && buttons).toBeTruthy()
    // The same left and right edges as the buttons beneath it.
    expect(Math.abs(field!.x - buttons!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(field!.width - buttons!.width)).toBeLessThanOrEqual(1)

    await choosePanelMenuItem(shape, 'Search for songs')
    await expect(shape.getByLabel('Search songs')).toBeVisible()
    await expect(shape.getByLabel('Search playlists')).toHaveCount(0)
  })

  // The focus ring reaches out past the field by its width plus its offset.
  // With only the row gap beneath it the ring ended a few pixels from the
  // buttons and looked like it was touching them.
  test('keeps the focus ring of the search field clear of the buttons under it', async ({ page }) => {
    await withDiscovery(page)
    const { shape } = await openMusicPanel(page)
    const field = shape.getByLabel('Search playlists')
    await field.fill('rain')
    await expect(field).toBeFocused()

    const zoom = await cameraZoom(page)
    const measured = await field.evaluate((element) => {
      const style = getComputedStyle(element)
      const buttons = element.closest('.panel-body')!.querySelector('.spotify-search-actions')!
      return {
        reach: Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset),
        gap: buttons.getBoundingClientRect().top - element.getBoundingClientRect().bottom,
        // The space the two buttons keep between themselves: the standard the
        // field should keep from them, ring included.
        betweenButtons: Number.parseFloat(getComputedStyle(buttons).columnGap),
      }
    })

    expect(measured.reach).toBeGreaterThan(0)
    // Rects are in screen pixels and the ring in the panel's own, so the
    // canvas zoom is divided out. What is left once the ring is counted must
    // be at least the space between the buttons, or the ring reads as touching.
    expect(measured.gap / zoom - measured.reach).toBeGreaterThanOrEqual(measured.betweenButtons - 0.5)
  })

  // The moment saves a playlist so it is there to play once connected. Until
  // then it is a name that cannot be played and that this visitor did not just
  // choose, so it stays out of sight -- and out of the button's glow -- until
  // they choose one now.
  test('keeps a playlist saved in the moment out of sight until one is chosen now', async ({ page }) => {
    await withDiscovery(page)
    const { shape, music } = await openMusicPanel(page)
    await dispatch(page, {
      kind: 'panel.update',
      panelId: music.panelId,
      config: { playlist: { id: 's1', uri: 'spotify:playlist:s1', name: 'Saved Earlier', url: 'https://open.spotify.com/playlist/s1', image: null } },
    })
    // The moment does hold it...
    await expect.poll(async () => (await describeCanvas(page)).panels.find((panel) => panel.panelId === music.panelId)?.config)
      .toMatchObject({ playlist: { id: 's1', name: 'Saved Earlier' } })

    // ...and the panel does not say so, in the body or the footer, and has
    // nothing to explain and nothing to glow about.
    await expect(shape.getByText('Saved Earlier')).toHaveCount(0)
    await expect(shape.locator('.loaded-playlist')).toHaveCount(0)
    await expect(shape.getByRole('status')).toHaveCount(0)
    await expect(shape.locator('.card-footer-meta')).toHaveText('No playlist loaded')
    const connect = shape.getByRole('button', { name: /connect spotify/i })
    await expect(connect).not.toHaveClass(/is-inviting/)

    await shape.getByLabel('Search playlists').fill('rain')
    await shape.getByRole('button', { name: /Rain on Glass/ }).click()

    // Chosen now: it is named, explained, and the button glows.
    await expect(shape.locator('.loaded-playlist')).toContainText('Rain on Glass')
    await expect(shape.locator('.card-footer-meta')).toHaveText('Rain on Glass')
    await expect(shape.getByRole('status')).toContainText('Connect Spotify to play this playlist here')
    await expect(connect).toHaveClass(/is-inviting/)
  })

  test('is a steady ring rather than movement for someone who asks for less motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await withDiscovery(page)
    const { shape } = await openMusicPanel(page)
    await shape.getByLabel('Search playlists').fill('rain')
    await shape.getByRole('button', { name: /Rain on Glass/ }).click()

    const connect = shape.getByRole('button', { name: /connect spotify/i })
    await expect(connect).toHaveClass(/is-inviting/)
    const style = await connect.evaluate((element) => {
      const computed = getComputedStyle(element)
      return { animationName: computed.animationName, boxShadow: computed.boxShadow }
    })
    expect(style.animationName).toBe('none')
    expect(style.boxShadow).not.toBe('none')
  })

  test('still lays itself out when the panel is made small, and in the focus view', async ({ page }) => {
    await withDiscovery(page)
    await withCuratedPool(page, curatedIds)
    const { shape, music } = await openMusicPanel(page)
    await expect(shape.locator('.suggestion-card')).toHaveCount(6)

    // The results list is the part that measures itself against the room it
    // has. A search, then a much smaller panel, is where that measurement
    // used to leave a sliced row or push the footer off the bottom.
    await shape.getByLabel('Search playlists').fill('rain')
    await expect(shape.getByRole('button', { name: /Rain on Glass/ })).toBeVisible()

    await dispatch(page, { kind: 'panel.resize', panelId: music.panelId, w: 340, h: 340 })
    await expect(shape.locator('.card-footer')).toBeVisible()
    await expect(shape.getByLabel('Search playlists')).toBeVisible()

    await choosePanelMenuItem(shape, 'Reduce panel to focus view')
    await expect(shape.locator('.spotify-focus-connect').getByText('Not connected')).toBeVisible()
    await expect(shape.getByRole('button', { name: 'Connect Spotify', exact: true })).toBeVisible()
    // The focus view is too small for six cards or for a search field.
    await expect(shape.locator('.suggestion-card')).toHaveCount(0)
    await expect(shape.getByLabel('Search playlists')).toHaveCount(0)

    await choosePanelMenuItem(shape, 'Expand panel to full view')
    await expect(shape.getByLabel('Search playlists')).toBeVisible()
  })
})

// The redirect to Spotify wipes everything the panel held in memory. What comes
// back is read from the tab's own sessionStorage, and the real hook then asks
// Spotify -- with the visitor's own token this time -- for the same search.
test.describe('the Music panel, coming back from connecting Spotify', () => {
  test('brings the search back with its results, answered by the visitor\'s own Spotify', async ({ page }) => {
    const spotifyCalls: Array<{ url: string; authorization: string | undefined }> = []

    await page.addInitScript(() => {
      window.localStorage.setItem('mic:spotify-tokens', JSON.stringify({ accessToken: 'test-access', refreshToken: null, expiresAt: Date.now() + 3_600_000 }))
      window.sessionStorage.setItem('mic:spotify-return-context', JSON.stringify({ panelId: 'panel_music', choice: null, query: 'rain', searchType: 'playlists' }))
    })

    // The Web Playback SDK is Spotify's to serve and is not what is under test.
    await page.route('**://sdk.scdn.co/**', (route) => route.abort())
    await page.route('**://api.spotify.com/v1/search*', async (route) => {
      const request = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' }
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors })
        return
      }
      spotifyCalls.push({ url: request.url(), authorization: request.headers().authorization })
      await route.fulfill({
        headers: cors,
        json: {
          playlists: {
            next: null,
            items: playlistResults.map(([id, name]) => ({
              id, name, uri: `spotify:playlist:${id}`, external_urls: { spotify: `https://open.spotify.com/playlist/${id}` }, images: [], owner: { display_name: 'Someone' }, tracks: { total: 40 },
            })),
          },
        },
      })
    })

    const { shape } = await openMusicPanel(page)

    await expect(shape.getByLabel('Search playlists')).toHaveValue('rain')
    await expect(shape.getByRole('button', { name: /Rain on Glass/ })).toBeVisible()
    await expect(shape.getByRole('button', { name: /connect spotify/i })).toHaveCount(0)

    expect(spotifyCalls.length).toBeGreaterThan(0)
    expect(spotifyCalls[0].authorization).toBe('Bearer test-access')
    // Read once: a reload must not restore the same visit a second time.
    expect(await page.evaluate(() => window.sessionStorage.getItem('mic:spotify-return-context'))).toBeNull()
  })
})
