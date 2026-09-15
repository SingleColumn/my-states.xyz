import { test, expect } from '@playwright/test'
import {
  cameraTransform,
  clickAt,
  dragLocator,
  expectArchitectureReportPass,
  geometryOf,
  loadSampleImages,
  noteBodyOf,
  openApp,
  panelById,
  panelOfType,
  shapeOf,
  titleOf,
} from './helpers'

/**
 * The frame/content boundary (src/panelSurface.ts): tldraw owns every part
 * of a panel outside a declared `[data-panel-content]` region and the
 * content owns everything inside one. Each test here presses a real pointer
 * on one side of that line and checks, through describe(), which side
 * answered.
 */

test.describe('frame: tldraw owns it', () => {
  test('dragging a panel by its title moves the panel', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const before = geometryOf(notes)

    await dragLocator(page, await titleOf(page, notes.panelId), { dx: -150, dy: 90 })

    const after = geometryOf(await panelById(page, notes.panelId))
    expect(after.x).toBeLessThan(before.x)
    expect(after.y).toBeGreaterThan(before.y)
    expect({ w: after.w, h: after.h }).toEqual({ w: before.w, h: before.h })
    await expectArchitectureReportPass(page)
  })

  test('right-clicking a panel title opens the canvas menu with "Hide panel"', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')

    await clickAt(page, await titleOf(page, images.panelId), { button: 'right' })

    const menu = page.getByTestId('context-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Hide panel' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    expect(geometryOf(await panelById(page, images.panelId))).toEqual(geometryOf(images))
  })
})

test.describe('content: the widget owns it', () => {
  test('a header picker button opens its popover and does not move the panel', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const shape = await shapeOf(page, images.panelId)
    const pickerButton = shape.getByRole('button', { name: 'Load a sample collection' })

    // A press that wanders a little before release, as real clicks do: the
    // popover still opens and the panel has not moved.
    await dragLocator(page, pickerButton, { dx: 3, dy: 2 })
    await expect(shape.locator('#sample-collection-picker')).toBeVisible()
    expect(geometryOf(await panelById(page, images.panelId))).toEqual(geometryOf(images))

    await dragLocator(page, pickerButton, { dx: 60, dy: 40 })
    expect(geometryOf(await panelById(page, images.panelId))).toEqual(geometryOf(images))
  })

  test('dragging the picture in full view does not move the panel', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)
    const before = geometryOf(await panelById(page, images.panelId))
    const picture = (await shapeOf(page, images.panelId)).locator('img.slideshow-image-layer')

    await dragLocator(page, picture, { dx: 140, dy: 80 })

    expect(geometryOf(await panelById(page, images.panelId))).toEqual(before)
  })

  test('dragging a slider changes the setting and does not move the panel', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const shape = await shapeOf(page, images.panelId)
    const speed = shape.locator('.range-grid label', { hasText: 'Speed' }).locator('input[type="range"]')
    const box = await speed.boundingBox()
    if (!box) throw new Error('The speed slider is not on screen')

    // Press near the left end and drag right: the browser moves the thumb.
    await page.mouse.move(box.x + 4, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()

    const after = await panelById(page, images.panelId)
    expect(after.config).not.toMatchObject({ intervalMs: (images.config as { intervalMs: number }).intervalMs })
    expect(geometryOf(after)).toEqual(geometryOf(images))
  })

  test('dragging the empty stage does not move the panel', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const stage = (await shapeOf(page, images.panelId)).locator('.empty-stage')

    // Aim at a gap in the stage, not one of its buttons.
    const box = await stage.boundingBox()
    if (!box) throw new Error('The empty stage is not on screen')
    await page.mouse.move(box.x + 12, box.y + 12)
    await page.mouse.down()
    await page.mouse.move(box.x + 100, box.y + 80, { steps: 8 })
    await page.mouse.up()

    expect(geometryOf(await panelById(page, images.panelId))).toEqual(geometryOf(images))
  })

  test('dragging the footer does not move the panel', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const footer = (await shapeOf(page, notes.panelId)).locator('footer.card-footer')

    await dragLocator(page, footer, { dx: 120, dy: 60 })

    expect(geometryOf(await panelById(page, notes.panelId))).toEqual(geometryOf(notes))
  })

  test('right-clicking inside a note body leaves the browser menu to the browser', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await expect(body).toBeVisible()

    // The event itself is the evidence: the native menu is not a DOM thing,
    // so what can be checked is that nothing in the page prevented it.
    await page.evaluate(() => {
      window.addEventListener('contextmenu', (event) => {
        ;(window as unknown as { __contextMenuEvent?: Event }).__contextMenuEvent = event
      }, { capture: true })
    })
    await body.click({ button: 'right' })

    await expect(page.getByTestId('context-menu')).toHaveCount(0)
    const verdict = await page.evaluate(() => {
      const event = (window as unknown as { __contextMenuEvent?: MouseEvent }).__contextMenuEvent
      const target = event?.target as Element | null
      return { seen: !!event, prevented: event?.defaultPrevented ?? null, inNote: !!target?.closest('.notes-editor-content') }
    })
    expect(verdict).toEqual({ seen: true, prevented: false, inNote: true })
    await page.keyboard.press('Escape')
  })
})

