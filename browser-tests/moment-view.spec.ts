import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  cameraTransform,
  centerOf,
  describeCanvas,
  dispatch,
  dragLocator,
  expectCanvasSaved,
  geometryOf,
  loadSampleImages,
  noteBodyOf,
  openApp,
  panelById,
  panelOfType,
  readStorage,
  shapeOf,
  tldrawCursor,
  waitForCanvas,
} from './helpers'

/**
 * Moment view (src/momentView.tsx) is a way of looking at the board, so the
 * tests come in two halves: what it hides while on, and that the board is
 * exactly what it was once it is off.
 */

const prepareForScreenshot = async (page: Page) => {
  await page.getByRole('button', { name: 'Open panel view and layout actions' }).click()
  await page.getByRole('menuitem', { name: 'Prepare board for screenshot' }).click()
}
const panelsOnly = async (page: Page) => (await describeCanvas(page)).panels.map(({ panelId, x, y, w, h, visible, focusView, config }) => ({ panelId, x, y, w, h, visible, focusView, config }))

test.describe('Moment view', () => {
  test('leaves only the image, the writing and the song on the canvas', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const notes = await panelOfType(page, 'notes')
    const music = await panelOfType(page, 'spotify')
    await loadSampleImages(page, images.panelId)
    await dispatch(page, { kind: 'panel.update', panelId: music.panelId, config: { track: { id: 't1', uri: 'spotify:track:t1', name: 'Both Sides Now', artists: 'Joni Mitchell', album: 'Clouds', url: 'https://open.spotify.com/track/t1', image: null, durationMs: 180000 } } })
    const imageShape = await shapeOf(page, images.panelId)
    const noteShape = await shapeOf(page, notes.panelId)
    const musicShape = await shapeOf(page, music.panelId)
    await noteBodyOf(noteShape).click()
    await page.keyboard.type('A fragment from a novel.')

    await prepareForScreenshot(page)

    await expect(page.locator('.app-chrome')).toBeHidden()
    await expect(page.locator('.tl-shape .card-header').filter({ visible: true })).toHaveCount(0)
    await expect(page.locator('.tl-shape .card-footer').filter({ visible: true })).toHaveCount(0)
    await expect(imageShape.locator('.slideshow-controls')).toBeHidden()
    await expect(imageShape.locator('img.slideshow-image-layer')).toBeVisible()
    await expect(noteShape.locator('.notes-editor-content')).toContainText('A fragment from a novel.')
    await expect(musicShape.locator('.track-title')).toHaveText('Both Sides Now')
    await expect(musicShape.locator('.transport-row')).toHaveCount(0)
    await expect(musicShape.getByRole('searchbox')).toHaveCount(0)
    await expect(page.locator('.tl-overlays')).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Esc' })).toBeVisible()
  })

  test('the picture, the writing and the song line up along their tops, with the name under the cover', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const notes = await panelOfType(page, 'notes')
    const music = await panelOfType(page, 'spotify')
    await loadSampleImages(page, images.panelId)
    await dispatch(page, { kind: 'panel.update', panelId: music.panelId, config: { track: { id: 't1', uri: 'spotify:track:t1', name: 'Both Sides Now', artists: 'Joni Mitchell', album: 'Clouds', url: 'https://open.spotify.com/track/t1', image: null, durationMs: 180000 } } })
    // The song's panel as tall as the others, so that nothing but the alignment
    // could put its card level with them.
    await dispatch(page, { kind: 'panel.resize', panelId: music.panelId, w: 460, h: 720 })
    const musicShape = await shapeOf(page, music.panelId)

    await prepareForScreenshot(page)

    const imageCard = page.locator('.slideshow-stage')
    const tops = [
      await boxOf(imageCard),
      await boxOf((await shapeOf(page, notes.panelId)).locator('.panel-notes-surface')),
      await boxOf(musicShape.locator('.spotify-chosen.is-featured')),
    ].map((box) => box.y)
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2)

    const card = await boxOf(musicShape.locator('.spotify-chosen.is-featured'))
    const cover = await boxOf(musicShape.locator('.spotify-featured-cover > *'))
    const name = await boxOf(musicShape.locator('.track-copy'))
    expect(cover.y + cover.height).toBeLessThanOrEqual(name.y)
    expect(name.y + name.height).toBeLessThanOrEqual(card.y + card.height)

    // The picture's card holds the picture and, right under it, its credit.
    const framed = await boxOf(imageCard)
    const shown = await boxOf(picture(page))
    const credit = await boxOf(page.locator('.image-attribution'))
    expect(shown.y).toBeGreaterThanOrEqual(framed.y)
    expect(shown.x).toBeGreaterThanOrEqual(framed.x)
    expect(shown.x + shown.width).toBeLessThanOrEqual(framed.x + framed.width)
    expect(credit.y).toBeGreaterThanOrEqual(shown.y + shown.height)
    expect(credit.y - (shown.y + shown.height)).toBeLessThanOrEqual(20)
    expect(credit.y + credit.height).toBeLessThanOrEqual(framed.y + framed.height)
  })

  test('the message about leaving does not cover the panels, in a small window too', async ({ page }) => {
    await page.setViewportSize({ width: 1228, height: 636 })
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)

    await prepareForScreenshot(page)

    const hint = await boxOf(page.getByRole('status').filter({ hasText: 'Esc' }))
    expect(hint.y + hint.height).toBeLessThanOrEqual((await boxOf(page.locator('.slideshow-stage'))).y)
  })

  test('the note looks as it did in the panel: same space under the text, same line breaks, and its panel sets both', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const noteShape = await shapeOf(page, notes.panelId)
    await dispatch(page, { kind: 'note.setContent', panelId: notes.panelId, content: 'First line of the note\n\nA second paragraph, long enough to wrap at least once across the width of the panel so that its line breaks can be compared between the two views.' })
    const paragraph = noteShape.locator('.notes-editor-content > p').last()
    await expect(paragraph).toContainText('A second paragraph')

    const heightIn = async (panelHeight: number) => {
      await dispatch(page, { kind: 'panel.resize', panelId: notes.panelId, w: notes.w, h: panelHeight })
      // Measured at each size, because a panel's margins scale with the panel.
      await expect.poll(async () => (await panelById(page, notes.panelId)).h).toBe(panelHeight)
      const textBefore = await boxOf(paragraph)
      const areaBefore = await boxOf(noteShape.locator('.notes-editor'))
      await prepareForScreenshot(page)
      const card = await boxOf(noteShape.locator('.panel-notes-surface'))
      const text = await boxOf(paragraph)
      expect(Math.abs(text.width - textBefore.width)).toBeLessThanOrEqual(2)
      expect(Math.abs(text.height - textBefore.height)).toBeLessThanOrEqual(2)
      const spaceBefore = areaBefore.y + areaBefore.height - (textBefore.y + textBefore.height)
      const space = card.y + card.height - (text.y + text.height)
      expect(Math.abs(space - spaceBefore)).toBeLessThanOrEqual(3)
      await page.keyboard.press('Escape')
      return card.height
    }
    // Sizing the panel is how the space under the text is chosen.
    const tall = await heightIn(notes.h)
    const short = await heightIn(notes.h - 200)
    expect(tall - short).toBeGreaterThan(100)
  })

  test('all three cards are as wide as their panels, with a tall picture in a short panel too', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const notes = await panelOfType(page, 'notes')
    const music = await panelOfType(page, 'spotify')
    await loadSampleImages(page, images.panelId)
    await dispatch(page, { kind: 'panel.update', panelId: music.panelId, config: { track: { id: 't1', uri: 'spotify:track:t1', name: 'Both Sides Now', artists: 'Joni Mitchell', album: 'Clouds', url: 'https://open.spotify.com/track/t1', image: null, durationMs: 180000 } } })
    for (const panel of [images, notes, music]) await dispatch(page, { kind: 'panel.resize', panelId: panel.panelId, w: 460, h: 420 })

    await prepareForScreenshot(page)

    const noteCard = await boxOf((await shapeOf(page, notes.panelId)).locator('.panel-notes-surface'))
    const imageCard = await boxOf((await shapeOf(page, images.panelId)).locator('.slideshow-stage'))
    const songCard = await boxOf((await shapeOf(page, music.panelId)).locator('.spotify-chosen.is-featured'))
    expect(Math.abs(imageCard.width - noteCard.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(songCard.width - noteCard.width)).toBeLessThanOrEqual(2)

    // Too tall for this panel, so it is cropped to fit, not squashed or overflowing.
    const shell = await boxOf((await shapeOf(page, images.panelId)).locator('.canvas-panel-shell'))
    expect(imageCard.height).toBeLessThanOrEqual(shell.height + 1)
    await expect(picture(page)).toHaveCSS('object-fit', 'cover')
  })

  // The results list is sized to whole rows by writing on the element itself. The
  // view swaps the list for the cover, and that size must not go with it.
  test('search results left open do not squash the song\'s card', async ({ page }) => {
    await page.route('**/api/spotify/search*', (route) => route.fulfill({
      json: { items: [{ id: 'r1', name: 'Rain on Glass', uri: 'spotify:playlist:r1', url: 'https://open.spotify.com/playlist/r1', image: null, owner: 'Someone', trackCount: 40 }], hasMore: false },
    }))
    await openApp(page)
    const music = await panelOfType(page, 'spotify')
    await dispatch(page, { kind: 'panel.update', panelId: music.panelId, config: { playlist: { id: 'p1', uri: 'spotify:playlist:p1', name: 'Dune', url: 'https://open.spotify.com/playlist/p1' } } })
    await dispatch(page, { kind: 'panel.resize', panelId: music.panelId, w: 460, h: 720 })
    const musicShape = await shapeOf(page, music.panelId)
    await musicShape.getByLabel('Search playlists').fill('rain')
    // The list has its size, so this test is about the case that went wrong.
    await expect(musicShape.locator('.playlist-list')).toHaveAttribute('style', /min-height/)

    await prepareForScreenshot(page)

    const card = musicShape.locator('.spotify-chosen.is-featured')
    await expect(card).not.toHaveAttribute('style', /.+/)
    const framed = await boxOf(card)
    const cover = await boxOf(card.locator('.spotify-featured-cover > *'))
    const name = await boxOf(card.locator('.track-copy'))
    expect(cover.y).toBeGreaterThanOrEqual(framed.y)
    expect(name.y + name.height).toBeLessThanOrEqual(framed.y + framed.height)
  })

  test('a note too long for its panel stops at the panel and scrolls', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const noteShape = await shapeOf(page, notes.panelId)
    await dispatch(page, { kind: 'note.setContent', panelId: notes.panelId, content: Array.from({ length: 60 }, (_, line) => `Paragraph number ${line}.`).join('\n\n') })
    await expect(noteShape.locator('.notes-editor-content')).toContainText('Paragraph number 59.')

    await prepareForScreenshot(page)

    const shell = await boxOf(noteShape.locator('.canvas-panel-shell'))
    const card = await boxOf(noteShape.locator('.panel-notes-surface'))
    expect(card.height).toBeLessThanOrEqual(shell.height + 1)
    const scroller = noteShape.locator('.milkdown')
    expect(await scroller.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2)
    await page.mouse.wheel(0, 300)
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  })

  test('the panels sit in the middle of the window, each with a slight border', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const notes = await panelOfType(page, 'notes')
    const music = await panelOfType(page, 'spotify')
    await loadSampleImages(page, images.panelId)
    await dispatch(page, { kind: 'panel.update', panelId: music.panelId, config: { track: { id: 't1', uri: 'spotify:track:t1', name: 'Both Sides Now', artists: 'Joni Mitchell', album: 'Clouds', url: 'https://open.spotify.com/track/t1', image: null, durationMs: 180000 } } })
    const noteShape = await shapeOf(page, notes.panelId)
    const musicShape = await shapeOf(page, music.panelId)
    const cameraBefore = await cameraTransform(page)

    await prepareForScreenshot(page)

    const cards = [
      await boxOf(page.locator('.slideshow-stage')),
      await boxOf(noteShape.locator('.panel-notes-surface')),
      await boxOf(musicShape.locator('.spotify-chosen.is-featured')),
    ]
    const top = Math.min(...cards.map((card) => card.y))
    const bottom = Math.max(...cards.map((card) => card.y + card.height))
    expect(Math.abs(top - (1000 - bottom))).toBeLessThanOrEqual(2)

    for (const [locator, property] of [
      [page.locator('.slideshow-stage'), 'border-top-style'],
      [noteShape.locator('.panel-notes-surface'), 'border-top-style'],
      [musicShape.locator('.spotify-chosen.is-featured'), 'border-top-style'],
    ] as const) await expect(locator).toHaveCSS(property, 'solid')

    await page.keyboard.press('Escape')
    expect(await cameraTransform(page)).toBe(cameraBefore)
  })

  test('nothing on the board can be changed, and the board comes back exactly as it was', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const notes = await panelOfType(page, 'notes')
    await loadSampleImages(page, images.panelId)
    const noteShape = await shapeOf(page, notes.panelId)
    await noteBodyOf(noteShape).click()
    await page.keyboard.type('Written before.')
    await expect.poll(async () => noteShape.locator('.notes-editor-content').textContent()).toContain('Written before.')
    await page.keyboard.press('Escape')
    const before = await panelsOnly(page)
    const cameraBefore = await cameraTransform(page)

    await prepareForScreenshot(page)

    // Typing goes nowhere: the note is not editable and has lost the caret.
    // The z matters: it is the canvas's shortcut for its zoom tool, and the
    // drags below would then zoom rather than move the view.
    const content = noteShape.locator('.notes-editor-content')
    await expect(content).toHaveAttribute('contenteditable', 'false')
    await page.keyboard.type('xyz')
    await expect(content).not.toContainText('xyz')
    expect(await tldrawCursor(page)).toContain('grab')

    // A drag frames the shot; it does not take a panel with it.
    const zoomBefore = await cameraZoom(page)
    await dragLocator(page, noteShape.locator('.notes-editor-content'), { dx: 120, dy: 60 })
    await dragLocator(page, picture(page), { dx: -80, dy: 40 })
    expect(await cameraZoom(page)).toBe(zoomBefore)
    expect(await cameraTransform(page)).not.toBe(cameraBefore)
    // And the shortcuts that act on panels or history do nothing.
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.keyboard.press('Control+z')
    expect(await tldrawCursor(page)).toContain('grab')

    expect(await panelsOnly(page)).toEqual(before)

    await page.keyboard.press('Escape')

    await expect(page.locator('.app-chrome')).toBeVisible()
    await expect(noteBodyOf(noteShape)).toBeVisible()
    expect(await panelsOnly(page)).toEqual(before)
    expect(await cameraTransform(page)).toBe(cameraBefore)
    expect(await tldrawCursor(page)).not.toContain('grab')

    // The board is writable again, and the tool is the one it was.
    await noteBodyOf(noteShape).click()
    await page.keyboard.type(' And after.')
    await expect(content).toContainText('And after.')
    const title = noteShape.locator('.card-title')
    const moved = geometryOf(await panelById(page, notes.panelId))
    await dragLocator(page, title, { dx: 40, dy: 40 })
    expect(geometryOf(await panelById(page, notes.panelId)).x).toBeGreaterThan(moved.x)
  })

  test('a drag on the canvas still moves the view', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const noteShape = await shapeOf(page, notes.panelId)
    await prepareForScreenshot(page)

    const start = await centerOf(noteShape)
    await dragLocator(page, noteShape, { dx: 70, dy: 30 })

    const end = await centerOf(noteShape)
    expect(end.x).toBeGreaterThan(start.x + 40)
    expect(end.y).toBeGreaterThan(start.y + 10)
  })

  test('holding a running slideshow does not save the picture it stopped on', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)
    await dispatch(page, { kind: 'panel.update', panelId: images.panelId, config: { intervalMs: 1000 } })
    await dispatch(page, { kind: 'images.play', panelId: images.panelId })
    const picture = (await shapeOf(page, images.panelId)).locator('img.slideshow-image-layer').first()
    const first = await picture.getAttribute('src')
    await expect.poll(() => picture.getAttribute('src'), { timeout: 15_000 }).not.toBe(first)
    const savedIndex = () => panelById(page, images.panelId).then((panel) => (panel.config as { currentIndex: number }).currentIndex)
    const before = await savedIndex()

    await prepareForScreenshot(page)
    await page.waitForTimeout(500)
    expect(await savedIndex()).toBe(before)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    expect(await savedIndex()).toBe(before)
  })

  test('a board reloaded during this view keeps its own view, not the framing of the shot', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    await expectCanvasSaved(page)
    const { board } = await describeCanvas(page)
    const before = (await readStorage(page, board!.id)).camera
    const noteShape = await shapeOf(page, notes.panelId)

    await prepareForScreenshot(page)
    await dragLocator(page, noteShape, { dx: 90, dy: 60 })
    await page.waitForTimeout(600) // Past the delay before a change is saved.
    expect((await readStorage(page, board!.id)).camera).toEqual(before)

    await page.reload()
    await waitForCanvas(page)
    expect((await readStorage(page, board!.id)).camera).toEqual(before)
  })

  test('a running slideshow holds its picture, and carries on afterwards', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)
    await dispatch(page, { kind: 'panel.update', panelId: images.panelId, config: { intervalMs: 1000 } })
    await dispatch(page, { kind: 'images.play', panelId: images.panelId })
    const picture = (await shapeOf(page, images.panelId)).locator('img.slideshow-image-layer:not(.slideshow-image-outgoing)')
    const sources = async () => {
      const seen = new Set<string | null>()
      for (let sample = 0; sample < 12; sample += 1) {
        seen.add(await picture.getAttribute('src'))
        await page.waitForTimeout(100)
      }
      return seen
    }

    await prepareForScreenshot(page)
    await page.waitForTimeout(400) // Lets a fade already under way finish.
    expect((await sources()).size).toBe(1)

    await page.keyboard.press('Escape')
    await expect.poll(async () => (await sources()).size, { timeout: 15_000 }).toBeGreaterThan(1)
  })

  test('Escape leaves the moment and not a focus view underneath it', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)
    await dispatch(page, { kind: 'panel.setFocusView', panelId: images.panelId, focusView: true })
    await expect.poll(async () => (await panelById(page, images.panelId)).focusView).toBe(true)

    await prepareForScreenshot(page)
    await page.keyboard.press('Escape')

    await expect(page.locator('.app-chrome')).toBeVisible()
    expect((await panelById(page, images.panelId)).focusView).toBe(true)
  })

  test('panels with nothing to show, and video panels, are left out', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await dispatch(page, { kind: 'panel.add', type: 'video' })
    const video = await panelOfType(page, 'video')
    const imageShape = await shapeOf(page, images.panelId)
    const videoShape = await shapeOf(page, video.panelId)

    await prepareForScreenshot(page)

    // This image panel is still offering its collections: no picture yet.
    // Read as a style, not as visibility: a new panel may land outside the
    // view, where the canvas does not draw it whatever this view does.
    await expect(imageShape.locator('.canvas-panel-shell')).toHaveCSS('display', 'none')
    await expect(videoShape.locator('.canvas-panel-shell')).toHaveCSS('display', 'none')

    await page.keyboard.press('Escape')
    await expect(imageShape.locator('.canvas-panel-shell')).not.toHaveCSS('display', 'none')
    await expect(videoShape.locator('.canvas-panel-shell')).not.toHaveCSS('display', 'none')
  })
})

function picture(page: Page) {
  return page.locator('img.slideshow-image-layer').first()
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('The element has no box on screen')
  return box
}

async function cameraZoom(page: Page) {
  return /scale\(([\d.]+)\)/.exec(await cameraTransform(page))?.[1]
}
