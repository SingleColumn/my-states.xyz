import { expect, test } from '@playwright/test'
import { cameraZoom, describeCanvas, geometryOf, noteBodyOf, openApp, panelById, panelOfType, readStorage, shapeOf, waitForCanvas } from './helpers'

/**
 * The writing surface itself: what a writer types becomes structure, what
 * they wrote is what the store holds, and a reload gives it back. The
 * assertion oracle for content is the app's own IndexedDB (readStorage),
 * not the rendered DOM, as in the rest of the suite.
 */
test.describe('Notes editor', () => {
  test('Markdown shortcuts become structure and the note is stored as Markdown', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await expect(body).toBeVisible()

    await body.click()
    await page.keyboard.type('# A heading')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Some **bold** prose.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- first')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second')

    await expect(body.locator('h1')).toHaveText('A heading')
    await expect(body.locator('p strong')).toHaveText('bold')
    await expect(body.locator('ul li')).toHaveCount(2)

    // The store hears the change a moment after the last keystroke (the
    // editor batches reports), then saves it a moment after that.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content, { message: 'the stored Markdown' })
      .toBe('# A heading\n\nSome **bold** prose.\n\n* first\n* second\n')
  })

  test('a reload restores the note into the editor', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('> a quotation')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('after it')
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('> a quotation\n\nafter it\n')

    await page.reload()
    await waitForCanvas(page)
    const again = noteBodyOf(await shapeOf(page, (await panelOfType(page, 'notes')).panelId))
    await expect(again.locator('blockquote')).toHaveText('a quotation')
    await expect(again.locator('p').last()).toHaveText('after it')
  })

  test('an edit made just before switching notes lands in the note it was typed in', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const body = noteBodyOf(shape)
    await body.click()
    await page.keyboard.type('first note text')
    // No pause: the editor reports every edit as it happens, so the text is
    // already the store's when the note changes under it, and the fresh
    // editor for the new note must start blank.
    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'New note' }).click()

    const fresh = noteBodyOf(shape)
    await expect(fresh.locator('.is-empty')).toHaveCount(1)
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes.map((note) => note.content).sort())
      .toEqual(['', 'first note text\n'])
  })
})

test.describe('formatting tooltip', () => {
  test('appears over a selection, applies bold, and is dismissed by Escape', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('Plain words here')
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' })
    await expect(toolbar).toBeHidden()

    // Select the last word with the keyboard; the bar should follow.
    await page.keyboard.press('Shift+Control+ArrowLeft')
    await expect(toolbar).toBeVisible()

    // The bar sits on the body, outside the panel's clipping box, and above
    // the selected line rather than flipped below it.
    const selectionTop = await page.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().top)
    const barBox = await toolbar.boundingBox()
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(selectionTop + 1)

    const bold = toolbar.getByRole('button', { name: 'Bold' })
    await expect(bold).toHaveAttribute('aria-pressed', 'false')
    await bold.click()
    await expect(body.locator('strong')).toHaveText('here')
    await expect(bold).toHaveAttribute('aria-pressed', 'true')
    // Focus stayed in the editor and the panel did not move.
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true)
    expect(geometryOf(await panelById(page, notes.panelId))).toEqual(geometryOf(notes))

    await bold.focus()
    await page.keyboard.press('Escape')
    await expect(toolbar).toBeHidden()
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true)

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('Plain words **here**\n')
  })

  test('goes away when the selection collapses', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('One two')
    await page.keyboard.press('Shift+Home')
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' })
    await expect(toolbar).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(toolbar).toBeHidden()
    // ...and comes back for the next selection.
    await page.keyboard.press('Shift+Home')
    await expect(toolbar).toBeVisible()
  })
  test('follows the selection, unscaled, when the canvas is zoomed', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('Zoomed words')
    await page.keyboard.press('Shift+Control+ArrowLeft')
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' })
    await expect(toolbar).toBeVisible()
    const before = await toolbar.boundingBox()

    // Ctrl+wheel over the canvas zooms it (tldraw's binding, see the wheel
    // spec in boundary.spec.ts). The bar hides while the wheel turns and
    // comes back over the selection once it stops -- with no help from the
    // keyboard, since the selection itself never changed.
    const bodyBox = await body.boundingBox()
    await page.mouse.move(bodyBox!.x + 20, bodyBox!.y + bodyBox!.height - 20)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -600)
    await page.keyboard.up('Control')
    await expect.poll(() => cameraZoom(page)).toBeGreaterThan(1.05)
    await expect(toolbar).toBeVisible()

    const after = await toolbar.boundingBox()
    const selection = await page.evaluate(() => {
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      return { top: rect.top, centreX: rect.left + rect.width / 2 }
    })
    // Same size as before the zoom: the bar is app chrome, not canvas content.
    expect(Math.abs(after!.height - before!.height)).toBeLessThan(1)
    expect(Math.abs(after!.width - before!.width)).toBeLessThan(1)
    // Above and centred on the (now larger) selected text.
    expect(after!.y + after!.height).toBeLessThanOrEqual(selection.top + 1)
    expect(Math.abs(after!.x + after!.width / 2 - selection.centreX)).toBeLessThan(2)
  })
})