test.describe('Images focus view', () => {
  test('the picture becomes frame and the credit link stays content', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)
    const shape = await shapeOf(page, images.panelId)

    await shape.getByRole('button', { name: 'Reduce panel to focus view' }).click()
    await expect.poll(async () => (await panelById(page, images.panelId)).focusView).toBe(true)
    const before = geometryOf(await panelById(page, images.panelId))
    const picture = shape.locator('img.slideshow-image-layer')

    // No header any more, so the picture is the only thing to drag by.
    await dragLocator(page, picture, { dx: 130, dy: 70 })
    const moved = geometryOf(await panelById(page, images.panelId))
    expect(moved.x).toBeGreaterThan(before.x)
    expect(moved.y).toBeGreaterThan(before.y)

    // The credit overlay keeps its links: a click reaches the anchor rather
    // than starting a drag. The navigation is stopped in the listener so a
    // real external tab does not open.
    const link = shape.locator('.image-attribution a').first()
    await expect(link).toBeVisible()
    await link.evaluate((anchor) => {
      anchor.addEventListener('click', (event) => {
        event.preventDefault()
        ;(window as unknown as { __creditClicked?: boolean }).__creditClicked = true
      })
    })
    await clickAt(page, link)
    expect(await page.evaluate(() => (window as unknown as { __creditClicked?: boolean }).__creditClicked)).toBe(true)
    expect(geometryOf(await panelById(page, images.panelId))).toEqual(moved)

    await expectArchitectureReportPass(page)
  })
})

test.describe('wheel over panel content', () => {
  test('scrolls a long note rather than the canvas; Ctrl+wheel still zooms the canvas', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))

    // Type enough lines for the note to overflow its panel.
    await body.click()
    await page.keyboard.type(Array.from({ length: 40 }, (_, index) => `l${index + 1}`).join('\n'))
    const scrollable = await body.evaluateHandle((element) => {
      let node: HTMLElement | null = element as HTMLElement
      while (node) {
        const style = getComputedStyle(node)
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
        node = node.parentElement
      }
      throw new Error('Nothing around the note body scrolls')
    })
    await scrollable.evaluate((element) => { element.scrollTop = 0 })
    // Point at the middle of the visible editor, then scroll without moving
    // the pointer: the note moves and the camera does not.
    const bodyBox = await body.boundingBox()
    if (!bodyBox) throw new Error('The note body is not on screen')
    await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + 40)
    const cameraBefore = await cameraTransform(page)
    await page.mouse.wheel(0, 300)
    await expect.poll(() => scrollable.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect(await cameraTransform(page)).toBe(cameraBefore)

    // The same pointer position with Ctrl held is a zoom gesture for tldraw.
    const scrollBefore = await scrollable.evaluate((element) => element.scrollTop)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -200)
    await page.keyboard.up('Control')
    await expect.poll(() => cameraTransform(page)).not.toBe(cameraBefore)
    expect(await scrollable.evaluate((element) => element.scrollTop)).toBe(scrollBefore)
  })
})
