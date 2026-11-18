import { expect, test } from '@playwright/test'
import { cameraZoom, openApp, panelOfType, selectPanel } from './helpers'

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

for (const [width, height] of [[1280, 720], [1920, 1080]]) {
  test(`on the first switch to Editor mode the windows sit one on each side, clear of each other, at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await openApp(page)
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Editor' }).click()
    const layer = page.locator('[data-testid="spike-editor-layer"]')
    await expect(layer).toBeVisible()
    const windows = layer.locator('.spike-window')
    await expect(windows).toHaveCount(2)
    const area = (await layer.locator('.spike-window-area').boundingBox())!
    const boxes = [(await windows.nth(0).boundingBox())!, (await windows.nth(1).boundingBox())!].sort((a, b) => a.x - b.x)
    const [left, right] = boxes
    const footer = (await layer.locator('.spike-page .card-footer').boundingBox())!
    // One on each side, with the page's middle left open between them.
    expect(left.x + left.width).toBeLessThan(right.x)
    expect(left.x + left.width / 2).toBeLessThan(width / 2)
    expect(right.x + right.width / 2).toBeGreaterThan(width / 2)
    expect(right.x - (left.x + left.width)).toBeGreaterThan(width * 0.4)
    // Narrow, and inside the area with a margin all round.
    for (const box of boxes) {
      expect(box.width).toBeLessThanOrEqual(380)
      expect(box.y).toBeGreaterThan(area.y + 8)
      expect(box.y + box.height).toBeLessThan(area.y + area.height - 8)
      // Clear of the page's footer (the word count) as well.
      expect(box.y + box.height).toBeLessThanOrEqual(footer.y)
    }
  })
}

test('in Editor mode, canvas shortcuts do not reach the hidden canvas, with no setting needed', async ({ page }) => {
  await openApp(page)
  const panelsBefore = (await page.evaluate(() => window.myStates!.describe().panels.map((panel) => panel.panelId))).sort()
  // The case that leaked in spike S2: a panel selected on the canvas, so the
  // canvas has the keyboard, then the switch.
  await selectPanel(page, (await panelOfType(page, 'notes')).panelId)
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Editor' }).click()
  await expect(page.locator('[data-testid="spike-editor-layer"]')).toBeVisible()

  // Straight after the switch, with focus still on its button: without the
  // guards `h` changed the hidden tool here and Delete removed the Writing panel.
  // Checked after every key, because the keys can undo each other's leaks:
  // Ctrl+A goes back to the select tool, and Delete removes what Ctrl+D added.
  const read = () => page.evaluate(() => ({
    tool: (window as unknown as { __spike: { editor: { getCurrentToolId(): string } } }).__spike.editor.getCurrentToolId(),
    panels: window.myStates!.describe().panels.map((panel) => panel.panelId).sort(),
  }))
  for (const key of ['h', 'Control+d', 'Delete', 'Backspace', 'Control+a', 'Delete']) {
    await page.keyboard.press(key)
    expect(await read(), `after ${key}`).toEqual({ tool: 'select', panels: panelsBefore })
  }
})
