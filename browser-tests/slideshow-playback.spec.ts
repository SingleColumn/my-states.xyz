import { test, expect, type Page } from '@playwright/test'
import { loadSampleImages, openApp, panelOfType, shapeOf } from './helpers'

/**
 * The slideshow prepares its next picture while the current one is showing,
 * so the crossfade starts from a decoded frame. What a viewer sees is only
 * that the change is smooth; what the browser can observe is when an
 * off-screen image is asked to decode, and which picture the timer then
 * shows. Unit tests (slideshowLookAhead, slideshowPlayback) cover pausing,
 * board switches and source changes.
 */

declare global {
  interface Window { __decodes?: Array<{ src: string, shown: string | null }> }
}

/** Records every decode() asked of an off-screen image, and what was on screen at the time. */
async function recordDecodes(page: Page) {
  await page.addInitScript(() => {
    window.__decodes = []
    const decode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
      if (!this.isConnected) {
        const shown = document.querySelector('img.slideshow-image-layer:not(.slideshow-image-outgoing)')?.getAttribute('src') ?? null
        window.__decodes!.push({ src: this.getAttribute('src') ?? '', shown })
      }
      return decode.call(this)
    }
  })
}

/** Pictures only: tldraw decodes its own icons off-screen too. */
const decodes = (page: Page) => page.evaluate(() => (window.__decodes ?? []).filter((entry) => !entry.src.includes('cdn.tldraw.com')))

async function shownPicture(page: Page, panelId: string) {
  return (await shapeOf(page, panelId)).locator('img.slideshow-image-layer:not(.slideshow-image-outgoing)').getAttribute('src')
}

test('a playing slideshow decodes the next picture before the timer shows it', async ({ page }) => {
  await recordDecodes(page)
  await openApp(page)
  const images = await panelOfType(page, 'slideshow')
  await loadSampleImages(page, images.panelId)
  const first = await shownPicture(page, images.panelId)
  const shape = await shapeOf(page, images.panelId)
  await expect(shape.getByText(/^1 \/ \d+$/)).toBeVisible()

  // Well inside the six-second interval, with the first picture still up,
  // the next one has already been asked to decode. (It is queued the moment
  // playback starts, which can be before the first picture is on screen.)
  const prepared = (await decodes(page)).find((entry) => entry.src !== first)?.src
  expect(prepared).toBeTruthy()
  expect(await shownPicture(page, images.panelId)).toBe(first)
  await expect(shape.getByText(/^1 \/ \d+$/)).toBeVisible()

  await expect.poll(() => shownPicture(page, images.panelId), { timeout: 15_000 }).not.toBe(first)
  expect(await shownPicture(page, images.panelId)).toBe(prepared)
})

test('a shuffled advance shows the picture chosen when the timer was set', async ({ page }) => {
  await recordDecodes(page)
  await openApp(page)
  const images = await panelOfType(page, 'slideshow')
  await loadSampleImages(page, images.panelId)
  const first = await shownPicture(page, images.panelId)
  const shape = await shapeOf(page, images.panelId)

  const before = (await decodes(page)).length
  await shape.getByRole('button', { name: 'Shuffle images' }).click()
  // Turning shuffle on chooses the next picture again, at once: well before
  // the six-second timer, which is when the old scheduler rolled.
  await expect.poll(async () => (await decodes(page)).length, { timeout: 2_000 }).toBeGreaterThan(before)
  await expect(shape.getByText(/^1 \/ \d+$/)).toBeVisible()
  const chosen = (await decodes(page)).at(-1)!
  expect(chosen.shown).toBe(first)
  expect(chosen.src).not.toBe(first)

  await expect.poll(() => shownPicture(page, images.panelId), { timeout: 15_000 }).not.toBe(first)
  expect(await shownPicture(page, images.panelId)).toBe(chosen.src)
})
