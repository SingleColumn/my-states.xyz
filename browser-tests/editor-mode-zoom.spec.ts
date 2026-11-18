import { expect, test, type Locator } from '@playwright/test'
import { cameraZoom, loadSampleImages, openApp, panelOfType, selectPanel } from './helpers'

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

test('in Editor mode, the toolbar leaves out controls that act on the hidden canvas', async ({ page }) => {
  await openApp(page)
  const view = page.getByRole('group', { name: 'View' })
  const pan = page.getByRole('button', { name: 'Pan canvas' })
  const layoutMenu = page.getByRole('button', { name: 'Open panel view and layout actions' })
  const canvasActions = page.getByTestId('actions-menu.button')
  const hiddenMenu = page.getByRole('button', { name: 'Open hidden panels' })
  await expect(pan).toBeVisible()
  await expect(layoutMenu).toBeVisible()
  await expect(canvasActions).toBeVisible()

  await view.getByRole('button', { name: 'Editor' }).click()
  await expect(page.locator('[data-testid="spike-editor-layer"]')).toBeVisible()
  await expect(pan).toHaveCount(0)
  await expect(layoutMenu).toHaveCount(0)
  await expect(canvasActions).toHaveCount(0)
  await expect(hiddenMenu).toHaveCount(0)
  // Still useful in Editor mode: adding panels, and undo for panel changes.
  await expect(page.getByRole('combobox', { name: 'Add panel' })).toBeVisible()
  await expect(page.getByTestId('quick-actions.undo')).toBeVisible()

  // A hidden panel can be brought back from the toolbar, as a window.
  const images = page.locator('.spike-window').filter({ has: page.locator('[data-panel="slideshow"]') })
  await images.getByRole('button', { name: 'Images panel actions' }).click()
  await page.getByRole('menuitem', { name: 'Hide panel' }).click()
  await expect(images).toHaveCount(0)
  await hiddenMenu.click()
  await expect(page.getByRole('menuitem')).toHaveText(['Restore Images 1'])
  await page.getByRole('menuitem', { name: 'Restore Images 1' }).click()
  await expect(images).toHaveCount(1)
  await expect(hiddenMenu).toHaveCount(0)

  // Back on the canvas, everything returns.
  await view.getByRole('button', { name: 'Canvas' }).click()
  await expect(pan).toBeVisible()
  await expect(layoutMenu).toBeVisible()
  await expect(canvasActions).toBeVisible()
})

test('in Editor mode, the Notes choice is left out while the page is showing', async ({ page }) => {
  await openApp(page)
  const writingCount = () => page.evaluate(() => window.myStates!.describe().panels.filter((panel) => panel.type === 'notes').length)
  const add = page.getByRole('combobox', { name: 'Add panel' })
  await expect(add.locator('option', { hasText: 'Notes' })).toHaveCount(1)

  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Editor' }).click()
  await expect(page.locator('[data-testid="spike-editor-layer"]')).toBeVisible()
  // Left out, rather than adding a panel that Editor mode would never draw.
  await expect(add.locator('option', { hasText: 'Notes' })).toHaveCount(0)
  await expect(add.locator('option', { hasText: 'Images' })).toHaveCount(1)
  expect(await writingCount()).toBe(1)

  // Other panels are still added, and drawn as windows.
  await add.selectOption('slideshow')
  await expect(page.locator('.spike-window')).toHaveCount(3)

  // Back on the canvas the choice works again.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click()
  await expect(add.locator('option', { hasText: 'Notes' })).toHaveCount(1)
})

test('in Editor mode, Music and Images windows offer focus view in their ⋯ menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page)
  // Setup on the canvas, where the collection browser is: Images needs a
  // picture before it offers focus view.
  await loadSampleImages(page, (await panelOfType(page, 'slideshow')).panelId)
  const zoom = await cameraZoom(page)
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Editor' }).click()
  const layer = page.locator('[data-testid="spike-editor-layer"]')
  await expect(layer).toBeVisible()
  const size = async (window: Locator) => { const box = (await window.boundingBox())!; return { w: Math.round(box.width), h: Math.round(box.height) } }
  const focusViewItem = page.getByRole('menuitemcheckbox', { name: 'Focus view' })

  // Music: a compact player, drawn at the size the canvas gives it (380 x 260
  // canvas units), scaled by the zoom the panels are drawn at.
  const music = layer.locator('.spike-window').filter({ has: page.locator('[data-panel="spotify"]') })
  const before = await size(music)
  await music.getByRole('button', { name: 'Music panel actions' }).click()
  await expect(focusViewItem).toHaveAttribute('aria-checked', 'false')
  await focusViewItem.click()
  const scale = Math.min(1.25, Math.max(0.7, zoom))
  await expect.poll(() => size(music)).toEqual({ w: Math.round(380 * scale), h: Math.round(260 * scale) })
  await expect(music.locator('.panel-spotify-surface')).toHaveClass(/is-focus-view/)
  // Its saved size is not edited, so there is nothing to drag.
  await expect(music.locator('[data-spike-edge]')).toHaveCount(0)
  await music.getByRole('button', { name: 'Music panel actions' }).click()
  await expect(focusViewItem).toHaveAttribute('aria-checked', 'true')
  await focusViewItem.click()
  await expect.poll(() => size(music)).toEqual(before)
  await expect(music.locator('[data-spike-edge]')).toHaveCount(8)

  // Images: keeps its size; the controls give way to the picture.
  const images = layer.locator('.spike-window').filter({ has: page.locator('[data-panel="slideshow"]') })
  const imagesBefore = await size(images)
  await images.getByRole('button', { name: 'Images panel actions' }).click()
  await focusViewItem.click()
  await expect(images.locator('.panel-slideshow-surface')).toHaveClass(/is-focus-view/)
  expect(await size(images)).toEqual(imagesBefore)

  // The state is shared: the canvas shows both in focus view.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click()
  const state = await page.evaluate(() => window.myStates!.describe().panels.filter((panel) => panel.type !== 'notes').map((panel) => [panel.type, panel.focusView]))
  expect(state).toContainEqual(['slideshow', true])
  expect(state).toContainEqual(['spotify', false])
})
