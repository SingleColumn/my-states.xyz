import { expect, test } from '@playwright/test'
import { cameraZoom, openApp } from './helpers'

/**
 * SPIKE. Editor mode draws its panels at the zoom the canvas was left at,
 * held to 70%..125%, so the two modes feel like one app.
 */
const clamp = (zoom: number) => Math.min(1.25, Math.max(0.7, zoom))

for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440]]) {
  test(`Editor mode draws its panels at the canvas zoom, within range, at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await openApp(page)
    // The canvas first, as every visit starts, then the mode switch.
    const zoom = await cameraZoom(page)
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Editor' }).click()
    const layer = page.locator('[data-testid="spike-editor-layer"]')
    await expect(layer).toBeVisible()

    // The camera stands still behind the hidden canvas, so this is the zoom
    // the board opened at: it fitted the three panels to this screen.
    const shells = layer.locator('.canvas-panel-shell')
    await expect(shells).toHaveCount(3)
    for (const shell of await shells.all()) {
      expect(Number(await shell.evaluate((element) => getComputedStyle(element).zoom))).toBeCloseTo(clamp(zoom), 2)
    }

    // Only what is inside is scaled: a window keeps the size it was given.
    const floating = layer.locator('.spike-window').first()
    const box = (await floating.boundingBox())!
    const inside = (await floating.locator('.canvas-panel-shell').boundingBox())!
    expect(inside.width).toBeCloseTo(box.width, 0)
    expect(inside.height).toBeCloseTo(box.height, 0)
  })
}

test('the Writing header is drawn the same size in both modes', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 864 })
  await openApp(page)
  const measure = () => page.evaluate(() => {
    // The Writing panel's header, wherever it is drawn.
    const header = [...document.querySelectorAll('.panel-notes-surface .card-header')].find((element) => element.getClientRects().length)!
    const title = header.querySelector('.card-title')!
    return { title: parseFloat(getComputedStyle(title).fontSize) * (title.getBoundingClientRect().width / (title as HTMLElement).offsetWidth), height: header.getBoundingClientRect().height }
  })
  const canvas = await measure()
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Editor' }).click()
  await expect(page.locator('[data-testid="spike-editor-layer"]')).toBeVisible()

  const editor = await measure()

  expect(editor.title).toBeCloseTo(canvas.title, 0)
  expect(Math.abs(editor.height - canvas.height)).toBeLessThan(3)
})
