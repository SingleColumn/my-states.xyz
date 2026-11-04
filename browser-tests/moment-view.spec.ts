import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  cameraTransform,
  centerOf,
  describeCanvas,
  dispatch,
  dragLocator,
  geometryOf,
  loadSampleImages,
  noteBodyOf,
  openApp,
  panelById,
  panelOfType,
  shapeOf,
  tldrawCursor,
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
      await boxOf((await shapeOf(page, notes.panelId)).locator('.canvas-panel-shell')),
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
    const notes = await panelOfType(page, 'notes')
    const noteShape = await shapeOf(page, notes.panelId)

    await prepareForScreenshot(page)

    const hint = await boxOf(page.getByRole('status').filter({ hasText: 'Esc' }))
    const note = await boxOf(noteShape.locator('.canvas-panel-shell'))
    expect(hint.y + hint.height).toBeLessThanOrEqual(note.y)
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

    const note = await boxOf(noteShape.locator('.canvas-panel-shell'))
    expect(Math.abs(note.y - (1000 - (note.y + note.height)))).toBeLessThanOrEqual(2)

    for (const [locator, property] of [
      [page.locator('.slideshow-stage'), 'border-top-style'],
      [noteShape.locator('.canvas-panel-shell'), 'border-top-style'],
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

  test('a running slideshow holds its picture, and carries on afterwards', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)
    await dispatch(page, { kind: 'panel.update', panelId: images.panelId, config: { intervalMs: 250 } })
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
